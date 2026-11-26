// Your local repeaters: imported from a file, listed in the Repeaters tab,
// marked on the band map, and tuned with their shift and tone in one click.
//
// The list comes from a CSV file the user exports themselves, in CHIRP's
// format (which RepeaterBook and most programming software can write) or
// RepeaterBook's own. Columns are found by name, so the order does not matter.

import { parseCsv } from './csv.js';
import { Kept } from './kept.js';
import { bandFor } from './bandplan.js';
import { formatMHz, formatDistance, formatTone, compass } from './format.js';

const MAX_TICKS = 400;
const MATCH_HZ = 2500; // "on this repeater's frequency"

const norm = (text) => String(text).toLowerCase().replace(/[^a-z0-9]/g, '');

// What each piece of information may be called in the header row.
const COLUMNS = {
  freq: ['frequency', 'frequencymhz', 'outputfreq', 'outputfrequency', 'outputfrequencymhz', 'output', 'rxfreq', 'rxfrequency', 'receivefrequency', 'downlink'],
  input: ['inputfrequencymhz', 'inputfreq', 'inputfrequency', 'input', 'txfreq', 'txfrequency', 'transmitfrequency', 'uplink'],
  offset: ['offset', 'offsetmhz', 'offsetfrequency'],
  duplex: ['duplex', 'offsetdirection', 'offsetdir', 'shift'],
  tone: ['tone'], // CHIRP: the kind of tone. RepeaterBook: the tone itself.
  rtone: ['rtonefreq', 'pltone', 'pl', 'uplinktone', 'ctcss', 'ctcsstone', 'encodetone', 'tonefreq'],
  ctone: ['ctonefreq', 'tsqtone', 'tsq', 'downlinktone', 'decodetone'],
  name: ['name', 'callsign', 'call'],
  city: ['city', 'nearestcity', 'town'],
  landmark: ['landmark'],
  state: ['state', 'province', 'region'],
  comment: ['comment', 'notes', 'note'],
  lat: ['latitude', 'lat'],
  lon: ['longitude', 'long', 'lon', 'lng'],
  mode: ['mode'],
  fm: ['fmanalog', 'fm', 'analog'],
  dstar: ['dstarnode', 'dstar', 'dstarservice'],
  status: ['operationalstatus', 'status'],
};

function toHz(text) {
  const n = parseFloat(String(text).replace(',', '.'));
  if (!Number.isFinite(n) || n <= 0) return 0;
  // Megahertz is the norm; a few files give kilohertz or hertz.
  if (n < 10000) return Math.round(n * 1e6);
  if (n < 1e7) return Math.round(n * 1e3);
  return Math.round(n);
}

// Reads the text of a repeater file.
// tones: the tones the radio can send, in tenths of a hertz.
// bands: [{ start, end }] the radio covers.
// Returns { repeaters, skipped: [[reason, count]], total }.
export function importRepeaters(text, { tones = [], bands = [] }) {
  const { headers, records } = parseCsv(text);
  const column = {};
  for (const [kind, names] of Object.entries(COLUMNS)) {
    column[kind] = headers.find((h) => names.includes(norm(h))) || null;
  }
  if (!column.freq) {
    return { repeaters: [], skipped: [], total: 0, error: 'This file has no “Frequency” column, so it doesn’t look like a repeater list.' };
  }

  const nearestTone = (hz) => {
    const tenths = Math.round(hz * 10);
    let best = 0;
    for (const t of tones) if (Math.abs(t - tenths) <= 6 && (!best || Math.abs(t - tenths) < Math.abs(best - tenths))) best = t;
    return best;
  };
  const toneOf = (value) => {
    const n = parseFloat(value);
    return Number.isFinite(n) && n > 50 && n < 300 ? nearestTone(n) : 0;
  };

  const skipped = new Map();
  const skip = (reason) => skipped.set(reason, (skipped.get(reason) || 0) + 1);
  const seen = new Set();
  const repeaters = [];

  for (const record of records) {
    const get = (kind) => (column[kind] ? record[column[kind]] || '' : '');

    const freq = toHz(get('freq'));
    if (!freq) {
      skip('had no frequency');
      continue;
    }
    if (!bands.some((b) => freq >= b.start && freq <= b.end)) {
      skip('are on bands this radio doesn’t cover');
      continue;
    }
    if (/^off/i.test(get('status'))) {
      skip('are listed as off the air');
      continue;
    }

    // Which kind of signal. This radio speaks FM and D-STAR.
    let mode = 'FM';
    const named = get('mode').toUpperCase();
    if (named) {
      if (['FM', 'NFM', 'WFM', 'AUTO'].includes(named)) mode = 'FM';
      else if (named === 'DV') mode = 'DV';
      else if (['AM', 'USB', 'LSB', 'CW'].includes(named)) mode = named;
      else {
        skip('use digital systems this radio doesn’t have (DMR, Fusion, P25 and others)');
        continue;
      }
    } else if (column.fm) {
      const dstar = get('dstar');
      if (/^y/i.test(get('fm'))) mode = 'FM';
      else if (dstar && !/^no?$/i.test(dstar)) mode = 'DV';
      else {
        skip('use digital systems this radio doesn’t have (DMR, Fusion, P25 and others)');
        continue;
      }
    }

    // Shift: where to transmit, relative to where you listen.
    let duplex = 'OFF';
    let offset = 0;
    const direction = get('duplex').toLowerCase();
    const offsetMHz = parseFloat(get('offset'));
    const input = toHz(get('input'));
    if (direction === '+' || direction === '-') {
      duplex = direction === '+' ? 'DUP+' : 'DUP-';
      offset = Math.round(Math.abs(offsetMHz) * 1e6) || 0;
    } else if (direction === 'split' && offsetMHz > 0) {
      const diff = Math.round(offsetMHz * 1e6) - freq; // the column holds the transmit frequency
      duplex = diff < 0 ? 'DUP-' : 'DUP+';
      offset = Math.abs(diff);
    } else if (!column.duplex && input && input !== freq) {
      duplex = input < freq ? 'DUP-' : 'DUP+';
      offset = Math.abs(input - freq);
    } else if (!column.duplex && Number.isFinite(offsetMHz) && offsetMHz !== 0) {
      duplex = offsetMHz < 0 ? 'DUP-' : 'DUP+';
      offset = Math.round(Math.abs(offsetMHz) * 1e6);
    }
    if (!offset) duplex = 'OFF';
    offset = Math.round(offset / 100) * 100;

    // Access tone.
    let toneMode = 'OFF';
    let tone = 0;
    let note = '';
    const kind = get('tone');
    const sendTone = get('rtone');
    const squelchTone = get('ctone');
    if (/^(tone|tsql)$/i.test(kind)) {
      toneMode = /^tsql$/i.test(kind) ? 'TSQL' : 'TONE';
      tone = toneMode === 'TSQL' ? toneOf(squelchTone) || toneOf(sendTone) : toneOf(sendTone) || toneOf(squelchTone);
    } else if (/^(dtcs|cross)/i.test(kind) || /^d\d{3}/i.test(sendTone) || /^d\d{3}/i.test(kind)) {
      note = 'Needs a digital code (DCS) instead of a tone. Set that on the radio itself.';
    } else if (!column.duplex || !/^$/.test(kind)) {
      // No "kind of tone" column: the tone columns say it all.
      tone = toneOf(sendTone) || toneOf(kind);
      if (tone) toneMode = 'TONE';
    }
    if (toneMode !== 'OFF' && !tone) toneMode = 'OFF';

    const name = get('name') || `${formatMHz(freq)} MHz`;
    const where = [get('city') || get('landmark'), get('state')].filter(Boolean).join(', ') || get('comment');
    const lat = parseFloat(get('lat'));
    const lon = parseFloat(get('lon'));
    const key = `${freq}|${name}`;
    if (seen.has(key)) {
      skip('were listed twice');
      continue;
    }
    seen.add(key);
    repeaters.push({
      name: name.slice(0, 40),
      freq,
      mode,
      duplex,
      offset,
      toneMode,
      tone,
      place: where.slice(0, 80),
      ...(Number.isFinite(lat) && Number.isFinite(lon) && (lat || lon) ? { lat, lon } : {}),
      ...(note ? { note } : {}),
    });
  }

  return { repeaters, skipped: [...skipped.entries()], total: records.length };
}

// Great-circle distance and direction from one place to another.
export function fromHere(here, there) {
  const rad = Math.PI / 180;
  const p1 = here.lat * rad;
  const p2 = there.lat * rad;
  const dLon = (there.lon - here.lon) * rad;
  const a = Math.sin((p2 - p1) / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dLon / 2) ** 2;
  const km = 6371 * 2 * Math.asin(Math.min(1, Math.sqrt(a)));
  const bearing = Math.atan2(Math.sin(dLon) * Math.cos(p2), Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dLon)) / rad;
  return { km, bearing: (bearing + 360) % 360 };
}

const usesMiles = () => /-(US|GB|LR|MM)$/i.test(navigator.language || '');

function formatFar(km) {
  const miles = usesMiles();
  const v = miles ? km / 1.609344 : km;
  return `${v < 10 ? v.toFixed(1) : Math.round(v)} ${miles ? 'mi' : 'km'}`;
}

function describeShift(r) {
  if (r.duplex === 'OFF') return 'none';
  return `${r.duplex === 'DUP-' ? '−' : '+'} ${formatDistance(r.offset)}`;
}

function describeTone(r) {
  if (r.toneMode === 'OFF' || !r.tone) return r.note ? 'DCS' : 'none';
  return formatTone(r.tone);
}

// ctx: { $, radio, state, toast, recall(entry), inRadioRange(hz), settings,
//        listenFrequency(), onChange() }
export function setupRepeaters(ctx) {
  const { $, radio, state, toast } = ctx;
  const kept = new Kept('repeaters', []);
  let pending = null; // an import read from a file, waiting for "Import"
  let ticksKey = '';
  let listKey = '';

  const list = () => kept.value || [];
  const here = () => {
    const loc = ctx.settings.value && ctx.settings.value.location;
    return loc && Number.isFinite(loc.lat) && Number.isFinite(loc.lon) ? loc : null;
  };

  function forBand(bandId) {
    return list().filter((r) => {
      const band = bandFor(r.freq);
      return band && band.id === bandId;
    });
  }

  // The repeater on this frequency, if the list has one.
  function at(freq) {
    let best = null;
    for (const r of list()) {
      const d = Math.abs(r.freq - freq);
      if (d <= MATCH_HZ && (!best || d < Math.abs(best.freq - freq))) best = r;
    }
    return best;
  }

  function tipFor(r) {
    const parts = [`${formatMHz(r.freq)} MHz`, r.mode];
    if (r.duplex !== 'OFF') parts.push(`shift ${describeShift(r)}`);
    if (r.toneMode !== 'OFF' && r.tone) parts.push(`tone ${formatTone(r.tone)}`);
    return `${parts.join(', ')}.${r.place ? ` ${r.place}.` : ''}${r.note ? ` ${r.note}` : ''} Click to tune to it with these settings.`;
  }

  function tune(r) {
    ctx.recall(r);
    if (r.note) toast(`${r.name}: ${r.note}`);
  }

  // ----------------------------------------------------------- Band map

  function renderTicks() {
    const band = bandFor(ctx.listenFrequency());
    const layer = $('bandmapRepeaters');
    const key = `${band ? band.id : ''}:${list().length}:${kept.stamp || 0}`;
    if (key === ticksKey) return;
    ticksKey = key;
    if (!band) {
      layer.replaceChildren();
      return;
    }
    const width = band.end - band.start;
    layer.replaceChildren(
      ...forBand(band.id)
        .slice(0, MAX_TICKS)
        .map((r) => {
          const el = document.createElement('div');
          el.className = 'bandmap-repeater';
          el.style.left = `${(((r.freq - band.start) / width) * 100).toFixed(3)}%`;
          el.dataset.tipTitle = `${r.name} repeater`;
          el.dataset.tipBody = tipFor(r);
          el.addEventListener('click', (e) => {
            e.stopPropagation(); // not a plain click on the map
            tune(r);
          });
          return el;
        }),
    );
  }

  // --------------------------------------------------------------- List

  function renderList() {
    const all = list();
    const band = bandFor(ctx.listenFrequency());
    const thisBand = $('repeaterThisBand').checked && band;
    const query = norm($('repeaterSearch').value);
    const spot = here();
    const current = at(ctx.listenFrequency());

    // Rebuilt only when something it shows has changed, not on every small
    // step of the dial.
    const key = [kept.stamp || 0, all.length, band ? band.id : '', thisBand ? 1 : 0, query, spot ? `${spot.lat},${spot.lon}` : '', current ? all.indexOf(current) : -1].join('|');
    if (key === listKey) return;
    listKey = key;

    let rows = all;
    if (thisBand) rows = rows.filter((r) => (bandFor(r.freq) || {}).id === band.id);
    if (query) rows = rows.filter((r) => norm(`${r.name} ${r.place} ${formatMHz(r.freq)}`).includes(query));
    rows = rows.map((r) => ({ r, far: spot && r.lat !== undefined ? fromHere(spot, r) : null }));
    const byDistance = rows.some((x) => x.far);
    rows.sort((a, b) => (byDistance ? (a.far ? a.far.km : 1e9) - (b.far ? b.far.km : 1e9) : 0) || a.r.freq - b.r.freq);

    $('repeaterDistanceHead').hidden = !byDistance;
    $('repeaterRows').replaceChildren(
      ...rows.map(({ r, far }) => {
        const tr = document.createElement('tr');
        tr.className = 'go';
        tr.tabIndex = 0;
        tr.classList.toggle('current', r === current);
        const cell = (text, cls) => {
          const td = document.createElement('td');
          if (cls) td.className = cls;
          td.textContent = text;
          return td;
        };
        tr.append(
          cell(r.name),
          cell(`${formatMHz(r.freq)}${r.mode === 'FM' ? '' : ` ${r.mode}`}`, 'figure'),
          cell(describeShift(r)),
          cell(describeTone(r)),
          cell(r.place, 'soft'),
        );
        if (byDistance) tr.append(cell(far ? `${formatFar(far.km)} ${compass(far.bearing, true)}` : '', 'num soft'));
        tr.title = r.note || '';
        tr.addEventListener('click', () => tune(r));
        tr.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') tune(r);
        });
        return tr;
      }),
    );

    $('repeaterTableWrap').hidden = rows.length === 0;
    const summary = $('repeaterSummary');
    if (!all.length) {
      summary.textContent = '';
      $('repeaterEmpty').textContent =
        'No repeater list yet. Import one and the repeaters near you appear here and as marks on the band map. Click any of them to tune to it with the right shift and tone already set.';
    } else {
      const strong = document.createElement('strong');
      strong.textContent = `${all.length} ${all.length === 1 ? 'repeater' : 'repeaters'}`;
      const onBand = band ? forBand(band.id).length : 0;
      summary.replaceChildren(
        strong,
        ` in your list${band ? `, ${onBand} on ${band.name}` : ''}. Click one to tune to it with its shift and tone.${
          all.some((r) => r.lat !== undefined) && !spot ? ' Set your location in the Satellites tab to sort by distance.' : ''
        }`,
      );
      $('repeaterEmpty').textContent = rows.length ? '' : thisBand ? `None of them are on ${band.name}. Untick “This band only” to see the rest.` : 'Nothing matches that search.';
    }
  }

  function render() {
    renderTicks();
    renderList();
  }

  $('repeaterThisBand').addEventListener('change', renderList);
  $('repeaterSearch').addEventListener('input', renderList);

  // ------------------------------------------------------------- Import

  const box = $('repeaterImportBox');
  const result = $('repeaterImportResult');

  function closeImport() {
    box.hidden = true;
    pending = null;
    $('repeaterFile').value = '';
    result.textContent = '';
    $('repeaterImportGo').disabled = true;
  }

  $('repeaterImport').addEventListener('click', () => {
    box.hidden = !box.hidden;
    if (box.hidden) closeImport();
  });
  $('repeaterImportCancel').addEventListener('click', closeImport);

  $('repeaterFile').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    pending = null;
    $('repeaterImportGo').disabled = true;
    result.classList.remove('bad');
    if (!file) return;
    if (file.size > 3e6) {
      result.classList.add('bad');
      result.textContent = 'That file is too big to be a repeater list.';
      return;
    }
    const info = radio.info || {};
    const found = importRepeaters(await file.text(), { tones: info.ctcssTones || [], bands: info.bands || [] });
    if (found.error || !found.repeaters.length) {
      result.classList.add('bad');
      result.textContent = found.error || `None of the ${found.total} rows in this file could be used. ${describeSkipped(found.skipped)}`;
      return;
    }
    pending = found;
    $('repeaterImportGo').disabled = false;
    result.textContent = `Found ${found.repeaters.length} ${found.repeaters.length === 1 ? 'repeater' : 'repeaters'} this radio can use. ${describeSkipped(found.skipped)}`;
  });

  function describeSkipped(skipped) {
    if (!skipped.length) return '';
    return `Left out: ${skipped.map(([reason, n]) => `${n} that ${reason}`).join('; ')}.`;
  }

  box.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!pending) return;
    let next = pending.repeaters;
    if (!$('repeaterReplace').checked) {
      const have = new Set(list().map((r) => `${r.freq}|${r.name}`));
      next = [...list(), ...next.filter((r) => !have.has(`${r.freq}|${r.name}`))];
    }
    try {
      await kept.save(next);
    } catch (err) {
      result.classList.add('bad');
      result.textContent = `Couldn’t save the list: ${err.message}`;
      return;
    }
    kept.stamp = Date.now();
    const count = pending.repeaters.length;
    closeImport();
    render();
    ctx.onChange();
    toast(`Imported ${count} ${count === 1 ? 'repeater' : 'repeaters'}.`, 4000);
  });

  kept.load().then(() => {
    kept.stamp = Date.now();
    render();
    ctx.onChange();
  });

  return { list, forBand, at, render, describeShift, describeTone };
}
