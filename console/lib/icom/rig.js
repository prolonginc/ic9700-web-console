'use strict';

// The radio as the rest of the program sees it: a set of named settings that
// stay up to date, and methods to change them.
//
// Commands go out one at a time, each waiting briefly for its answer, with
// anything the user asked for jumping ahead of routine status reads.
//
// Events: 'change' (the settings that changed), 'scope' (one spectrum sweep)

const { EventEmitter } = require('events');
const civ = require('./civ');
const { calibrate } = require('./models');

const CONTROLLER_ADDRESS = 0xe0;
const REPLY_TIMEOUT_MS = 300;
const METER_INTERVAL_MS = 100;
const STATUS_INTERVAL_MS = 220;

// Settings read in rotation to notice changes made on the radio itself.
// Frequency and mode appear twice so they come round more often.
const STATUS_READS = [
  [0x03], // frequency
  [0x04], // mode
  [0x0f], // repeater shift
  [0x0c], // shift distance
  [0x03],
  [0x04],
  [0x14, 0x03], // squelch
  [0x14, 0x0a], // transmit power
  [0x16, 0x02], // preamp
  [0x16, 0x40], // noise reduction
  [0x03],
  [0x04],
  [0x16, 0x5d], // access tone type
  [0x1b, 0x00], // tone frequency
  [0x1b, 0x01], // tone-squelch frequency
  [0x27, 0x14, 0x00], // scope mode
  [0x27, 0x15, 0x00], // scope span
];

const DUPLEX_BYTE = { OFF: 0x10, 'DUP-': 0x11, 'DUP+': 0x12 };
const DUPLEX_NAME = { 0x10: 'OFF', 0x11: 'DUP-', 0x12: 'DUP+' };

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
    this.get([0x1a, 0x05, 0x01, 0x15]); // transmit-audio source
    this.get([0x1c, 0x00]); // transmitting?
    for (const read of STATUS_READS) this.get(read, false);

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
    item.resolve(result);
    this.pump();
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
        if (p.length >= 6) this.update({ frequency: civ.fromBcdLE(p.subarray(1, 6)) });
        break;
      case 0x01: // the radio announcing a new mode
      case 0x04: {
        const name = p.length >= 2 ? this.modeName(p[1]) : null;
        if (name) this.update({ mode: name });
        break;
      }
      case 0x0f:
        if (p.length >= 2 && DUPLEX_NAME[p[1]]) this.update({ duplex: DUPLEX_NAME[p[1]] });
        break;
      case 0x0c:
        if (p.length >= 4) this.update({ duplexOffset: civ.fromBcdLE(p.subarray(1, 4)) * 100 });
        break;
      case 0x14: {
        const v = level(2);
        if (v === null) break;
        if (p[1] === 0x03) this.update({ squelch: v });
        else if (p[1] === 0x0a) this.update({ rfPower: v });
        break;
      }
      case 0x15: {
        const v = level(2);
        if (v === null) break;
        if (p[1] === 0x02) this.update({ sMeter: Math.round(calibrate(this.profile.sMeter, v) * 10) / 10 });
        else if (p[1] === 0x11) this.update({ powerMeter: Math.round(calibrate(this.profile.powerMeter, v)) });
        else if (p[1] === 0x12) this.update({ swrMeter: Math.round(calibrate(this.profile.swrMeter, v) * 10) / 10 });
        break;
      }
      case 0x16:
        if (p.length < 3) break;
        if (p[1] === 0x02) this.update({ preamp: p[2] });
        else if (p[1] === 0x40) this.update({ nr: p[2] === 0x01 });
        else if (p[1] === 0x5d) {
          const found = this.profile.toneModes.find(([b]) => b === p[2]);
          this.update({ toneMode: found ? found[1] : 'OFF' });
        }
        break;
      case 0x1a:
        if (p[1] === 0x05 && p[2] === 0x01 && p[3] === 0x15 && p.length >= 5) this.modInput = p[4];
        break;
      case 0x1b:
        // Two BCD bytes of tenths of a hertz, after one padding byte.
        if (p.length >= 4) {
          const tone = civ.fromBcdBE(data(p.length - 2));
          if (p[1] === 0x00) this.update({ toneFreq: tone });
          else if (p[1] === 0x01) this.update({ tsqlFreq: tone });
        }
        break;
      case 0x1c:
        if (p[1] === 0x00 && p.length >= 3) this.update({ transmitting: p[2] === 0x01 });
        break;
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

  async setFrequency(hz) {
    if (await this.set([0x05, ...civ.toBcdLE(hz, 5)], 'frequency')) this.update({ frequency: hz });
  }

  async setMode(name) {
    const found = this.profile.modes.find(([n]) => n === name);
    if (!found) return;
    if (await this.set([0x06, found[1]])) this.update({ mode: name });
  }

  async setDuplex(name) {
    if (!(name in DUPLEX_BYTE)) return;
    if (await this.set([0x0f, DUPLEX_BYTE[name]])) this.update({ duplex: name });
  }

  async setDuplexOffset(hz) {
    if (await this.set([0x0d, ...civ.toBcdLE(hz / 100, 3)])) this.update({ duplexOffset: hz });
  }

  async setToneMode(name) {
    const found = this.profile.toneModes.find(([, n]) => n === name);
    if (!found) return;
    if (await this.set([0x16, 0x5d, found[0]])) this.update({ toneMode: name });
  }

  async setTone(which, tenths) {
    const sub = which === 'tsql' ? 0x01 : 0x00;
    if (await this.set([0x1b, sub, 0x00, ...civ.toBcdBE(tenths, 2)])) {
      this.update(which === 'tsql' ? { tsqlFreq: tenths } : { toneFreq: tenths });
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

  async setLevel(sub, key, value) {
    const v = Math.max(0, Math.min(255, Math.round(value)));
    if (await this.set([0x14, sub, ...civ.toBcdBE(v, 2)], key)) this.update({ [key]: v });
  }

  setSquelch(value) {
    return this.setLevel(0x03, 'squelch', value);
  }

  setRfPower(value) {
    return this.setLevel(0x0a, 'rfPower', value);
  }

  async setPreamp(value) {
    const v = value ? 1 : 0;
    if (await this.set([0x16, 0x02, v])) this.update({ preamp: v });
  }

  async setNoiseReduction(on) {
    if (await this.set([0x16, 0x40, on ? 1 : 0])) this.update({ nr: !!on });
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
