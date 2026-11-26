// Wires the page to the radio: every control sends a command, every message
// from the radio updates what is on screen.

import { Radio } from './radio.js';
import { Scope } from './scope.js';
import { Speaker, Microphone } from './audio.js';
import { BANDS, KINDS, bandFor, segmentFor, markFor } from './bandplan.js';
import { setupTips } from './tips.js';
import { splitFrequency, formatMHz, formatDistance, formatTone, parseFrequency } from './format.js';
import { api, Kept } from './kept.js';
import { setupTabs } from './tabs.js';
import { setupRepeaters } from './repeaters.js';
import { setupScan } from './scan.js';
import { setupSecond } from './second.js';
import { setupSatellites } from './satellites.js';
import { setupLogbook } from './logbook.js';
import { setupMorse } from './morseui.js';
import { setupCheatsheets } from './cheatsheets.js';
import { modeLimitAt, sideOfLineA } from './reference.js';

const $ = (id) => document.getElementById(id);

const store = {
  get(key, fallback) {
    try {
      const raw = localStorage.getItem(`console.${key}`);
      return raw === null ? fallback : JSON.parse(raw);
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(`console.${key}`, JSON.stringify(value));
    } catch {
      /* private browsing: settings just won't be remembered */
    }
  },
};

// --------------------------------------------------------------- The parts

const radio = new Radio(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/`);
const speaker = new Speaker();
const mic = new Microphone();
const state = radio.state;

const scope = new Scope(
  {
    area: $('scope'),
    spectrum: $('spectrum'),
    waterfall: $('waterfall'),
    axis: $('axis'),
    marker: $('marker'),
    hover: $('hover'),
    hoverLabel: $('hoverLabel'),
  },
  {
    getStep: () => currentStep(),
    onPick: (freq) => setFrequency(freq),
    onTune: (direction) => tune(direction),
    onZoom: (direction) => zoom(direction),
  },
);

const tips = setupTips({ toggle: $('tipsToggle'), explain: $('explainButton') });
const tabs = setupTabs();

// Kept on the console's computer, so every device sees the same.
const settings = new Kept('settings', {});

let toastTimer = null;
function toast(text, ms = 6000) {
  const el = $('toast');
  el.textContent = text;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.hidden = true;
  }, ms);
}

// Sliders send while you drag; this keeps it to one command every 60 ms.
const sendTimers = {};
function sendThrottled(cmd, value) {
  clearTimeout(sendTimers[cmd]);
  sendTimers[cmd] = setTimeout(() => radio.send(cmd, { value }), 60);
}

// Commands the radio should apply in order, e.g. frequency before mode.
function sendInOrder(commands) {
  commands.forEach(([cmd, fields], i) => setTimeout(() => radio.send(cmd, fields), i * 120));
}

// ------------------------------------------------------------ Connection

let viaWfweb = false;

function renderLink() {
  const rig = radio.rigConnected;
  const transmitting = rig && !!state.transmitting;
  document.body.classList.toggle('offline', !rig);
  $('linkLamp').className = `lamp${rig ? (transmitting ? ' tx' : ' on') : ''}`;

  const model = (radio.info && radio.info.model) || 'Radio';
  $('rigName').textContent = model;
  document.title = `${model} console`;

  // Which program is talking to the radio decides what to say when it can't,
  // and whether there is a second control panel to link to (on this computer
  // only: its address means nothing from another device).
  if (radio.info) viaWfweb = !radio.info.direct;
  $('fullPanelLink').hidden = !viaWfweb || document.body.classList.contains('remote');

  let text;
  if (!radio.linkUp) text = 'The console program on this computer isn’t answering. Trying again…';
  else if (!rig && viaWfweb) text = 'wfweb is running, but the radio isn’t answering. Is it switched on?';
  else if (!rig) text = 'Can’t reach the radio. Is it switched on?';
  else if (state.powerState === false) text = 'The radio is switched off';
  else if (transmitting) text = 'Transmitting';
  else text = 'Connected';
  $('linkText').textContent = text;
  $('reconnectButton').hidden = !(radio.linkUp && !rig);
}

$('reconnectButton').addEventListener('click', () => {
  radio.send('reconnectLan');
  toast('Trying the radio again…', 3000);
});

// -------------------------------------------------------------- Frequency

const STEP_FAMILY_DEFAULT = { channel: 5000, fine: 100 };

function stepFamily(mode) {
  return ['FM', 'DV', 'DD', 'AM'].includes(mode) ? 'channel' : 'fine';
}

function currentStep() {
  return Number($('stepSelect').value) || 5000;
}

function renderStep() {
  const family = stepFamily(state.mode);
  const steps = store.get('steps', STEP_FAMILY_DEFAULT);
  $('stepSelect').value = String(steps[family] || STEP_FAMILY_DEFAULT[family]);
}

$('stepSelect').addEventListener('change', () => {
  const steps = store.get('steps', STEP_FAMILY_DEFAULT);
  store.set('steps', { ...steps, [stepFamily(state.mode)]: currentStep() });
});

function radioBands() {
  return (radio.info && radio.info.bands) || [];
}

function inRadioRange(hz) {
  return radioBands().some((b) => hz >= b.start && hz <= b.end);
}

function rangeText() {
  const parts = radioBands()
    .slice()
    .sort((a, b) => a.start - b.start)
    .map((b) => `${b.start / 1e6}–${b.end / 1e6}`);
  if (parts.length <= 1) return `${parts[0] || ''} MHz`;
  return `${parts.slice(0, -1).join(', ')} or ${parts[parts.length - 1]} MHz`;
}

// The frequency being listened to. While following a satellite that is the
// second receiver's; the main one is only the transmitter then.
function listenFrequency() {
  return state.satMode ? state.subFrequency : state.frequency;
}

function setFrequency(hz) {
  const target = Math.round(hz);
  if (!radio.rigConnected) return false;
  if (state.satMode) {
    const following = satellites.tracking();
    toast(
      following
        ? `The radio is following ${following.name}, which sets the frequency. Stop tracking to tune by hand.`
        : 'The radio is in satellite mode. Leave it to tune by hand.',
    );
    return false;
  }
  scan.stop(); // tuning by hand ends a scan
  if (!inRadioRange(target)) {
    toast(`${formatMHz(target)} MHz is outside what this radio covers (${rangeText()}).`);
    return false;
  }
  radio.send('setFrequency', { value: target });
  radio.merge({ frequency: target }); // show it now; the radio confirms shortly
  return true;
}

function tune(direction) {
  const f = state.frequency;
  if (!f) return;
  const step = currentStep();
  // From an off-grid frequency, the first press lands on the grid.
  const base = direction > 0 ? Math.floor(f / step) : Math.ceil(f / step);
  setFrequency((base + direction) * step);
}

$('tuneDown').addEventListener('click', () => tune(-1));
$('tuneUp').addEventListener('click', () => tune(1));

function renderFrequency() {
  const f = listenFrequency();
  if (!f) return;
  const { main, fine } = splitFrequency(f);
  $('freqMain').textContent = main;
  $('freqFine').textContent = fine;
  scope.setFrequency(state.frequency); // the band display is the main receiver's
  renderWhere();
  renderBandmap();
  renderBandButtons();
  renderRepeater();
  renderFavorites();
  rememberBandSpot();
  repeaters.render();
  scan.render();
}

function openFrequencyForm() {
  $('freqButton').hidden = true;
  $('freqForm').hidden = false;
  $('freqError').textContent = '';
  const input = $('freqInput');
  input.value = state.frequency ? formatMHz(state.frequency) : '';
  input.focus();
  input.select();
}

function closeFrequencyForm() {
  $('freqForm').hidden = true;
  $('freqButton').hidden = false;
}

$('freqButton').addEventListener('click', openFrequencyForm);
$('freqCancel').addEventListener('click', closeFrequencyForm);
$('freqInput').addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeFrequencyForm();
});
$('freqForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const hz = parseFrequency($('freqInput').value);
  if (!Number.isFinite(hz)) {
    $('freqError').textContent = 'Type a frequency in MHz, such as 146.520.';
    return;
  }
  if (!inRadioRange(hz)) {
    $('freqError').textContent = `This radio covers ${rangeText()}.`;
    return;
  }
  setFrequency(hz);
  closeFrequencyForm();
});

function renderWhere() {
  const f = listenFrequency();
  const el = $('whereLine');
  const strong = document.createElement('strong');
  let rest = '';
  const band = bandFor(f);
  const seg = segmentFor(f);
  const mark = markFor(f);
  const known = repeaters.at(f);
  if (state.satMode) {
    const following = satellites.tracking();
    strong.textContent = following ? `${following.name}’s downlink.` : 'Satellite downlink.';
    rest = ' The frequency a satellite transmits on. The radio’s second receiver is listening here.';
  } else if (!band) {
    strong.textContent = 'Outside the amateur bands.';
  } else if (known) {
    strong.textContent = `${known.name} repeater${known.place ? `, ${known.place}` : ''}.`;
    rest = seg ? ` ${KINDS[seg.kind].line}` : '';
  } else if (mark) {
    strong.textContent = `${mark.label}.`;
    rest = ' A meeting place: make contact here, then move elsewhere to chat.';
  } else if (seg) {
    strong.textContent = `${seg.label}.`;
    rest = ` ${KINDS[seg.kind].line}`;
  } else {
    strong.textContent = `${band.name} band.`;
    rest = ' Nothing in particular is set aside for this spot.';
  }
  el.replaceChildren(strong, document.createTextNode(rest));
}

// --------------------------------------------------------------- Band map

let bandmapBandId = null;

function buildBandmap(band) {
  bandmapBandId = band.id;
  const width = band.end - band.start;
  const pct = (hz) => `${(((hz - band.start) / width) * 100).toFixed(3)}%`;
  const frag = document.createDocumentFragment();

  for (const seg of band.segments) {
    const el = document.createElement('div');
    el.className = 'bandmap-segment';
    el.dataset.kind = seg.kind;
    el.style.left = pct(seg.start);
    el.style.width = `${(((seg.end - seg.start) / width) * 100).toFixed(3)}%`;
    el.dataset.tipTitle = `${seg.label}, ${formatMHz(seg.start, 1)} to ${formatMHz(seg.end, 1)} MHz`;
    el.dataset.tipBody = KINDS[seg.kind].tip;
    frag.appendChild(el);
  }
  for (const mark of band.marks) {
    const el = document.createElement('div');
    el.className = 'bandmap-mark';
    el.style.left = pct(mark.freq);
    el.dataset.freq = String(mark.freq);
    el.dataset.tipTitle = `${mark.label}, ${formatMHz(mark.freq)} MHz`;
    el.dataset.tipBody =
      'A meeting place everyone knows. Make contact here, then agree on another frequency and move there to chat. Click to tune to it.';
    frag.appendChild(el);
  }
  $('bandmapSegments').replaceChildren(frag);

  $('bandmapStart').textContent = `${band.start / 1e6} MHz`;
  $('bandmapEnd').textContent = `${band.end / 1e6} MHz`;

  const kinds = [...new Set(band.segments.map((s) => s.kind))];
  $('bandmapLegend').replaceChildren(
    ...kinds.map((kind) => {
      const li = document.createElement('li');
      const dot = document.createElement('i');
      dot.style.background = `var(--kind-${kind})`;
      li.append(dot, KINDS[kind].name);
      return li;
    }),
  );
}

function renderBandmap() {
  const f = listenFrequency();
  const band = bandFor(f);
  const pin = $('bandmapPin');
  const win = $('bandmapWindow');
  if (!band) {
    pin.hidden = true;
    win.hidden = true;
    return;
  }
  if (band.id !== bandmapBandId) buildBandmap(band);
  const width = band.end - band.start;
  pin.hidden = false;
  pin.style.left = `${(((f - band.start) / width) * 100).toFixed(3)}%`;

  // The slice of band the waterfall is showing.
  const a = Math.max(scope.start, band.start);
  const b = Math.min(scope.end, band.end);
  if (scope.span > 0 && b > a) {
    win.hidden = false;
    win.style.left = `${(((a - band.start) / width) * 100).toFixed(3)}%`;
    win.style.width = `${(((b - a) / width) * 100).toFixed(3)}%`;
  } else {
    win.hidden = true;
  }
}

$('bandmap').addEventListener('click', (e) => {
  const band = BANDS.find((b) => b.id === bandmapBandId);
  if (!band) return;
  const mark = e.target.closest('.bandmap-mark');
  if (mark) {
    setFrequency(Number(mark.dataset.freq));
    return;
  }
  const rect = $('bandmap').getBoundingClientRect();
  const x = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
  // The map is coarse (a pixel is several kHz), so land on a tidy channel.
  const step = Math.max(currentStep(), 5000);
  setFrequency(Math.round((band.start + x * (band.end - band.start)) / step) * step);
});

// ------------------------------------------------------------------ Bands

function availableBands() {
  return BANDS.filter((band) => radioBands().some((b) => b.start <= band.start && b.end >= band.end));
}

function rememberBandSpot() {
  const band = bandFor(state.frequency);
  if (!band || !state.mode || state.satMode) return;
  const memory = store.get('bandMemory', {});
  memory[band.id] = { freq: state.frequency, mode: state.mode };
  store.set('bandMemory', memory);
}

function buildBandButtons() {
  $('bandButtons').replaceChildren(
    ...availableBands().map((band) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = band.name;
      b.dataset.band = band.id;
      b.dataset.tip = `band-${band.id}`;
      b.addEventListener('click', () => {
        if (bandFor(state.frequency) === band) return;
        // Back to where you last were on that band, or its calling frequency.
        const spot = store.get('bandMemory', {})[band.id] || band.calling;
        if (!setFrequency(spot.freq)) return;
        if (spot.mode && spot.mode !== state.mode) {
          setTimeout(() => setMode(spot.mode), 150);
        }
      });
      return b;
    }),
  );
  renderBandButtons();
}

function renderBandButtons() {
  const current = bandFor(state.frequency);
  for (const b of $('bandButtons').children) {
    b.setAttribute('aria-pressed', String(!!current && b.dataset.band === current.id));
  }
}

// ------------------------------------------------------------------ Modes

const MAIN_MODES = ['FM', 'DV', 'USB', 'LSB', 'CW', 'AM'];

function setMode(mode) {
  radio.send('setMode', { value: mode });
  radio.merge({ mode });
}

function buildModeButtons() {
  const modes = (radio.info && radio.info.modes) || [];
  $('modeButtons').replaceChildren(
    ...MAIN_MODES.filter((m) => modes.includes(m)).map((mode) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = mode;
      b.dataset.mode = mode;
      b.dataset.tip = `mode-${mode}`;
      b.addEventListener('click', () => setMode(mode));
      return b;
    }),
  );
  const more = $('moreModes');
  const extra = modes.filter((m) => !MAIN_MODES.includes(m));
  more.replaceChildren(new Option('More…', ''), ...extra.map((m) => new Option(m, m)));
  more.parentElement.hidden = extra.length === 0;
  renderMode();
}

$('moreModes').addEventListener('change', (e) => {
  if (e.target.value) setMode(e.target.value);
});

function renderMode() {
  for (const b of $('modeButtons').children) {
    b.setAttribute('aria-pressed', String(b.dataset.mode === state.mode));
  }
  const more = $('moreModes');
  const isExtra = [...more.options].some((o) => o.value && o.value === state.mode);
  more.value = isExtra ? state.mode : '';
  more.classList.toggle('chosen', isExtra);
  renderStep();
  rememberBandSpot();
  renderRepeater();
}

// --------------------------------------------------------------- Repeater

const DISTANCES = [600e3, 1e6, 5e6, 12e6, 20e6];

function usualDistance(freq) {
  const band = bandFor(freq);
  if (!band) return 600e3;
  return { '2m': 600e3, '70cm': 5e6, '23cm': 12e6 }[band.id] || 600e3;
}

function buildToneOptions() {
  const tones = (radio.info && radio.info.ctcssTones) || [];
  $('toneSelect').replaceChildren(...tones.map((t) => new Option(formatTone(t), String(t))));
}

for (const b of $('shiftButtons').children) {
  b.addEventListener('click', () => {
    const shift = b.dataset.shift;
    if (shift !== 'OFF' && !state.duplexOffset) {
      // A shift of zero would transmit on top of the repeater's output.
      const distance = usualDistance(state.frequency);
      radio.send('setDuplexOffset', { value: distance });
      radio.merge({ duplexOffset: distance });
    }
    radio.send('setDuplex', { value: shift });
    radio.merge({ duplex: shift });
  });
}

$('offsetSelect').addEventListener('change', (e) => {
  const value = Number(e.target.value);
  radio.send('setDuplexOffset', { value });
  radio.merge({ duplexOffset: value });
});

for (const b of $('toneButtons').children) {
  b.addEventListener('click', () => {
    radio.send('setToneMode', { value: b.dataset.tone });
    radio.merge({ toneMode: b.dataset.tone });
  });
}

$('toneSelect').addEventListener('change', (e) => {
  const value = Number(e.target.value);
  // Keep the "send" and "require" tones the same: one number to think about.
  sendInOrder([
    ['setToneFreq', { value }],
    ['setTsqlFreq', { value }],
  ]);
  radio.merge({ toneFreq: value, tsqlFreq: value });
});

$('usualButton').addEventListener('click', () => {
  // A repeater from the imported list beats the band's general custom.
  const known = repeaters.at(state.frequency);
  if (known && needsSettings(known)) {
    recallFavorite(known);
    return;
  }
  const seg = segmentFor(state.frequency);
  if (!seg || !seg.usual) return;
  sendInOrder([
    ['setDuplexOffset', { value: seg.usual.offset }],
    ['setDuplex', { value: seg.usual.duplex }],
  ]);
  radio.merge({ duplexOffset: seg.usual.offset, duplex: seg.usual.duplex });
});

// True if `hz` is in the part of 70 centimeters that is closed to stations
// near the Canadian border, and the saved location is such a place.
function closedByLineA(hz) {
  if (hz < 420e6 || hz >= 430e6) return false;
  const here = settings.value && settings.value.location;
  return !!here && Number.isFinite(here.lat) && sideOfLineA(here.lat, here.lon) === 'north';
}

// True if the radio is not set the way this repeater needs.
function needsSettings(r) {
  const offset = state.duplexOffset || 0;
  const shift = state.duplex || 'OFF';
  if (shift !== r.duplex || (r.duplex !== 'OFF' && offset !== r.offset)) return true;
  if (r.toneMode === 'OFF') return false;
  return (state.toneMode || 'OFF') !== r.toneMode || (r.toneMode === 'TSQL' ? state.tsqlFreq : state.toneFreq) !== r.tone;
}

function transmitFrequency() {
  const f = state.frequency;
  if (state.duplex === 'DUP-') return f - (state.duplexOffset || 0);
  if (state.duplex === 'DUP+') return f + (state.duplexOffset || 0);
  return f;
}

function renderRepeater() {
  const shift = state.duplex || 'OFF';
  for (const b of $('shiftButtons').children) {
    b.setAttribute('aria-pressed', String(b.dataset.shift === shift));
  }

  const select = $('offsetSelect');
  const offset = state.duplexOffset || 0;
  const options = DISTANCES.includes(offset) || !offset ? DISTANCES : [...DISTANCES, offset].sort((a, b) => a - b);
  if (select.dataset.options !== options.join()) {
    select.dataset.options = options.join();
    select.replaceChildren(...options.map((hz) => new Option(formatDistance(hz), String(hz))));
  }
  if (document.activeElement !== select) select.value = String(offset || usualDistance(state.frequency));
  select.closest('.labelled').classList.toggle('dim', shift === 'OFF');

  const toneMode = state.toneMode || 'OFF';
  for (const b of $('toneButtons').children) {
    b.setAttribute('aria-pressed', String(b.dataset.tone === toneMode));
  }
  const toneSelect = $('toneSelect');
  const tone = toneMode === 'TSQL' ? state.tsqlFreq : state.toneFreq;
  if (tone && document.activeElement !== toneSelect) toneSelect.value = String(tone);
  toneSelect.closest('.labelled').classList.toggle('dim', toneMode === 'OFF');

  // Where a transmission would actually go.
  const line = $('txLine');
  const f = state.frequency;
  line.classList.remove('warn');
  if (!f) {
    line.textContent = '';
  } else if (state.satMode) {
    const strong = document.createElement('strong');
    strong.textContent = `${formatMHz(f, 4)} MHz`;
    line.replaceChildren('You transmit on ', strong, ', the satellite’s uplink, while listening on another band.');
  } else if (modeLimitAt(transmitFrequency(), state.mode)) {
    // A stretch of band where the rules allow only some modes.
    line.classList.add('warn');
    line.textContent = `${modeLimitAt(transmitFrequency(), state.mode).text} Change mode or move before you transmit.`;
  } else if (closedByLineA(transmitFrequency())) {
    line.classList.add('warn');
    line.textContent = 'From the location you saved, north of “Line A”, US rules do not allow transmitting between 420 and 430 MHz. Listening is fine.';
  } else if (shift === 'OFF') {
    line.textContent = 'You transmit on the same frequency you listen to.';
  } else {
    const tx = transmitFrequency();
    const strong = document.createElement('strong');
    strong.textContent = `${formatMHz(tx)} MHz`;
    const where = shift === 'DUP-' ? 'below' : 'above';
    if (inRadioRange(tx)) {
      line.replaceChildren('You transmit on ', strong, `, ${formatDistance(offset)} ${where} where you listen.`);
    } else {
      line.classList.add('warn');
      line.replaceChildren('That shift would put your transmission on ', strong, ', outside the band. Check the shift.');
    }
  }

  const usual = $('usualButton');
  const seg = segmentFor(f);
  const fmLike = ['FM', 'DV'].includes(state.mode);
  const want = seg && seg.usual;
  const known = state.satMode ? null : repeaters.at(f);
  if (state.satMode) {
    usual.hidden = true;
  } else if (known && needsSettings(known)) {
    const bits = [];
    if (known.duplex !== 'OFF') bits.push(`shift ${known.duplex === 'DUP-' ? '−' : '+'}, ${formatDistance(known.offset)}`);
    else bits.push('no shift');
    if (known.toneMode !== 'OFF') bits.push(`tone ${formatTone(known.tone)}`);
    usual.textContent = `Use ${known.name}’s settings (${bits.join(', ')})`;
    usual.hidden = false;
  } else if (want && fmLike && (shift !== want.duplex || offset !== want.offset)) {
    const sign = want.duplex === 'DUP-' ? '−' : '+';
    usual.textContent = `Use the usual repeater settings here (shift ${sign}, ${formatDistance(want.offset)})`;
    usual.hidden = false;
  } else {
    usual.hidden = true;
  }
}

// -------------------------------------------------------------- Favorites

const STARTER_FAVORITES = [
  { name: '2 m calling', freq: 146520000, mode: 'FM', starter: true },
  { name: '70 cm calling', freq: 446000000, mode: 'FM', starter: true },
  { name: '2 m sideband', freq: 144200000, mode: 'USB', starter: true },
  { name: '23 cm calling', freq: 1294500000, mode: 'FM', starter: true },
].map((f) => ({ duplex: 'OFF', offset: 0, toneMode: 'OFF', tone: 0, ...f }));

const keptFavorites = new Kept('favorites', STARTER_FAVORITES);

function favorites() {
  return keptFavorites.value || STARTER_FAVORITES;
}

function saveFavorites(list) {
  keptFavorites.save(list).catch((err) => toast(`Couldn’t save your favorites: ${err.message}`));
}

function describeFavorite(fav) {
  const parts = [`${formatMHz(fav.freq)} MHz`, fav.mode];
  if (fav.duplex && fav.duplex !== 'OFF') {
    parts.push(`shift ${fav.duplex === 'DUP-' ? '−' : '+'} ${formatDistance(fav.offset)}`);
  }
  if (fav.toneMode && fav.toneMode !== 'OFF' && fav.tone) parts.push(`tone ${formatTone(fav.tone)}`);
  return `${parts.join(', ')}. Click to go there.`;
}

// Goes to a saved frequency (a favorite, or a repeater from the list) and
// sets its mode, shift and tone.
function recallFavorite(fav, { quiet = false } = {}) {
  if (quiet) {
    // Already tuned there by a scan: only the settings are needed.
    if (state.frequency !== fav.freq) return;
  } else if (!setFrequency(fav.freq)) return;
  const commands = [['setMode', { value: fav.mode }]];
  if (fav.duplex && fav.duplex !== 'OFF' && fav.offset) commands.push(['setDuplexOffset', { value: fav.offset }]);
  commands.push(['setDuplex', { value: fav.duplex || 'OFF' }]);
  if (fav.toneMode && fav.toneMode !== 'OFF' && fav.tone) {
    commands.push(['setToneFreq', { value: fav.tone }], ['setTsqlFreq', { value: fav.tone }]);
  }
  commands.push(['setToneMode', { value: fav.toneMode || 'OFF' }]);
  // The frequency goes first and gets a moment to land, since changing band
  // also changes which mode and shift the radio is holding.
  setTimeout(() => sendInOrder(commands), 150);
}

function renderFavorites() {
  const list = favorites().filter((fav) => inRadioRange(fav.freq));
  $('favorites').replaceChildren(
    ...list.map((fav) => {
      const li = document.createElement('li');
      li.className = 'favorite';
      li.classList.toggle('current', fav.freq === state.frequency);

      const go = document.createElement('button');
      go.type = 'button';
      go.className = 'favorite-go';
      const name = document.createElement('span');
      name.className = 'favorite-name';
      name.textContent = fav.name;
      const freq = document.createElement('span');
      freq.className = 'favorite-freq';
      freq.textContent = formatMHz(fav.freq);
      go.append(name, freq);
      if (fav.starter) {
        go.dataset.tip = 'calling';
      } else {
        go.dataset.tipTitle = fav.name;
        go.dataset.tipBody = describeFavorite(fav);
      }
      go.addEventListener('click', () => recallFavorite(fav));

      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'favorite-remove';
      remove.textContent = '×';
      remove.setAttribute('aria-label', `Remove ${fav.name}`);
      remove.addEventListener('click', () => {
        saveFavorites(favorites().filter((x) => !(x.name === fav.name && x.freq === fav.freq)));
        renderFavorites();
      });

      li.append(go, remove);
      return li;
    }),
  );
}

$('saveFavorite').addEventListener('click', () => {
  $('saveFavorite').hidden = true;
  $('favoriteForm').hidden = false;
  const input = $('favoriteName');
  input.value = '';
  input.focus();
});

function closeFavoriteForm() {
  $('favoriteForm').hidden = true;
  $('saveFavorite').hidden = false;
}

$('favoriteCancel').addEventListener('click', closeFavoriteForm);
$('favoriteName').addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeFavoriteForm();
});
$('favoriteForm').addEventListener('submit', (e) => {
  e.preventDefault();
  if (!state.frequency) return;
  const toneMode = ['TONE', 'TSQL'].includes(state.toneMode) ? state.toneMode : 'OFF';
  const fav = {
    name: $('favoriteName').value.trim() || `${formatMHz(state.frequency)} MHz`,
    freq: state.frequency,
    mode: state.mode || 'FM',
    duplex: state.duplex || 'OFF',
    offset: state.duplexOffset || 0,
    toneMode,
    tone: toneMode === 'TSQL' ? state.tsqlFreq : state.toneFreq,
  };
  saveFavorites([...favorites().filter((x) => !(x.name === fav.name && x.freq === fav.freq)), fav]);
  closeFavoriteForm();
  renderFavorites();
});

// ------------------------------------------------------------------- Zoom

function spans() {
  return (radio.info && radio.info.spans) || [];
}

// direction: +1 zooms in (narrower slice), -1 zooms out.
function zoom(direction) {
  const list = spans();
  if (!list.length || state.spanIndex === undefined) return;
  const next = Math.max(0, Math.min(list.length - 1, state.spanIndex - direction));
  if (next === state.spanIndex) return;
  // Zoom is "this much either side of my frequency", which is the radio's
  // center mode. Switch to it if the radio was left in another scope mode.
  if (state.scopeMode !== 0) {
    radio.send('setScopeMode', { value: 0 });
    radio.merge({ scopeMode: 0 });
  }
  radio.send('setSpan', { value: next });
  radio.merge({ spanIndex: next });
}

$('zoomIn').addEventListener('click', () => zoom(1));
$('zoomOut').addEventListener('click', () => zoom(-1));

function renderZoom() {
  const list = spans();
  const span = list[state.spanIndex];
  $('zoomLabel').textContent = span ? `Showing ${formatDistance(span.freq * 2)}` : 'Zoom';
  $('zoomIn').disabled = !span || state.spanIndex <= 0;
  $('zoomOut').disabled = !span || state.spanIndex >= list.length - 1;
}

// ----------------------------------------------------------------- Listen

function renderListen() {
  const on = speaker.running;
  const button = $('listenButton');
  button.textContent = on ? 'Stop listening' : 'Start listening';
  button.classList.toggle('active', on);
}

$('listenButton').addEventListener('click', async () => {
  if (speaker.running) {
    speaker.stop();
    syncAudio();
    renderListen();
    return;
  }
  if (radio.info && radio.info.audioAvailable === false) {
    toast('The radio isn’t sending sound over the network right now.');
    return;
  }
  try {
    await speaker.start((radio.info && radio.info.audioSampleRate) || 48000);
    speaker.setVolume($('volume').value / 100);
    syncAudio();
  } catch (err) {
    toast(`Couldn’t start sound: ${err.message}`);
  }
  renderListen();
});

$('volume').value = String(store.get('volume', 80));
function renderVolume() {
  const v = Number($('volume').value);
  $('volumeText').textContent = `${v}%`;
  speaker.setVolume(v / 100);
}
$('volume').addEventListener('input', () => {
  store.set('volume', Number($('volume').value));
  renderVolume();
});
renderVolume();

function percentOf255(v) {
  return `${Math.round((v / 255) * 100)}%`;
}

$('squelch').addEventListener('input', (e) => {
  const value = Number(e.target.value);
  $('squelchText').textContent = value === 0 ? 'Open' : percentOf255(value);
  // While following a satellite, the receiver in use is the second one.
  if (state.satMode) {
    sendThrottled('setSubSquelch', value);
    state.subSquelch = value;
  } else {
    sendThrottled('setSquelch', value);
    state.squelch = value;
  }
});

function renderSquelch() {
  const value = state.satMode ? state.subSquelch : state.squelch;
  if (value === undefined) return;
  if (document.activeElement !== $('squelch')) $('squelch').value = String(value);
  $('squelchText').textContent = value === 0 ? 'Open' : percentOf255(value);
}

// The meter value is decibels relative to S9: -54 is S0, 0 is S9.
function renderSignal() {
  const v = state.satMode ? state.subSMeter : state.sMeter;
  if (v === undefined || state.transmitting) {
    $('signalText').textContent = state.transmitting ? 'Transmitting' : 'No reading';
    $('signalFill').style.width = '0%';
    return;
  }
  const units = Math.max(0, Math.min(9, Math.round((v + 54) / 6)));
  let reading;
  let words;
  if (v > 2) {
    reading = `S9+${Math.round(v / 5) * 5}`;
    words = 'very strong';
  } else {
    reading = `S${units}`;
    words = units <= 1 ? 'nothing there' : units <= 4 ? 'weak' : units <= 7 ? 'good' : 'strong';
  }
  $('signalText').textContent = `${reading}, ${words}`;
  $('signalFill').style.width = `${Math.max(0, Math.min(100, ((v + 54) / 114) * 100)).toFixed(1)}%`;
}

$('preampButton').addEventListener('click', () => {
  const value = state.preamp ? 0 : 1;
  radio.send('setPreamp', { value });
  radio.merge({ preamp: value });
});

$('nrButton').addEventListener('click', () => {
  const value = !state.nr;
  radio.send('setNoiseReduction', { value });
  radio.merge({ nr: value });
});

function renderToggles() {
  $('preampButton').setAttribute('aria-pressed', String(!!state.preamp));
  $('nrButton').setAttribute('aria-pressed', String(!!state.nr));
}

// ------------------------------------------------------------------- Talk

const TALK_LIMIT_MS = 3 * 60 * 1000; // most repeaters cut you off at about this
const TALK_TAIL_MS = 300; // lets the last word leave before unkeying

const talk = { held: false, sending: false, tailTimer: null, limitTimer: null };

mic.onBlock = (pcm) => {
  if (talk.sending) radio.sendMicAudio(pcm);
};

$('micButton').addEventListener('click', async () => {
  try {
    await mic.start();
  } catch (err) {
    if (err.name === 'NotAllowedError') {
      toast('Microphone access was blocked. Allow it from the icon in the address bar, then try again.');
    } else if (err.name === 'NotFoundError') {
      toast('No microphone was found on this computer.');
    } else {
      toast(`Couldn’t start the microphone: ${err.message}`);
    }
    return;
  }
  radio.send('enableMic', { value: true, device: mic.label });
  renderTalk();
});

function talkDown() {
  if (talk.held || !mic.ready || !radio.rigConnected) return;
  scan.stop();
  clearTimeout(talk.tailTimer);
  talk.held = true;
  talk.sending = true;
  radio.send('setPTT', { value: true });
  talk.limitTimer = setTimeout(() => {
    talkUp(true);
    toast('Stopped transmitting after 3 minutes. Press again to carry on.');
  }, TALK_LIMIT_MS);
  renderTalk();
}

function talkUp(immediately = false) {
  if (!talk.held) return;
  talk.held = false;
  clearTimeout(talk.limitTimer);
  const unkey = () => {
    talk.sending = false;
    radio.send('setPTT', { value: false });
    renderTalk();
  };
  clearTimeout(talk.tailTimer);
  if (immediately) unkey();
  else talk.tailTimer = setTimeout(unkey, TALK_TAIL_MS);
  renderTalk();
}

$('pttButton').addEventListener('pointerdown', (e) => {
  if (e.button !== 0) return;
  e.preventDefault();
  talkDown();
});
document.addEventListener('pointerup', () => talkUp());
document.addEventListener('pointercancel', () => talkUp(true));
// Never leave the transmitter keyed because the page lost attention.
window.addEventListener('blur', () => talkUp(true));
document.addEventListener('visibilitychange', () => {
  if (document.hidden) talkUp(true);
});
window.addEventListener('pagehide', () => {
  if (talk.sending) radio.send('setPTT', { value: false });
});

function describeSwr(swr) {
  if (!swr || swr < 1) return '–';
  const words = swr < 1.5 ? 'good' : swr < 2 ? 'fair' : 'poor, check antenna';
  return `${swr.toFixed(1)}, ${words}`;
}

function renderTalk() {
  const ready = mic.ready;
  $('talkSetup').hidden = ready;
  $('talkReady').hidden = !ready;
  if (ready) $('micName').textContent = mic.label.replace(/\s*\(.*?\)\s*$/, '') || 'Default microphone';

  const onAir = !!state.transmitting;
  const keyed = talk.held || talk.sending || onAir;
  $('pttButton').classList.toggle('keyed', keyed);
  if (onAir) {
    $('pttMain').textContent = 'On the air';
    $('pttSub').textContent = 'let go to listen';
  } else if (keyed) {
    $('pttMain').textContent = talk.held ? 'Keying…' : 'Finishing…';
    $('pttSub').textContent = '';
  } else {
    $('pttMain').textContent = 'Hold to talk';
    $('pttSub').textContent = 'or hold the space bar';
  }

  $('txMeters').hidden = !onAir;
  if (onAir) {
    $('txPowerText').textContent = `${Math.round(state.powerMeter || 0)} W`;
    $('swrText').textContent = describeSwr(state.swrMeter);
  }

  // Your own voice would come back late through the speaker otherwise.
  speaker.setMuted(talk.sending || onAir);
  renderLink();
  renderSignal();
}

$('power').addEventListener('input', (e) => {
  const value = Number(e.target.value);
  $('powerText').textContent = percentOf255(value);
  sendThrottled('setRfPower', value);
  state.rfPower = value;
});

function renderPower() {
  if (state.rfPower === undefined) return;
  if (document.activeElement !== $('power')) $('power').value = String(state.rfPower);
  $('powerText').textContent = percentOf255(state.rfPower);
}

// Microphone level bar: jumps up with your voice, falls back smoothly.
let micShown = 0;
function drawMicLevel() {
  if (mic.ready) {
    micShown = Math.max(mic.level, micShown * 0.9);
    $('micFill').style.width = `${Math.min(100, micShown * 140).toFixed(1)}%`;
  }
  requestAnimationFrame(drawMicLevel);
}
requestAnimationFrame(drawMicLevel);

// --------------------------------------------------------------- Keyboard

function isTextEntry(el) {
  return el instanceof HTMLSelectElement || el instanceof HTMLTextAreaElement || (el instanceof HTMLInputElement && el.type !== 'range');
}

// A button reached with Tab should still be pressed by the space bar; one
// that merely kept focus after a mouse click should not swallow push-to-talk.
function isKeyboardFocusedControl(el) {
  return el instanceof Element && el.matches('button, a, summary, [role="button"]') && el.matches(':focus-visible');
}

document.addEventListener('keydown', (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const target = e.target;
  if (isTextEntry(target)) return;

  if (e.code === 'Space') {
    if (!mic.ready || isKeyboardFocusedControl(target)) return;
    e.preventDefault();
    if (!e.repeat) talkDown();
    return;
  }
  if (target instanceof HTMLInputElement) return; // sliders use the arrows
  if (e.key === 'ArrowLeft') {
    e.preventDefault();
    tune(-1);
  } else if (e.key === 'ArrowRight') {
    e.preventDefault();
    tune(1);
  }
});

document.addEventListener('keyup', (e) => {
  if (e.code === 'Space' && talk.held) {
    e.preventDefault();
    talkUp();
  }
});

// ------------------------------------------------- Repeaters, scan and more

// The imported repeater list changed, or the place distances are from did.
function renderDirectory() {
  renderWhere();
  renderRepeater();
  repeaters.render();
  scan.render();
}

// Satellite tracking started or stopped: several readouts change meaning.
function renderSatelliteState() {
  renderFrequency();
  renderSquelch();
  renderSignal();
  // The band display stays with the main receiver, which is the transmitter
  // then, so it shows a different band from the readout above it.
  $('spectrumTag').textContent = state.satMode ? 'Spectrum, uplink band' : 'Spectrum';
}

const repeaters = setupRepeaters({ $, radio, state, toast, recall: recallFavorite, inRadioRange, settings, listenFrequency, onChange: renderDirectory });
const scan = setupScan({ $, radio, state, toast, recall: recallFavorite, favorites, repeaters, currentStep, inRadioRange });
const second = setupSecond({ $, radio, state, speaker, store, toast, inRadioRange, rangeText });
const satellites = setupSatellites({ $, radio, state, toast, settings, tabs, onChange: renderSatelliteState });
const logbook = setupLogbook({
  $,
  radio,
  state,
  toast,
  settings,
  tabs,
  // A satellite contact is logged on the satellite's published frequency,
  // not the shifted one the radio happens to be on.
  listening: () => {
    const following = satellites.tracking();
    return { freq: following ? following.downlink : listenFrequency(), mode: state.satMode ? state.subMode || state.mode : state.mode };
  },
  tracking: () => satellites.tracking(),
});

// The radio's sound is asked for when something here wants it: the speaker,
// or the Morse reader, which can work with the speaker off.
function syncAudio() {
  radio.send('enableAudio', { value: speaker.running || morse.running });
}

const morse = setupMorse({ $, radio, toast, syncAudio });
// The call sign is shown in the Logbook tab too, and where you are decides
// what the transmit line warns about.
const sheets = setupCheatsheets({
  $,
  settings,
  toast,
  onProfile: () => {
    logbook.showMyCall();
    renderRepeater();
  },
});
// The sheets quote your call sign, which may have been entered since.
tabs.onShow((id) => {
  if (id === 'tabSheets') sheets.render();
});

settings.load().then(() => {
  sheets.render();
  logbook.showMyCall();
  repeaters.render();
  satellites.locationChanged();
  if (settings.value && settings.value.location) satellites.load();
});
keptFavorites.load().then(() => renderFavorites());

// ------------------------------------------------------ Phones and tablets

function fillPhoneHelp(phone) {
  const body = $('phoneBody');
  const p = (...content) => {
    const el = document.createElement('p');
    el.append(...content);
    return el;
  };
  const code = (text) => {
    const el = document.createElement('code');
    el.textContent = text;
    return el;
  };
  if (phone.enabled && phone.urls.length) {
    const address = document.createElement('span');
    address.className = 'address';
    address.textContent = phone.urls[0];
    const steps = document.createElement('ol');
    for (const text of [
      'Put the phone on the same Wi-Fi as this computer and open that address in its browser.',
      'The browser will warn that it does not know the certificate. That is expected: this computer made its own. Choose to carry on (on an iPhone, “Show Details”, then “visit this website”; on Android, “Advanced”, then “Proceed”).',
      'Type the password you set as PHONE_PASS in radio.conf.',
    ]) {
      const li = document.createElement('li');
      li.textContent = text;
      steps.append(li);
    }
    body.replaceChildren(
      p('On the phone or tablet, open:'),
      address,
      steps,
      p('If sound or the microphone won’t start on the phone, install this console’s certificate: the sign-in page has a link and the steps.'),
      ...(phone.urls.length > 1 ? [p('This computer also answers at ', code(phone.urls.slice(1).join('  ')), '.')] : []),
    );
  } else {
    const steps = document.createElement('ol');
    const items = [
      ['Open ', code('radio.conf'), ' (next to start.sh) in a text editor.'],
      ['Add a line with a password of your own, at least 8 characters: ', code("PHONE_PASS='…'")],
      ['Stop the console and start it again, then come back here for the address to open.'],
    ];
    for (const parts of items) {
      const li = document.createElement('li');
      li.append(...parts);
      steps.append(li);
    }
    body.replaceChildren(
      p('Phone access is switched off. A phone needs a secure (HTTPS) connection before its browser allows sound and the microphone, and a password, because whoever opens the page can key your transmitter.'),
      steps,
    );
  }
}

api('GET', 'api/whoami')
  .then((who) => {
    if (who.remote) {
      // Reached from another device: there is something to sign out of.
      $('signOutButton').hidden = false;
      $('signOutButton').addEventListener('click', async () => {
        await api('POST', 'api/logout', {}).catch(() => {});
        location.href = 'login.html';
      });
      document.body.classList.add('remote');
    } else {
      $('phoneButton').hidden = false;
      $('phoneButton').addEventListener('click', async () => {
        const fresh = await api('GET', 'api/whoami').catch(() => who);
        fillPhoneHelp(fresh.phone);
        $('phoneDialog').showModal();
      });
    }
  })
  .catch(() => {});

// ----------------------------------------------------------- Radio events

const RENDERERS = [
  [['frequency', 'subFrequency', 'satMode'], renderFrequency],
  [['mode'], renderMode],
  [['duplex', 'duplexOffset', 'toneMode', 'toneFreq', 'tsqlFreq', 'satMode'], renderRepeater],
  [['spanIndex'], renderZoom],
  [['sMeter', 'subSMeter', 'satMode'], renderSignal],
  [['squelch', 'subSquelch', 'satMode'], renderSquelch],
  [['rfPower'], renderPower],
  [['preamp', 'nr'], renderToggles],
  [['transmitting', 'powerMeter', 'swrMeter'], renderTalk],
  [['powerState', 'lanConnected'], renderLink],
];

function renderChanged(changed) {
  for (const [keys, fn] of RENDERERS) {
    if (keys.some((k) => k in changed)) fn();
  }
}

function renderEverything() {
  for (const [, fn] of RENDERERS) fn();
  renderFavorites();
  renderListen();
  repeaters.render();
  scan.render();
}

radio.addEventListener('link', () => {
  if (!radio.linkUp) {
    // The server drops the transmitter itself when a client vanishes.
    talk.held = false;
    talk.sending = false;
    clearTimeout(talk.limitTimer);
    clearTimeout(talk.tailTimer);
    state.transmitting = false;
    scope.clear();
  }
  renderLink();
  renderTalk();
});

radio.addEventListener('info', () => {
  renderLink();
  if (!radio.rigConnected) return;
  buildBandButtons();
  buildModeButtons();
  buildToneOptions();
  renderEverything();
  // After a reconnect, turn sound and microphone back on at the server.
  syncAudio();
  if (mic.ready) radio.send('enableMic', { value: true, device: mic.label });
});

radio.addEventListener('state', (e) => renderChanged(e.detail));
let lastSweepAt = 0;
radio.addEventListener('spectrum', (e) => {
  lastSweepAt = Date.now();
  scope.push(e.detail);
  renderBandmap();
});

// Connected, but the band display has stopped arriving: say so rather than
// leave a frozen picture.
setInterval(() => {
  const stalled = radio.rigConnected && lastSweepAt > 0 && Date.now() - lastSweepAt > 4000;
  document.body.classList.toggle('no-sweeps', stalled);
  $('scopeEmpty').textContent = stalled
    ? 'The radio has stopped sending its band display. It carries on when the radio does.'
    : 'The band display appears here once the radio is connected.';
}, 2000);
// Only the console's own direct connection sends both receivers; from wfweb
// that header byte means something else.
radio.addEventListener('audio', (e) => {
  const direct = !!(radio.info && radio.info.direct);
  speaker.play(e.detail, direct);
  morse.feed(e.detail, direct);
});
radio.addEventListener('notice', (e) => toast(e.detail.text));

renderLink();
renderListen();
renderTalk();
radio.connect();

// Handy when poking at the page from the browser's developer console.
window.radioConsole = { radio, scope, speaker, mic, repeaters, scan, second, satellites, logbook, morse, sheets, tips, tabs };
