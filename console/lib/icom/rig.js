'use strict';

// The radio as the rest of the program sees it: a set of named settings that
// stay up to date, and methods to change them.
//
// Commands go out one at a time, each waiting briefly for its answer, with
// anything the user asked for jumping ahead of routine status reads.
//
// Two receivers. The radio has a main band and a second ("sub") band, and
// most commands act on whichever of the two is selected on its front panel.
// There is no way to address the other one directly, so:
//
//   - `selected` is tracked by asking the radio often, and every answer is
//     filed under the band that was selected when it arrived. Main-band
//     settings keep their plain names (frequency, mode, squelch...); the
//     second receiver's are prefixed (subFrequency, subMode, subSquelch...).
//   - To change something on the band that is not selected, the commands
//     "select it, change it, select the home band again" are queued together
//     so nothing else can slip in between.
//   - The home band is main, except in satellite mode, where main is only the
//     transmitter and the second receiver is the one being listened to.
//
// Events: 'change' (the settings that changed), 'scope' (one spectrum sweep)

const { EventEmitter } = require('events');
const civ = require('./civ');
const { calibrate } = require('./models');

const CONTROLLER_ADDRESS = 0xe0;
const REPLY_TIMEOUT_MS = 300;
const METER_INTERVAL_MS = 100;
const STATUS_INTERVAL_MS = 220;
const PROBE_SETTLE_MS = 170; // time for the squelch to react after tuning

// Settings read in rotation to notice changes made on the radio itself.
// Frequency and mode appear more than once so they come round more often.
const STATUS_READS = [
  [0x03], // frequency
  [0x04], // mode
  [0x0f], // repeater shift
  [0x0c], // shift distance
  [0x16, 0x59], // second receiver on?
  [0x03],
  [0x04],
  [0x14, 0x03], // squelch
  [0x14, 0x0a], // transmit power
  [0x16, 0x02], // preamp
  [0x16, 0x40], // noise reduction
  [0x16, 0x5a], // satellite mode?
  [0x03],
  [0x04],
  [0x16, 0x5d], // access tone type
  [0x1b, 0x00], // tone frequency
  [0x1b, 0x01], // tone-squelch frequency
  [0x27, 0x14, 0x00], // scope mode
  [0x27, 0x15, 0x00], // scope span
];

// The second receiver's settings worth knowing, read while it is selected.
const SUB_READS = [[0x03], [0x04], [0x14, 0x03]];

const SELECT = { main: [0x07, 0xd0], sub: [0x07, 0xd1] };

// Settings that exist once per band. Everything else belongs to the radio as
// a whole (or to its transmitter, which is always on the main band).
const PER_BAND = new Set([
  'frequency',
  'mode',
  'duplex',
  'duplexOffset',
  'squelch',
  'preamp',
  'nr',
  'toneMode',
  'toneFreq',
  'tsqlFreq',
  'sMeter',
  'squelchOpen',
]);

const DUPLEX_BYTE = { OFF: 0x10, 'DUP-': 0x11, 'DUP+': 0x12 };
// Reading the shift gives 0x00 for "none", though setting it takes 0x10.
const DUPLEX_NAME = { 0x00: 'OFF', 0x10: 'OFF', 0x11: 'DUP-', 0x12: 'DUP+' };

const subKey = (name) => `sub${name[0].toUpperCase()}${name.slice(1)}`;
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

class Rig extends EventEmitter {
  constructor(session, profile) {
    super();
    this.session = session;
    this.profile = profile;
    this.address = (session.radio && session.radio.civAddress) || profile.civAddress;
    this.model = (session.radio && session.radio.name) || profile.model;
    this.state = {};
    this.parser = new civ.CivParser();
    this.urgent = []; // things the user asked for
    this.routine = []; // status reads
    this.pending = null;
    this.timers = [];
    this.statusIndex = 0;
    this.meterTick = 0;
    this.modInput = null; // the radio's own transmit-audio source setting
    this.modInputToRestore = null;
    this.scopeParts = null;
    this.selected = 'main'; // the band the radio is acting on right now
    this.willSelect = 'main'; // ...and the one it will be on once the queue has run
    this.snapshot = null; // per-band settings as of the last selection check
    this.satelliteByUs = false; // satellite mode was switched on from here
    this.stopped = false;

    this.onCiv = (bytes) => {
      for (const f of this.parser.push(bytes)) {
        if (f.from === this.address) this.onFrame(f.payload);
      }
    };
    session.on('civ', this.onCiv);
  }

  start() {
    // Ask for the spectrum scope and for its sweeps to be sent to us.
    this.set([0x27, 0x10, 0x01]);
    this.set([0x27, 0x11, 0x01]);
    this.get([0x07, 0xd2]); // which band is selected
    this.get([0x1a, 0x05, 0x01, 0x15]); // transmit-audio source
    this.get([0x1c, 0x00]); // transmitting?
    for (const read of STATUS_READS) this.get(read, false);
    // Once the first answers are in, look at the second receiver if it is on.
    Promise.all([this.get([0x16, 0x59]), this.get([0x16, 0x5a])]).then(() => {
      if (this.state.dualWatch || this.state.satMode) this.refreshOther();
    });

    this.timers.push(
      setInterval(() => {
        if (this.routine.length > 3) return;
        this.meterTick++;
        if (this.state.transmitting) {
          this.get([0x15, 0x11], false); // output power
          this.get([0x15, 0x12], false); // SWR
        } else {
          this.get([0x15, 0x02], false); // S-meter
        }
        if (this.meterTick % 2 === 0) this.get([0x1c, 0x00], false);
        if (this.meterTick % 4 === 1) this.get([0x07, 0xd2], false); // which band is selected
        // With the second receiver selected on the radio's own panel, the
        // rotation below is reading that one. These two always answer for main.
        if (this.meterTick % 8 === 0 && this.selected === 'sub' && !this.state.satMode) {
          this.get([0x25, 0x00], false);
          this.get([0x26, 0x00], false);
        }
      }, METER_INTERVAL_MS),
      setInterval(() => {
        if (this.routine.length > 5) return;
        this.get(STATUS_READS[this.statusIndex], false);
        this.statusIndex = (this.statusIndex + 1) % STATUS_READS.length;
      }, STATUS_INTERVAL_MS),
    );
  }

  stop() {
    if (this.stopped) return;
    this.stopped = true;
    for (const t of this.timers) clearInterval(t);
    this.timers = [];
    this.session.off('civ', this.onCiv);
    if (this.pending) clearTimeout(this.pending.timer);
    for (const item of [this.pending, ...this.urgent, ...this.routine]) {
      if (item) item.resolve(null);
    }
    this.pending = null;
    this.urgent = [];
    this.routine = [];
  }

  // ------------------------------------------------------------- Queue

  // Reads a setting. Resolves with the reply payload, or null if none came.
  get(payload, urgent = true) {
    return this.enqueue({ payload: Buffer.from(payload), kind: 'get' }, urgent);
  }

  // Changes a setting. Resolves true if the radio accepted it. A newer change
  // to the same `key` replaces one still waiting, so a dragged slider sends
  // only its latest position.
  set(payload, key) {
    if (key) {
      const waiting = this.urgent.find((item) => item.key === key);
      if (waiting) {
        waiting.payload = Buffer.from(payload);
        return waiting.promise;
      }
    }
    return this.enqueue({ payload: Buffer.from(payload), kind: 'set', key }, true);
  }

  // A change that must not wait behind anything else: unkeying.
  setNow(payload) {
    return this.enqueue({ payload: Buffer.from(payload), kind: 'set' }, true, true);
  }

  enqueue(item, urgent, first = false) {
    if (this.stopped) return Promise.resolve(null);
    item.promise = new Promise((resolve) => {
      item.resolve = resolve;
    });
    const queue = urgent ? this.urgent : this.routine;
    if (first) queue.unshift(item);
    else queue.push(item);
    this.pump();
    return item.promise;
  }

  pump() {
    if (this.pending || this.stopped) return;
    const item = this.urgent.shift() || this.routine.shift();
    if (!item) return;
    this.pending = item;
    item.timer = setTimeout(() => this.settle(null), REPLY_TIMEOUT_MS);
    this.session.sendCiv(civ.frame(this.address, CONTROLLER_ADDRESS, item.payload));
  }

  settle(result) {
    const item = this.pending;
    if (!item) return;
    clearTimeout(item.timer);
    this.pending = null;
    // Our own "select this band" took effect: file what follows accordingly.
    if (result === true && item.payload.length === 2 && item.payload[0] === 0x07) {
      if (item.payload[1] === 0xd0) this.noteSelected('main', true);
      else if (item.payload[1] === 0xd1) this.noteSelected('sub', true);
    }
    item.resolve(result);
    this.pump();
  }

  // ------------------------------------------------------------- Bands

  home() {
    return this.state.satMode ? 'sub' : 'main';
  }

  // The name a per-band setting is stored under, for the band selected now.
  keyFor(name, band = this.selected) {
    return band === 'sub' && PER_BAND.has(name) ? subKey(name) : name;
  }

  // Stores readings that belong to the selected band.
  updateBand(changes) {
    const mapped = {};
    for (const [name, value] of Object.entries(changes)) mapped[this.keyFor(name)] = value;
    this.update(mapped);
  }

  bandSnapshot(band) {
    const values = {};
    for (const name of PER_BAND) {
      const key = this.keyFor(name, band);
      if (key in this.state) values[key] = this.state[key];
    }
    return { band, values };
  }

  // byUs: we asked for it. Otherwise someone pressed MAIN or SUB on the radio,
  // and whatever arrived since the last check may have been filed under the
  // wrong band, so that band goes back to how it was at that check.
  noteSelected(band, byUs) {
    if (band !== this.selected) {
      if (!byUs && this.snapshot && this.snapshot.band === this.selected) this.update(this.snapshot.values);
      this.selected = band;
      this.update({ selected: band });
    }
    if (!byUs && this.urgent.length === 0) this.willSelect = band;
    this.snapshot = this.bandSnapshot(band);
  }

  // Queues commands for one band, selecting it first and returning to the
  // home band after if need be. Resolves with the result of the last command.
  onBand(band, payloads, { key, kind = 'set' } = {}) {
    if (key) {
      const waiting = this.urgent.find((item) => item.key === `${band}:${key}`);
      if (waiting) {
        waiting.payload = Buffer.from(payloads[payloads.length - 1]);
        return waiting.promise;
      }
    }
    const home = this.home();
    if (this.willSelect !== band) this.set(SELECT[band]);
    let last = Promise.resolve(null);
    payloads.forEach((payload, i) => {
      const lastOne = i === payloads.length - 1;
      last = this.enqueue({ payload: Buffer.from(payload), kind, key: lastOne && key ? `${band}:${key}` : undefined }, true);
    });
    this.willSelect = band;
    if (band !== home) {
      this.set(SELECT[home]);
      this.willSelect = home;
    }
    return last;
  }

  // Reads the band that is not the home band, which nothing else looks at.
  refreshOther() {
    const other = this.home() === 'main' ? 'sub' : 'main';
    const reads = other === 'sub' ? SUB_READS : [[0x03], [0x04], [0x16, 0x5d], [0x1b, 0x00]];
    return this.onBand(other, reads, { kind: 'get' });
  }

  // ----------------------------------------------------------- Incoming

  onFrame(payload) {
    if (payload.length === 0) return;
    const p = this.pending;
    if (payload[0] === civ.OK || payload[0] === civ.NG) {
      if (p) this.settle(p.kind === 'set' ? payload[0] === civ.OK : null);
      return;
    }
    if (payload[0] === 0x27 && payload[1] === 0x00) {
      this.onScope(payload);
      return;
    }
    this.decode(payload);
    if (p && p.kind === 'get' && civ.startsWith(payload, p.payload)) this.settle(payload);
  }

  update(changes) {
    const changed = {};
    for (const [key, value] of Object.entries(changes)) {
      if (this.state[key] !== value) {
        this.state[key] = value;
        changed[key] = value;
      }
    }
    if (Object.keys(changed).length) this.emit('change', changed);
  }

  modeName(byte) {
    const found = this.profile.modes.find(([, b]) => b === byte);
    return found ? found[0] : null;
  }

  decode(p) {
    const data = (n) => p.subarray(n);
    const level = (n) => (p.length >= n + 2 ? civ.fromBcdBE(p.subarray(n, n + 2)) : null);

    switch (p[0]) {
      case 0x00: // the radio announcing a new frequency (dial turned)
      case 0x03:
        if (p.length >= 6) this.updateBand({ frequency: civ.fromBcdLE(p.subarray(1, 6)) });
        break;
      case 0x01: // the radio announcing a new mode
      case 0x04: {
        const name = p.length >= 2 ? this.modeName(p[1]) : null;
        if (name) this.updateBand({ mode: name });
        break;
      }
      case 0x07:
        if (p[1] === 0xd2 && p.length >= 3) this.noteSelected(p[2] === 0x01 ? 'sub' : 'main', false);
        break;
      case 0x0f:
        if (p.length >= 2 && DUPLEX_NAME[p[1]]) this.updateBand({ duplex: DUPLEX_NAME[p[1]] });
        break;
      case 0x0c:
        if (p.length >= 4) this.updateBand({ duplexOffset: civ.fromBcdLE(p.subarray(1, 4)) * 100 });
        break;
      case 0x14: {
        const v = level(2);
        if (v === null) break;
        if (p[1] === 0x03) this.updateBand({ squelch: v });
        else if (p[1] === 0x0a) this.update({ rfPower: v });
        break;
      }
      case 0x15: {
        if (p[1] === 0x01 && p.length >= 3) {
          this.updateBand({ squelchOpen: p[2] === 0x01 });
          break;
        }
        const v = level(2);
        if (v === null) break;
        if (p[1] === 0x02) this.updateBand({ sMeter: Math.round(calibrate(this.profile.sMeter, v) * 10) / 10 });
        else if (p[1] === 0x11) this.update({ powerMeter: Math.round(calibrate(this.profile.powerMeter, v)) });
        else if (p[1] === 0x12) this.update({ swrMeter: Math.round(calibrate(this.profile.swrMeter, v) * 10) / 10 });
        break;
      }
      case 0x16:
        if (p.length < 3) break;
        if (p[1] === 0x02) this.updateBand({ preamp: p[2] });
        else if (p[1] === 0x40) this.updateBand({ nr: p[2] === 0x01 });
        else if (p[1] === 0x59) this.update({ dualWatch: p[2] === 0x01 });
        else if (p[1] === 0x5a) this.update({ satMode: p[2] === 0x01 });
        else if (p[1] === 0x5d) {
          const found = this.profile.toneModes.find(([b]) => b === p[2]);
          this.updateBand({ toneMode: found ? found[1] : 'OFF' });
        }
        break;
      case 0x1a:
        if (p[1] === 0x05 && p[2] === 0x01 && p[3] === 0x15 && p.length >= 5) this.modInput = p[4];
        break;
      case 0x1b:
        // Two BCD bytes of tenths of a hertz, after one padding byte.
        if (p.length >= 4) {
          const tone = civ.fromBcdBE(data(p.length - 2));
          if (p[1] === 0x00) this.updateBand({ toneFreq: tone });
          else if (p[1] === 0x01) this.updateBand({ tsqlFreq: tone });
        }
        break;
      case 0x1c:
        if (p[1] === 0x00 && p.length >= 3) this.update({ transmitting: p[2] === 0x01 });
        break;
      case 0x25:
        // The main band's frequency, whichever band is selected.
        if (p[1] === 0x00 && p.length >= 7) this.update({ frequency: civ.fromBcdLE(p.subarray(2, 7)) });
        break;
      case 0x26: {
        const name = p[1] === 0x00 && p.length >= 3 ? this.modeName(p[2]) : null;
        if (name) this.update({ mode: name });
        break;
      }
      case 0x27:
        if (p[1] === 0x14 && p.length >= 4) this.update({ scopeMode: p[3] });
        else if (p[1] === 0x15 && p.length >= 8) {
          const index = this.profile.spans.indexOf(civ.fromBcdLE(p.subarray(3, 8)));
          if (index >= 0) this.update({ spanIndex: index });
        }
        break;
      default:
        break;
    }
  }

  // A sweep is: receiver, part number, part count, then in the first part
  // the scope mode, two frequencies and an out-of-range flag, then the
  // signal levels (0 to 160), one byte per point. Over the network it comes
  // as a single part; over a serial link it is split into several.
  onScope(p) {
    if (p.length < 5 || p[2] !== 0x00) return; // main receiver only
    const part = civ.fromBcdByte(p[3]);
    const parts = civ.fromBcdByte(p[4]);
    if (part === 1) {
      if (p.length < 17) return;
      const mode = p[5];
      const a = civ.fromBcdLE(p.subarray(6, 11));
      const b = civ.fromBcdLE(p.subarray(11, 16));
      this.scopeParts = {
        mode,
        // Center mode gives the middle and the half-width; the others give the two edges.
        start: mode === 0 ? a - b : a,
        end: mode === 0 ? a + b : b,
        outOfRange: p[16] === 0x01,
        pixels: [Buffer.from(p.subarray(17))],
      };
    } else if (this.scopeParts) {
      this.scopeParts.pixels.push(Buffer.from(p.subarray(5)));
    }
    if (this.scopeParts && part === parts) {
      const sweep = this.scopeParts;
      this.scopeParts = null;
      sweep.pixels = Buffer.concat(sweep.pixels);
      if (sweep.pixels.length) this.emit('scope', sweep);
    }
  }

  // ------------------------------------------------------------ Commands
  //
  // `band` is 'main' unless said otherwise. A change the radio accepts is
  // recorded straight away under that band's name for it.

  record(band, changes) {
    const mapped = {};
    for (const [name, value] of Object.entries(changes)) mapped[this.keyFor(name, band)] = value;
    this.update(mapped);
  }

  bandOf(hz) {
    return this.profile.bands.findIndex((b) => hz >= b.start && hz <= b.end);
  }

  async setFrequency(hz, band = 'main') {
    // With both receivers on, a band can only be on one of them, and the
    // radio refuses to tune the main one into the band the second is using.
    // Trading the two over first is what the radio's own band keys do.
    if (band === 'main' && this.state.dualWatch && !this.state.satMode) {
      const want = this.bandOf(hz);
      if (want >= 0 && want === this.bandOf(this.state.subFrequency) && want !== this.bandOf(this.state.frequency)) {
        await this.swapBands();
      }
    }
    if (await this.onBand(band, [[0x05, ...civ.toBcdLE(hz, 5)]], { key: 'frequency' })) this.record(band, { frequency: hz });
  }

  async setMode(name, band = 'main') {
    const found = this.profile.modes.find(([n]) => n === name);
    if (!found) return;
    if (await this.onBand(band, [[0x06, found[1]]])) this.record(band, { mode: name });
  }

  async setDuplex(name) {
    if (!(name in DUPLEX_BYTE)) return;
    if (await this.onBand('main', [[0x0f, DUPLEX_BYTE[name]]])) this.record('main', { duplex: name });
  }

  async setDuplexOffset(hz) {
    if (await this.onBand('main', [[0x0d, ...civ.toBcdLE(hz / 100, 3)]])) this.record('main', { duplexOffset: hz });
  }

  async setToneMode(name) {
    const found = this.profile.toneModes.find(([, n]) => n === name);
    if (!found) return;
    if (await this.onBand('main', [[0x16, 0x5d, found[0]]])) this.record('main', { toneMode: name });
  }

  async setTone(which, tenths) {
    const sub = which === 'tsql' ? 0x01 : 0x00;
    if (await this.onBand('main', [[0x1b, sub, 0x00, ...civ.toBcdBE(tenths, 2)]])) {
      this.record('main', which === 'tsql' ? { tsqlFreq: tenths } : { toneFreq: tenths });
    }
  }

  async setSpan(index) {
    const hz = this.profile.spans[index];
    if (!hz) return;
    if (await this.set([0x27, 0x15, 0x00, ...civ.toBcdLE(hz, 5)], 'span')) this.update({ spanIndex: index });
  }

  async setScopeMode(mode) {
    if (await this.set([0x27, 0x14, 0x00, mode & 0x03])) this.update({ scopeMode: mode & 0x03 });
  }

  async setSquelch(value, band = 'main') {
    const v = Math.max(0, Math.min(255, Math.round(value)));
    if (await this.onBand(band, [[0x14, 0x03, ...civ.toBcdBE(v, 2)]], { key: 'squelch' })) this.record(band, { squelch: v });
  }

  async setRfPower(value) {
    const v = Math.max(0, Math.min(255, Math.round(value)));
    if (await this.set([0x14, 0x0a, ...civ.toBcdBE(v, 2)], 'rfPower')) this.update({ rfPower: v });
  }

  async setPreamp(value) {
    const v = value ? 1 : 0;
    if (await this.onBand('main', [[0x16, 0x02, v]])) this.record('main', { preamp: v });
  }

  async setNoiseReduction(on) {
    if (await this.onBand('main', [[0x16, 0x40, on ? 1 : 0]])) this.record('main', { nr: !!on });
  }

  // Reports whether anyone is on the main band's frequency: the answer to
  // "is the squelch open?". With `hz`, tunes there first and gives the
  // receiver a moment to settle. This is what scanning is made of.
  async probe(hz, modeName) {
    if (hz) {
      if (modeName && modeName !== this.state.mode) await this.setMode(modeName);
      await this.setFrequency(hz);
      await delay(PROBE_SETTLE_MS);
    }
    const [squelch] = await Promise.all([
      this.onBand('main', [[0x15, 0x01]], { kind: 'get' }),
      this.onBand('main', [[0x15, 0x02]], { kind: 'get' }),
    ]);
    const busy = squelch ? squelch[2] === 0x01 : null;
    return { frequency: this.state.frequency, busy, sMeter: this.state.sMeter };
  }

  // ---------------------------------------------------- Second receiver

  async setDualWatch(on) {
    if (!(await this.set([0x16, 0x59, on ? 1 : 0]))) return;
    this.update({ dualWatch: !!on });
    if (on) this.refreshOther();
  }

  // Main and second receiver trade places.
  async swapBands() {
    if (!(await this.set([0x07, 0xb0]))) return;
    // Show the trade at once, then read both bands to fill in the rest.
    const before = { ...this.state };
    const traded = {};
    for (const name of ['frequency', 'mode']) { // squelch stays with each receiver
      if (before[subKey(name)] !== undefined) traded[name] = before[subKey(name)];
      if (before[name] !== undefined) traded[subKey(name)] = before[name];
    }
    this.update(traded);
    for (const read of STATUS_READS) this.get(read, false);
    this.refreshOther();
  }

  // ----------------------------------------------------- Satellite mode
  //
  // In satellite mode the radio keeps a separate pair of frequencies: main is
  // the transmitter (uplink) and the second receiver hears the satellite
  // (downlink), both at once. Leaving the mode brings back what was there.

  // tone: tenths of a hertz, or 0 for none.
  async satelliteStart({ downlink, uplink, mode = 'FM', tone = 0 }) {
    const modeByte = (this.profile.modes.find(([n]) => n === mode) || this.profile.modes.find(([n]) => n === 'FM'))[1];
    if (!this.state.satMode) {
      if (!(await this.set([0x16, 0x5a, 0x01]))) return false;
      this.satelliteByUs = true;
      this.update({ satMode: true });
    }
    this.onBand('main', [
      [0x05, ...civ.toBcdLE(uplink, 5)],
      [0x06, modeByte],
      [0x0f, DUPLEX_BYTE.OFF],
      ...(tone ? [[0x1b, 0x00, 0x00, ...civ.toBcdBE(tone, 2)]] : []),
      [0x16, 0x5d, tone ? 0x01 : 0x00],
    ]);
    const ok = await this.onBand('sub', [
      [0x06, modeByte],
      [0x05, ...civ.toBcdLE(downlink, 5)],
    ]);
    this.record('main', { frequency: uplink, mode, duplex: 'OFF', toneMode: tone ? 'TONE' : 'OFF', ...(tone ? { toneFreq: tone } : {}) });
    this.record('sub', { frequency: downlink, mode });
    return !!ok;
  }

  // Follows the satellite as its motion shifts both frequencies.
  satelliteTune({ downlink, uplink }) {
    if (!this.state.satMode) return;
    if (downlink) this.setFrequency(downlink, 'sub');
    if (uplink) this.setFrequency(uplink, 'main');
  }

  async satelliteStop() {
    if (!(await this.set([0x16, 0x5a, 0x00]))) return;
    this.satelliteByUs = false;
    this.update({ satMode: false });
    // The ordinary frequencies are back, and the radio chooses the selection.
    this.get([0x07, 0xd2]);
    for (const read of STATUS_READS) this.get(read, false);
    if (this.state.dualWatch) this.refreshOther();
  }

  // Keys or unkeys the transmitter.
  //
  // In voice modes the radio takes transmit audio from wherever its "Data Off
  // Mod Input" setting says, normally the hand microphone. To talk from the
  // browser it has to say "LAN" instead, so that is switched on the way in
  // and put back on the way out, leaving the hand microphone working.
  async setTransmit(on) {
    const lan = this.profile.modInputLan;
    if (on) {
      if (this.modInput !== null && this.modInput !== lan) {
        this.modInputToRestore = this.modInput;
        if (await this.set([0x1a, 0x05, 0x01, 0x15, lan])) this.modInput = lan;
      }
      await this.set([0x1c, 0x00, 0x01]);
      this.get([0x1c, 0x00]);
    } else {
      // Sent twice: an unkey that went missing would leave the radio on the air.
      const first = await this.setNow([0x1c, 0x00, 0x00]);
      if (!first) await this.setNow([0x1c, 0x00, 0x00]);
      this.session.flushAudio();
      if (this.modInputToRestore !== null) {
        const back = this.modInputToRestore;
        this.modInputToRestore = null;
        if (await this.set([0x1a, 0x05, 0x01, 0x15, back])) this.modInput = back;
      }
      this.get([0x1c, 0x00]);
    }
  }
}

module.exports = { Rig };
