// Scanning: step through a list of frequencies and stop where someone is
// talking. "Someone is talking" means the radio's squelch has opened, so the
// squelch has to be set to silence an empty channel first.
//
// The console server does each step ("tune here, tell me if the squelch is
// open"), which is quicker and surer than the page guessing at timings.

import { bandFor, segmentFor } from './bandplan.js';
import { formatMHz, formatDistance } from './format.js';

const QUIET_BEFORE_MOVING_MS = 4000; // stay this long after a conversation pauses
const HOLD_CHECK_MS = 350;
const MAX_CHANNELS = 500;
const SCANNABLE = ['FM', 'DV', 'AM']; // modes where the squelch closes on an empty channel

// ctx: { $, radio, state, toast, recall(entry), favorites(), repeaters, currentStep() }
export function setupScan(ctx) {
  const { $, radio, state, toast } = ctx;
  const waiting = new Map();
  let nextId = 1;
  let run = null; // the scan in progress

  radio.addEventListener('scanResult', (e) => {
    const resolve = waiting.get(e.detail.id);
    if (!resolve) return;
    waiting.delete(e.detail.id);
    resolve(e.detail);
  });

  // Asks the server to tune (or, with no frequency, just to look).
  function probe(freq, mode) {
    return new Promise((resolve) => {
      const id = nextId++;
      waiting.set(id, resolve);
      if (!radio.send('scanProbe', { value: freq || 0, mode, id })) resolve({ busy: null });
      setTimeout(() => {
        if (waiting.delete(id)) resolve({ busy: null });
      }, 2500);
    });
  }

  const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  function show(text, strongText) {
    const status = $('scanStatus');
    if (strongText) {
      const strong = document.createElement('strong');
      strong.textContent = strongText;
      status.replaceChildren(text, strong);
    } else {
      status.textContent = text;
    }
  }

  function render() {
    $('scanIdle').hidden = !!run;
    $('scanRunning').hidden = !run;
    $('scanRow').hidden = !(radio.info && radio.info.features && radio.info.features.scan);
    const band = bandFor(state.frequency);
    $('scanRepeaters').hidden = !band || ctx.repeaters.forBand(band.id).length === 0;
  }

  function stop(message) {
    if (!run) return;
    run.stopped = true;
    run = null;
    render();
    if (message) toast(message, 5000);
  }

  // targets: [{ freq, mode, name, entry }]. `entry` carries shift and tone to
  // apply when the scan stops there.
  async function start(all, what) {
    if (run) return;
    if (!radio.rigConnected) return;
    if (state.transmitting) return;
    if (state.satMode) {
      toast('The radio is following a satellite. Stop tracking before scanning.');
      return;
    }
    if (!all.length) {
      toast(`There is nothing to scan in ${what}.`);
      return;
    }
    // With both receivers on, the main one cannot visit the band the second
    // is listening on, so anything there is left out of the round.
    let targets = all;
    const taken = state.dualWatch && state.subFrequency ? bandFor(state.subFrequency) : null;
    if (taken) {
      targets = all.filter((t) => bandFor(t.freq) !== taken);
      const left = all.length - targets.length;
      if (!targets.length) {
        toast(`Everything in ${what} is on ${taken.name}, where the second receiver is listening. Switch it off or move it to scan there.`, 9000);
        return;
      }
      if (left) toast(`Leaving out ${left} on ${taken.name}, where the second receiver is listening.`, 6000);
    }
    if (state.squelch === 0) {
      toast('Raise the squelch until the hiss stops, then scan. A scan stops wherever the squelch opens, and yours is open everywhere.', 9000);
      return;
    }
    const me = { stopped: false, skip: false };
    run = me;
    render();

    // If the first few channels all look busy, the squelch is not closing at
    // all, and the scan would only sit on noise.
    if (targets.length >= 3) {
      show(`Scanning ${what}: `, 'checking the squelch');
      let busy = 0;
      for (const t of targets.slice(0, 3)) {
        const result = await probe(t.freq, t.mode);
        if (me.stopped) return;
        if (result.busy) busy++;
      }
      if (busy === 3) {
        stop('The scan stopped: every channel looks busy, which usually means the squelch is set too low. Raise it until the hiss stops.');
        return;
      }
    }

    let i = 0;
    while (!me.stopped) {
      const t = targets[i % targets.length];
      i++;
      show(`Scanning ${what}: `, `${formatMHz(t.freq)}${t.name ? ` ${t.name}` : ''}`);
      const result = await probe(t.freq, t.mode);
      if (me.stopped) return;
      if (result.busy === null) {
        stop('The scan stopped: the radio didn’t answer.');
        return;
      }
      if (!result.busy) continue;

      // Someone is here. Set the channel up properly and wait with them.
      if (t.entry) ctx.recall(t.entry, { quiet: true });
      me.skip = false;
      let quietSince = 0;
      while (!me.stopped && !me.skip) {
        show(quietSince ? 'Waiting to see if they carry on: ' : 'Someone is talking on ', `${formatMHz(t.freq)}${t.name ? ` ${t.name}` : ''}`);
        await pause(HOLD_CHECK_MS);
        if (me.stopped) return;
        const now = await probe(0);
        if (me.stopped) return;
        if (now.busy) quietSince = 0;
        else if (!quietSince) quietSince = Date.now();
        else if (Date.now() - quietSince >= QUIET_BEFORE_MOVING_MS) break;
      }
    }
  }

  function fromEntries(entries) {
    return entries
      .filter((e) => ctx.inRadioRange(e.freq) && SCANNABLE.includes(e.mode || 'FM'))
      .map((e) => ({ freq: e.freq, mode: e.mode || 'FM', name: e.name, entry: e }));
  }

  $('scanFavorites').addEventListener('click', () => start(fromEntries(ctx.favorites()), 'your favorites'));

  $('scanRepeaters').addEventListener('click', () => {
    const band = bandFor(state.frequency);
    if (!band) return;
    const list = ctx.repeaters
      .forBand(band.id)
      .slice()
      .sort((a, b) => a.freq - b.freq);
    start(fromEntries(list), `repeaters on ${band.name}`);
  });

  $('scanBand').addEventListener('click', () => {
    const seg = segmentFor(state.frequency);
    if (!seg) {
      toast('Tune to the part of the band you want to scan first.');
      return;
    }
    if (!SCANNABLE.includes(state.mode)) {
      toast('Scanning works in FM, where the squelch shows when someone is talking. Switch to FM first.', 8000);
      return;
    }
    const step = Math.max(ctx.currentStep(), 5000);
    const first = Math.ceil(seg.start / step) * step;
    const targets = [];
    for (let f = first; f <= seg.end && targets.length < MAX_CHANNELS; f += step) targets.push({ freq: f, mode: state.mode });
    // Carry on from where the dial is now.
    const at = targets.findIndex((t) => t.freq > state.frequency);
    const ordered = at > 0 ? [...targets.slice(at), ...targets.slice(0, at)] : targets;
    start(ordered, `“${seg.label}” in ${formatDistance(step)} steps`);
  });

  $('scanSkip').addEventListener('click', () => {
    if (run) run.skip = true;
  });
  $('scanStop').addEventListener('click', () => stop());

  radio.addEventListener('link', () => {
    if (!radio.rigConnected) stop();
    render();
  });
  radio.addEventListener('info', render);

  return {
    get running() {
      return !!run;
    },
    stop,
    render,
  };
}
