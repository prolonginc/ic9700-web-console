// Satellites: when the FM voice satellites and the ISS will pass over, and
// following one with the radio while it does.
//
// A satellite moves at about 7.5 km a second, so its signal arrives shifted in
// frequency (the Doppler effect), by up to 10 kHz on 70 cm, sliding from high
// to low through the pass. "Tracking" keeps both of the radio's frequencies
// corrected for that, second by second.

import { api } from './kept.js';
import { parseCsv } from './csv.js';
import { createSatellite, elementsFromOmm, look, dopplerDown, dopplerUp } from './sgp4.js';
import { findPasses, parseLocation, locationToGrid } from './passes.js';
import { SATELLITES, SATELLITES_AS_OF, STATUS_URL } from './satdata.js';
import { formatMHz, formatTone, formatWait, formatDuration, compass } from './format.js';

const LOOK_AHEAD_HOURS = 24;
const MIN_ELEVATION = 5;
const RETUNE_HZ = 250; // correct a frequency once it is this far out
const RECOMPUTE_MS = 10 * 60000;
const STOP_AFTER_SET_MS = 60000;
const RESUME_KEY = 'console.tracking';

const timeFormat = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' });
const dayFormat = new Intl.DateTimeFormat(undefined, { weekday: 'short' });

function formatStart(date) {
  const sameDay = date.toDateString() === new Date().toDateString();
  return sameDay ? timeFormat.format(date) : `${dayFormat.format(date)} ${timeFormat.format(date)}`;
}

function heightWords(el) {
  if (el >= 60) return 'nearly overhead';
  if (el >= 30) return 'high';
  if (el >= 15) return 'medium';
  return 'low';
}

// ctx: { $, radio, state, toast, settings, tabs, onChange() }
export function setupSatellites(ctx) {
  const { $, radio, state, toast } = ctx;
  let orbits = new Map(); // catalog number → satellite ready to propagate
  let orbitsFetchedAt = null;
  let orbitsError = '';
  let passes = [];
  let computedAt = 0;
  let tracking = null; // { sat, model, pass, lastDown, lastUp, timer, squelchBefore }

  const canTrack = () => !!(radio.info && radio.info.features && radio.info.features.satellites);
  const location = () => {
    const loc = ctx.settings.value && ctx.settings.value.location;
    return loc && Number.isFinite(loc.lat) && Number.isFinite(loc.lon) ? loc : null;
  };

  // ------------------------------------------------------------- Orbits

  // Orbit data is only asked for once there is a location to use it with.
  async function loadOrbits(refresh = false) {
    if (!location()) {
      render();
      return;
    }
    try {
      const data = await api('GET', `api/orbits${refresh ? '?refresh=1' : ''}`);
      orbitsError = data.error || '';
      orbitsFetchedAt = data.fetchedAt ? new Date(data.fetchedAt) : null;
      const next = new Map();
      for (const record of parseCsv(data.csv || '').records) {
        const model = createSatellite(elementsFromOmm(record));
        if (model) next.set(model.id, model);
      }
      orbits = next;
    } catch (err) {
      orbitsError = err.message;
    }
    compute();
    resume();
  }

  function compute() {
    const here = location();
    passes = [];
    computedAt = Date.now();
    if (here) {
      const from = new Date();
      for (const sat of SATELLITES) {
        const model = orbits.get(sat.id);
        if (!model) continue;
        for (const pass of findPasses(model, here, from, LOOK_AHEAD_HOURS, MIN_ELEVATION)) passes.push({ sat, model, ...pass });
      }
      passes.sort((a, b) => a.start - b.start);
    }
    render();
  }

  // --------------------------------------------------------------- List

  function describeFrequencies(sat) {
    const tone = sat.tone ? `, tone ${formatTone(sat.tone)}` : '';
    return `${formatMHz(sat.downlink)} / ${formatMHz(sat.uplink)}${tone}`;
  }

  function render() {
    const here = location();
    const now = Date.now();
    const upcoming = passes.filter((p) => p.end.getTime() > now);

    $('satRows').replaceChildren(
      ...upcoming.map((p) => {
        const tr = document.createElement('tr');
        const live = p.start.getTime() <= now;
        const shadowed = p.sat.sunlitOnly && !p.sunlit;
        tr.classList.toggle('dim', !!p.sat.quiet || shadowed);
        // The same pass can come out a fraction of a second different each
        // time it is worked out, so "the one being followed" allows for that.
        const mine = !!tracking && tracking.sat.id === p.sat.id && Math.abs(tracking.pass.start - p.start) < 60000;
        tr.classList.toggle('current', mine);
        const cell = (content, cls) => {
          const td = document.createElement('td');
          if (cls) td.className = cls;
          td.append(...[].concat(content));
          return td;
        };

        const name = document.createElement('span');
        name.className = 'figure';
        name.textContent = p.sat.name;
        name.dataset.tipTitle = p.sat.name;
        name.dataset.tipBody = p.sat.note;
        name.tabIndex = 0;

        const starts = [];
        if (live) {
          const pill = document.createElement('span');
          pill.className = 'pill now';
          pill.textContent = 'Overhead now';
          starts.push(pill, ` ${formatDuration(p.end.getTime() - now)} left`);
        } else {
          starts.push(`${formatStart(p.start)}, ${formatWait(p.start.getTime() - now)}`);
        }

        const height = [`${Math.round(p.maxEl)}°, ${heightWords(p.maxEl)}`];
        if (shadowed) {
          const pill = document.createElement('span');
          pill.className = 'pill';
          pill.textContent = 'in shadow';
          height.push(' ', pill);
        }

        const action = document.createElement('td');
        action.className = 'num';
        if (canTrack()) {
          const button = document.createElement('button');
          button.type = 'button';
          button.className = `row-button${live && !tracking ? ' primary' : ''}`;
          button.textContent = mine ? 'Stop' : 'Track';
          button.dataset.tip = mine ? 'satStop' : 'satTrack';
          button.addEventListener('click', () => (mine ? stopTracking() : startTracking(p)));
          action.append(button);
        }

        tr.append(
          cell(name),
          cell(starts),
          cell(formatDuration(Math.round((p.end - p.start) / 60000) * 60000)),
          cell(height),
          cell(`${compass(p.azStart, true)} → ${compass(p.azEnd, true)}`),
          cell(describeFrequencies(p.sat), 'soft'),
          action,
        );
        return tr;
      }),
    );

    $('satTableWrap').hidden = upcoming.length === 0;
    $('satLocationButton').textContent = here ? 'Change my location' : 'Set my location';

    const summary = $('satSummary');
    const empty = $('satEmpty');
    if (!here) {
      summary.textContent = '';
      empty.textContent =
        'Amateur satellites and the space station carry repeaters you can talk through for the few minutes they are overhead. Set your location to see when the next ones pass over you.';
    } else if (!orbits.size) {
      summary.textContent = '';
      empty.textContent = orbitsError || 'Fetching orbit data…';
    } else {
      const strong = document.createElement('strong');
      strong.textContent = `${upcoming.length} ${upcoming.length === 1 ? 'pass' : 'passes'}`;
      summary.replaceChildren(strong, ` over ${here.label || 'you'} in the next ${LOOK_AHEAD_HOURS} hours.`);
      empty.textContent = upcoming.length ? '' : 'Nothing passes high enough to work in that time.';
    }

    const foot = $('satFoot');
    const parts = [];
    if (orbitsFetchedAt) {
      const hours = Math.round((now - orbitsFetchedAt.getTime()) / 3600000);
      parts.push(`Orbit data from CelesTrak, ${hours < 1 ? 'under an hour' : hours === 1 ? 'an hour' : `${hours} hours`} old.`);
    }
    if (orbitsError && orbits.size) parts.push(orbitsError);
    if (here) {
      parts.push(`Frequencies and satellite notes are as of ${SATELLITES_AS_OF}. Dimmed ones are often silent.`);
      if (!canTrack()) parts.push('Following a satellite with the radio needs the direct connection.');
    }
    const link = document.createElement('a');
    link.href = STATUS_URL;
    link.target = '_blank';
    link.rel = 'noopener';
    link.textContent = 'Which satellites are working today';
    foot.replaceChildren(parts.join(' '), parts.length ? ' ' : '', ...(here ? [link, '.'] : []));
  }

  // ----------------------------------------------------------- Location

  const box = $('satLocationBox');
  const result = $('satLocationResult');

  function closeLocation() {
    box.hidden = true;
    result.textContent = '';
    result.classList.remove('bad');
  }

  $('satLocationButton').addEventListener('click', () => {
    box.hidden = !box.hidden;
    if (!box.hidden) {
      const here = location();
      $('satLocationInput').value = here ? here.label || `${here.lat.toFixed(3)}, ${here.lon.toFixed(3)}` : '';
      $('satLocationInput').focus();
    }
  });
  $('satLocationCancel').addEventListener('click', closeLocation);

  async function saveLocation(lat, lon, label) {
    const place = { lat: Math.round(lat * 1000) / 1000, lon: Math.round(lon * 1000) / 1000, label };
    try {
      await ctx.settings.save({ ...(ctx.settings.value || {}), location: place });
    } catch (err) {
      result.classList.add('bad');
      result.textContent = `Couldn’t save your location: ${err.message}`;
      return;
    }
    closeLocation();
    compute();
    ctx.onChange();
    if (!orbits.size) loadOrbits();
  }

  $('satLocate').addEventListener('click', () => {
    result.classList.remove('bad');
    if (!navigator.geolocation) {
      result.classList.add('bad');
      result.textContent = 'This browser can’t give a location. Type a grid square or coordinates instead.';
      return;
    }
    result.textContent = 'Asking this device where it is…';
    navigator.geolocation.getCurrentPosition(
      (pos) => saveLocation(pos.coords.latitude, pos.coords.longitude, `grid ${locationToGrid(pos.coords.latitude, pos.coords.longitude)}`),
      (err) => {
        result.classList.add('bad');
        result.textContent =
          err.code === 1 ? 'Location access was blocked. Type a grid square or coordinates instead.' : 'Couldn’t get a location. Type a grid square or coordinates instead.';
      },
      { maximumAge: 600000, timeout: 15000 },
    );
  });

  box.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = $('satLocationInput').value;
    const place = parseLocation(text);
    result.classList.remove('bad');
    if (!place) {
      result.classList.add('bad');
      result.textContent = 'Type a grid square such as FN31 or FN31pr, or latitude and longitude such as 41.71, -72.73.';
      return;
    }
    saveLocation(place.lat, place.lon, `grid ${locationToGrid(place.lat, place.lon)}`);
    if (!place.exact) toast('A four-character grid square is about 100 km across, so pass times may be a little off. Six characters or coordinates are more exact.', 9000);
  });

  $('satRefresh').addEventListener('click', async () => {
    $('satRefresh').disabled = true;
    await loadOrbits(true);
    $('satRefresh').disabled = false;
  });

  // ----------------------------------------------------------- Tracking

  function renderTracking() {
    const bar = $('trackingBar');
    const text = $('trackingText');
    const stop = $('trackingStop');
    if (!tracking) {
      // The radio can be in satellite mode without us (set on its own panel,
      // or left over from a page that was closed).
      bar.hidden = !state.satMode;
      if (state.satMode) {
        text.textContent = 'The radio is in satellite mode: it listens on one band and transmits on another.';
        stop.textContent = 'Leave satellite mode';
      }
      return;
    }
    const here = location();
    const seen = here ? look(tracking.model, here, new Date()) : null;
    bar.hidden = false;
    stop.textContent = 'Stop tracking';
    const name = document.createElement('strong');
    name.textContent = tracking.sat.name;
    const now = Date.now();
    let where;
    if (!seen) where = ' can’t be placed: its orbit data is out of date.';
    else if (seen.el > 0) {
      where = ` is ${Math.round(seen.el)}° up to the ${compass(seen.az)}, ${formatDuration(Math.max(0, tracking.pass.end.getTime() - now))} left.`;
    } else if (tracking.pass.start.getTime() > now) {
      where = ` rises ${formatWait(tracking.pass.start.getTime() - now)} in the ${compass(tracking.pass.azStart)}. You will hear hiss until then.`;
    } else {
      where = ' has set.';
    }
    const detail = document.createElement('span');
    const tone = tracking.sat.tone ? ` with tone ${formatTone(tracking.sat.tone)}` : '';
    detail.textContent = ` Listening on ${formatMHz(tracking.lastDown, 4)} MHz, transmitting on ${formatMHz(tracking.lastUp, 4)} MHz${tone}.`;
    text.replaceChildren(name, where, detail);
  }

  function follow() {
    if (!tracking) return;
    const here = location();
    const seen = here ? look(tracking.model, here, new Date()) : null;
    if (seen) {
      const down = Math.round(dopplerDown(tracking.sat.downlink, seen.rangeRate) / 100) * 100;
      const up = Math.round(dopplerUp(tracking.sat.uplink, seen.rangeRate) / 100) * 100;
      const change = {};
      if (Math.abs(down - tracking.lastDown) >= RETUNE_HZ) change.downlink = tracking.lastDown = down;
      // The transmit frequency is left alone mid-word.
      if (Math.abs(up - tracking.lastUp) >= RETUNE_HZ && !state.transmitting) change.uplink = tracking.lastUp = up;
      if (Object.keys(change).length) radio.send('satTune', change);
    }
    if (Date.now() - tracking.pass.end.getTime() > STOP_AFTER_SET_MS) {
      const { name } = tracking.sat;
      stopTracking();
      toast(`${name} has set. The radio is back on its usual frequencies.`, 7000);
      return;
    }
    renderTracking();
  }

  function begin(sat, model, pass, fresh) {
    const here = location();
    const seen = look(model, here, new Date());
    const rate = seen ? seen.rangeRate : 0;
    tracking = {
      sat,
      model,
      pass,
      lastDown: Math.round(dopplerDown(sat.downlink, rate) / 100) * 100,
      lastUp: Math.round(dopplerUp(sat.uplink, rate) / 100) * 100,
      squelchBefore: fresh ? state.subSquelch : undefined,
    };
    radio.send('satStart', { downlink: tracking.lastDown, uplink: tracking.lastUp, tone: sat.tone, mode: 'FM' });
    if (fresh) {
      // Satellite signals are weak, so the squelch is opened to let them
      // through. That means hiss until the satellite is in range.
      setTimeout(() => radio.send('setSubSquelch', { value: 0 }), 600);
    }
    radio.merge({ satMode: true });
    tracking.timer = setInterval(follow, 1000);
    try {
      localStorage.setItem(RESUME_KEY, JSON.stringify({ id: sat.id, start: pass.start.getTime(), end: pass.end.getTime(), squelch: tracking.squelchBefore }));
    } catch {
      /* a reload will not pick the pass up again, that is all */
    }
    render();
    renderTracking();
    ctx.onChange();
  }

  function startTracking(pass) {
    if (!radio.rigConnected || !canTrack()) return;
    if (state.transmitting) {
      toast('Let go of the talk button first.');
      return;
    }
    if (tracking) stopTracking(true);
    begin(pass.sat, pass.model, pass, true);
    const shadow = pass.sat.sunlitOnly && !pass.sunlit ? ' It is in shadow on this pass, so listen only.' : '';
    toast(`Following ${pass.sat.name}. The radio now listens and transmits on different bands, and the squelch is open so weak signals get through.${shadow}`, 9000);
  }

  // quiet: another pass is about to be tracked, so leave satellite mode on.
  function stopTracking(quiet = false) {
    const was = tracking;
    if (was) clearInterval(was.timer);
    tracking = null;
    try {
      localStorage.removeItem(RESUME_KEY);
    } catch {
      /* nothing stored */
    }
    if (!quiet) {
      radio.send('satStop');
      radio.merge({ satMode: false });
      // Put the second receiver's squelch back where it was.
      if (was && Number.isFinite(was.squelchBefore) && state.dualWatch) {
        setTimeout(() => radio.send('setSubSquelch', { value: was.squelchBefore }), 1500);
      }
    }
    render();
    renderTracking();
    ctx.onChange();
  }

  $('trackingStop').addEventListener('click', () => {
    if (state.transmitting) {
      toast('Let go of the talk button first.');
      return;
    }
    if (tracking) stopTracking();
    else {
      radio.send('satStop');
      radio.merge({ satMode: false });
    }
  });

  // After a reload in the middle of a pass, carry on following it.
  function resume() {
    if (tracking || !state.satMode || !location()) return;
    let saved = null;
    try {
      saved = JSON.parse(localStorage.getItem(RESUME_KEY) || 'null');
    } catch {
      /* nothing to resume */
    }
    if (!saved || saved.end + STOP_AFTER_SET_MS < Date.now()) return;
    const sat = SATELLITES.find((s) => s.id === saved.id);
    const model = sat && orbits.get(sat.id);
    if (!model) return;
    const pass = passes.find((p) => p.sat.id === sat.id && Math.abs(p.start.getTime() - saved.start) < 120000) || {
      start: new Date(saved.start),
      end: new Date(saved.end),
      azStart: 0,
      sunlit: true,
    };
    begin(sat, model, pass, false);
    tracking.squelchBefore = saved.squelch;
  }

  radio.addEventListener('state', (e) => {
    if (!('satMode' in e.detail)) return;
    // Satellite mode was switched off somewhere else: stop following.
    if (!state.satMode && tracking) {
      clearInterval(tracking.timer);
      tracking = null;
      render();
    }
    if (state.satMode) resume();
    renderTracking();
    ctx.onChange();
  });
  radio.addEventListener('info', () => {
    render();
    renderTracking();
  });
  radio.addEventListener('link', () => {
    if (!radio.rigConnected && tracking) {
      clearInterval(tracking.timer);
      tracking = null;
    }
    renderTracking();
  });

  // Keep the countdowns moving, and look further ahead as time passes.
  setInterval(() => {
    if (ctx.tabs.current !== 'tabSatellites' && !tracking) return;
    if (Date.now() - computedAt > RECOMPUTE_MS) compute();
    else render();
  }, 15000);
  ctx.tabs.onShow((id) => {
    if (id !== 'tabSatellites') return;
    if (!orbits.size || Date.now() - computedAt > RECOMPUTE_MS) loadOrbits();
    else render();
  });

  render();
  renderTracking();

  return {
    // What is being followed, for the readout and the logbook.
    tracking: () => (tracking ? { name: tracking.sat.name, uplink: tracking.sat.uplink, downlink: tracking.sat.downlink } : null),
    locationChanged: compute,
    load: loadOrbits,
  };
}
