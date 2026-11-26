'use strict';

// Talks to the radio directly and serves the page from that, with no other
// program in between. The page gets the same messages it would from wfweb:
//
//   to the page    JSON  rigInfo, status, update, meters, audioStatus, error
//                  binary 0x01 spectrum sweep, 0x02 receive audio
//   from the page  JSON  { cmd, value, ... }
//                  binary 0x03 microphone audio
//
// (The formats are spelled out at the top of public/js/radio.js.)
//
// It also answers a few commands wfweb does not have, for the second
// receiver, scanning and satellites. `features` in rigInfo tells the page
// they are there.

const { IcomSession, LoginError, SAMPLE_RATE } = require('./icom/session');
const { Rig } = require('./icom/rig');
const { profileFor } = require('./icom/models');

const RETRY_MS = 4000;
const SWEEP_INTERVAL_MS = 110; // the radio sends sweeps faster than a waterfall wants them
const TALK_LIMIT_MS = 3 * 60 * 1000 + 5000; // backstop to the page's own three-minute limit
const MIC_SILENCE_MS = 2000; // keyed but no microphone audio arriving for this long: unkey
const METER_KEYS = new Set(['sMeter', 'subSMeter', 'squelchOpen', 'subSquelchOpen', 'powerMeter', 'swrMeter', 'transmitting']);

class DirectBackend {
  constructor({ host, user, pass, log = console.log }) {
    this.config = { host, user, pass };
    this.log = log;
    this.clients = new Set();
    this.session = null;
    this.rig = null;
    this.profile = profileFor();
    this.problem = 'Connecting to the radio…';
    this.retryTimer = null;
    this.lastSweepAt = 0;
    this.audioSeq = 0;
    this.talker = null; // the page currently holding the transmitter
    this.talkTimer = null;
    this.talkWatch = null;
    this.lastMicAt = 0;
    this.stopping = false;
  }

  start() {
    this.connect();
  }

  // --------------------------------------------------------------- Radio

  async connect() {
    if (this.stopping || this.session) return;
    clearTimeout(this.retryTimer);
    // Stereo: the main receiver arrives on the left, the second on the right.
    const session = (this.session = new IcomSession({ ...this.config, stereo: true }));
    try {
      await session.connect();
    } catch (err) {
      session.close();
      if (this.session !== session) return;
      this.session = null;
      this.problem = err.message;
      this.log(`Radio: ${err.message}`);
      this.broadcast({ type: 'error', message: this.describeProblem() });
      // A wrong password will not fix itself; anything else might.
      if (!(err instanceof LoginError)) this.retryLater();
      return;
    }
    if (this.stopping) {
      session.close();
      return;
    }

    this.profile = profileFor(session.radio.name);
    const rig = (this.rig = new Rig(session, this.profile));
    this.problem = null;
    this.log(`Radio: connected to ${rig.model} at ${this.config.host}`);

    session.on('lost', (why) => this.onLost(session, why));
    session.on('audio', (pcm) => this.onAudio(pcm));
    rig.on('scope', (sweep) => this.onSweep(sweep));
    rig.on('change', (changed) => this.onChange(changed));
    rig.start();

    this.broadcast(this.rigInfo());
  }

  onLost(session, why) {
    if (this.session !== session) return;
    this.log(`Radio: connection lost (${why})`);
    if (this.rig) this.rig.stop();
    this.rig = null;
    this.session = null;
    this.talker = null;
    clearTimeout(this.talkTimer);
    clearInterval(this.talkWatch);
    this.problem = why;
    this.broadcast(this.rigInfo());
    if (!this.stopping) this.retryLater();
  }

  retryLater() {
    clearTimeout(this.retryTimer);
    this.retryTimer = setTimeout(() => this.connect(), RETRY_MS);
  }

  describeProblem() {
    return `Can’t connect to the radio at ${this.config.host}: ${this.problem}`;
  }

  rigInfo() {
    const p = this.profile;
    const info = { type: 'rigInfo', connected: !!this.rig, model: this.rig ? this.rig.model : p.model, direct: true };
    if (!this.rig) return info;
    return {
      ...info,
      modes: p.modes.map(([name]) => name),
      bands: p.bands,
      spans: p.spans.map((freq, reg) => ({ freq, reg, name: `±${freq >= 1000 ? freq / 1000 : freq} kHz` })),
      ctcssTones: p.ctcssTones,
      hasSpectrum: true,
      audioAvailable: true,
      audioSampleRate: SAMPLE_RATE,
      txAudioAvailable: true,
      features: { secondReceiver: true, scan: true, satellites: true },
    };
  }

  // -------------------------------------------------------- Radio → page

  broadcast(message) {
    const text = JSON.stringify(message);
    for (const c of this.clients) c.ws.sendText(text);
  }

  onChange(changed) {
    const meters = {};
    const settings = {};
    for (const [key, value] of Object.entries(changed)) {
      (METER_KEYS.has(key) ? meters : settings)[key] = value;
    }
    if (Object.keys(meters).length) this.broadcast({ type: 'meters', ...meters });
    if (Object.keys(settings).length) this.broadcast({ type: 'update', ...settings });
  }

  onSweep(sweep) {
    const now = Date.now();
    if (now - this.lastSweepAt < SWEEP_INTERVAL_MS || this.clients.size === 0) return;
    this.lastSweepAt = now;
    const frame = Buffer.alloc(12 + sweep.pixels.length);
    frame[0] = 0x01;
    frame[1] = sweep.mode;
    frame[2] = sweep.outOfRange ? 1 : 0;
    frame.writeFloatLE(sweep.start / 1e6, 4);
    frame.writeFloatLE(sweep.end / 1e6, 8);
    sweep.pixels.copy(frame, 12);
    for (const c of this.clients) c.ws.sendBinary(frame, true);
  }

  // pcm: 16-bit samples, left (main receiver) and right (second receiver)
  // alternating. Each page gets the receiver it asked for, or both.
  onAudio(pcm) {
    const frames = {};
    const frameFor = (mix) => {
      if (frames[mix]) return frames[mix];
      let body = pcm;
      if (mix !== 'both') {
        const samples = pcm.length >> 2;
        const at = mix === 'sub' ? 2 : 0;
        body = Buffer.allocUnsafe(samples * 2);
        for (let i = 0; i < samples; i++) body.writeInt16LE(pcm.readInt16LE(i * 4 + at), i * 2);
      }
      const frame = Buffer.alloc(6 + body.length);
      frame[0] = 0x02;
      frame[1] = mix === 'both' ? 2 : 1; // channels
      frame.writeUInt16LE(this.audioSeq, 2);
      frame.writeUInt16LE(SAMPLE_RATE / 1000, 4);
      body.copy(frame, 6);
      frames[mix] = frame;
      return frame;
    };
    let any = false;
    for (const c of this.clients) {
      if (!c.listening) continue;
      any = true;
      c.ws.sendBinary(frameFor(c.mix), true);
    }
    if (any) this.audioSeq = (this.audioSeq + 1) & 0xffff;
  }

  // -------------------------------------------------------- Page → radio

  addClient(ws) {
    const client = { ws, listening: false, mix: 'main' };
    this.clients.add(client);
    ws.sendJson(this.rigInfo());
    if (this.rig) ws.sendJson({ type: 'status', ...this.rig.state });
    else if (this.problem) ws.sendJson({ type: 'error', message: this.describeProblem() });

    ws.on('text', (text) => {
      let msg;
      try {
        msg = JSON.parse(text);
      } catch {
        return;
      }
      if (msg && typeof msg.cmd === 'string') this.onCommand(client, msg);
    });
    ws.on('binary', (data) => {
      // Microphone audio counts only from the page that is holding the key.
      if (data.length > 6 && data[0] === 0x03 && this.talker === client && this.session) {
        this.lastMicAt = Date.now();
        this.session.sendAudio(data.subarray(6));
      }
    });
    ws.on('close', () => {
      this.clients.delete(client);
      if (this.talker === client) this.setTalker(null);
    });
  }

  // Who may transmit: one page at a time. Passing null unkeys the radio.
  setTalker(client) {
    clearTimeout(this.talkTimer);
    clearInterval(this.talkWatch);
    const rig = this.rig;
    if (!client) {
      if (!this.talker) return Promise.resolve();
      this.talker = null;
      return rig ? rig.setTransmit(false) : Promise.resolve();
    }
    if (!rig || (this.talker && this.talker !== client)) return Promise.resolve();
    this.talker = client;
    this.talkTimer = setTimeout(() => {
      this.log('Radio: transmit time limit reached, unkeying');
      this.setTalker(null);
    }, TALK_LIMIT_MS);
    // A page that has gone quiet (a phone that lost its Wi-Fi, say) may not
    // be able to tell us to stop, so its silence is taken as letting go.
    this.lastMicAt = Date.now();
    this.talkWatch = setInterval(() => {
      if (Date.now() - this.lastMicAt < MIC_SILENCE_MS) return;
      this.log('Radio: no microphone audio arriving, unkeying');
      client.ws.sendJson({ type: 'error', message: 'Stopped transmitting: your microphone audio stopped arriving.' });
      this.setTalker(null);
    }, 500);
    return rig.setTransmit(true);
  }

  onCommand(client, msg) {
    const { cmd, value } = msg;

    if (cmd === 'reconnectLan') {
      if (!this.session) this.connect();
      return;
    }
    if (cmd === 'enableAudio') {
      client.listening = !!value;
      client.ws.sendJson({ type: 'audioStatus', enabled: client.listening, sampleRate: SAMPLE_RATE });
      return;
    }
    if (cmd === 'enableMic') return; // nothing to prepare: audio is accepted while the key is held
    if (cmd === 'setAudioMix') {
      if (['main', 'sub', 'both'].includes(value)) client.mix = value;
      return;
    }

    const rig = this.rig;
    if (!rig) return;
    const number = Number(value);
    const inBand = (hz) => Number.isFinite(hz) && this.profile.bands.some((b) => hz >= b.start && hz <= b.end);

    switch (cmd) {
      case 'getStatus':
        client.ws.sendJson({ type: 'status', ...rig.state });
        break;
      case 'setPTT':
        // Unkeying is honoured from the page that keyed, and from nobody else.
        if (value) this.setTalker(client);
        else if (this.talker === client) this.setTalker(null);
        break;
      case 'setFrequency':
        if (inBand(number)) rig.setFrequency(Math.round(number));
        break;
      case 'setMode':
        rig.setMode(String(value));
        break;
      case 'setDuplex':
        rig.setDuplex(String(value));
        break;
      case 'setDuplexOffset':
        if (number >= 0 && number < 100e6) rig.setDuplexOffset(number);
        break;
      case 'setToneMode':
        rig.setToneMode(String(value));
        break;
      case 'setToneFreq':
        if (this.profile.ctcssTones.includes(number)) rig.setTone('tone', number);
        break;
      case 'setTsqlFreq':
        if (this.profile.ctcssTones.includes(number)) rig.setTone('tsql', number);
        break;
      case 'setSpan':
        rig.setSpan(number);
        break;
      case 'setScopeMode':
        if (number >= 0 && number <= 3) rig.setScopeMode(number);
        break;
      case 'setSquelch':
        if (Number.isFinite(number)) rig.setSquelch(number);
        break;
      case 'setRfPower':
        if (Number.isFinite(number)) rig.setRfPower(number);
        break;
      case 'setPreamp':
        rig.setPreamp(number);
        break;
      case 'setNoiseReduction':
        rig.setNoiseReduction(!!value);
        break;

      // --- Second receiver ---
      case 'setDualWatch':
        rig.setDualWatch(!!value);
        break;
      case 'setSubFrequency':
        if (inBand(number)) rig.setFrequency(Math.round(number), 'sub');
        break;
      case 'setSubMode':
        rig.setMode(String(value), 'sub');
        break;
      case 'setSubSquelch':
        if (Number.isFinite(number)) rig.setSquelch(number, 'sub');
        break;
      case 'swapBands':
        if (!this.talker) rig.swapBands();
        break;

      // --- Scanning: "go here and tell me if anyone is talking" ---
      case 'scanProbe': {
        const hz = value ? Math.round(number) : 0;
        if (hz && !inBand(hz)) break;
        if (this.talker) {
          client.ws.sendJson({ type: 'scanResult', id: msg.id, busy: null });
          break;
        }
        rig.probe(hz, msg.mode ? String(msg.mode) : null).then((result) => {
          client.ws.sendJson({ type: 'scanResult', id: msg.id, ...result });
        });
        break;
      }

      // --- Satellites ---
      case 'satStart': {
        const downlink = Math.round(Number(msg.downlink));
        const uplink = Math.round(Number(msg.uplink));
        const tone = Number(msg.tone) || 0;
        if (!inBand(downlink) || !inBand(uplink) || this.talker) break;
        if (tone && !this.profile.ctcssTones.includes(tone)) break;
        rig.satelliteStart({ downlink, uplink, mode: String(msg.mode || 'FM'), tone });
        break;
      }
      case 'satTune': {
        const downlink = Math.round(Number(msg.downlink)) || 0;
        const uplink = Math.round(Number(msg.uplink)) || 0;
        rig.satelliteTune({ downlink: inBand(downlink) ? downlink : 0, uplink: inBand(uplink) ? uplink : 0 });
        break;
      }
      case 'satStop':
        if (!this.talker) rig.satelliteStop();
        break;
      default:
        break;
    }
  }

  // Unkeys, logs out and closes. Safe to call more than once.
  async stop() {
    if (this.stopping) return;
    this.stopping = true;
    clearTimeout(this.retryTimer);
    clearTimeout(this.talkTimer);
    clearInterval(this.talkWatch);
    const rig = this.rig;
    const session = this.session;
    if (rig && (this.talker || rig.state.transmitting)) {
      this.talker = null;
      // Wait for the unkey to be acknowledged, but not for ever.
      await Promise.race([rig.setTransmit(false), new Promise((r) => setTimeout(r, 800))]);
    }
    if (rig && rig.satelliteByUs) {
      // Hand the radio back the way it was found.
      await Promise.race([rig.satelliteStop(), new Promise((r) => setTimeout(r, 800))]);
    }
    if (rig) rig.stop();
    if (session) session.close();
    for (const c of this.clients) c.ws.close(1001);
    // Let the goodbye packets leave before the process exits.
    await new Promise((r) => setTimeout(r, 150));
  }
}

module.exports = { DirectBackend };
