'use strict';

// Logs in to the radio and opens its command and audio streams.
//
//   1. control stream: handshake, log in, receive a token and keep it fresh
//   2. the radio describes itself (name, CI-V address)
//   3. ask it to open the command and audio streams to two ports of ours
//   4. handshake on each of those
//
// Events: 'civ' (bytes from the radio's command port), 'audio' (PCM samples),
//         'lost' (reason; the session is unusable afterwards, make a new one)

const crypto = require('crypto');
const { EventEmitter } = require('events');
const { IcomStream } = require('./stream');
const P = require('./packets');

const SAMPLE_RATE = 48000;
const TX_BUFFER_MS = 300; // more than about 500 and the radio stops accepting transmit audio
const TOKEN_RENEW_MS = 60 * 1000;
const STEP_TIMEOUT_MS = 5000;

// One 20 ms block of transmit audio goes out as two packets of these sizes,
// which is how the radio itself splits the audio it sends.
const TX_BLOCK_BYTES = 1920;
const TX_FIRST_PART = 1364;

class LoginError extends Error {}

class IcomSession extends EventEmitter {
  constructor({ host, user, pass, controlPort = 50001, clientName = 'radio-console', stereo = false }) {
    super();
    this.host = host;
    this.user = user;
    this.pass = pass;
    this.controlPort = controlPort;
    this.clientName = clientName;
    this.sampleRate = SAMPLE_RATE;
    this.stereo = stereo; // ask for the two receivers on separate channels

    this.control = null;
    this.civ = null;
    this.audio = null;
    this.innerSeq = 0x30;
    this.authId = null;
    this.radio = null; // { name, civAddress, mac, guid, audioName }
    this.tokenAcked = false;
    this.grant = null; // { civPort, audioPort } once the radio agrees to open streams
    this.refused = null; // why it did not
    this.requested = false;
    this.connInfo = null;
    this.waiters = [];
    this.civSeq = 0;
    this.audioSeq = 0;
    this.renewTimer = null;
    this.txPending = Buffer.alloc(0);
    this.grantFallback = null;
    this.ended = false;
  }

  authState() {
    const s = { myId: this.control.myId, remoteId: this.control.remoteId, innerSeq: this.innerSeq };
    this.innerSeq = (this.innerSeq + 1) & 0xffff;
    return s;
  }

  // Resolves once test() is true; checked again after every control packet.
  until(test, what) {
    if (test()) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const waiter = { test, resolve, reject };
      waiter.timer = setTimeout(() => {
        this.waiters = this.waiters.filter((w) => w !== waiter);
        reject(new Error(what));
      }, STEP_TIMEOUT_MS);
      this.waiters.push(waiter);
    });
  }

  checkWaiters() {
    for (const w of this.waiters.slice()) {
      if (w.test()) {
        clearTimeout(w.timer);
        this.waiters = this.waiters.filter((x) => x !== w);
        w.resolve();
      }
    }
  }

  fail(reason) {
    if (this.ended) return;
    this.close();
    this.emit('lost', reason);
  }

  onControlPacket(b) {
    switch (b.length) {
      case P.LEN.LOGIN_REPLY:
        this.loginReply = Buffer.from(b);
        break;
      case P.LEN.TOKEN:
        if (b[0x15] === P.TOKEN.RENEW) this.tokenAcked = true;
        break;
      case P.LEN.STATUS: {
        const status = P.parseStatus(b);
        if (status.failed) {
          this.refused = this.grant ? 'the radio ended the session' : 'the radio refused to open its streams';
          if (this.grant) this.fail(this.refused);
        } else if (status.disconnected) {
          this.fail('the radio closed the connection');
        } else if (this.requested && !this.grant && status.civPort && status.audioPort) {
          this.grant = { civPort: status.civPort, audioPort: status.audioPort };
        }
        break;
      }
      case P.LEN.CONNINFO:
        this.connInfo = P.parseConnInfo(b);
        // The radio normally confirms with a status packet carrying its port
        // numbers. If only this "in use" notice arrives, assume the usual ports.
        if (this.requested && !this.grant && this.connInfo.busy && !this.grantFallback) {
          this.grantFallback = setTimeout(() => {
            if (!this.grant && !this.refused && !this.ended) {
              this.grant = { civPort: 50002, audioPort: 50003 };
              this.checkWaiters();
            }
          }, 700);
        }
        break;
      default:
        // Capabilities: 0x42 bytes of header plus 0x66 for each radio.
        if (b.length >= P.LEN.CAPABILITIES && !this.radio) this.radio = P.parseCapabilities(b);
    }
    this.checkWaiters();
  }

  async connect() {
    const control = (this.control = new IcomStream('control', this.host, this.controlPort));
    control.on('data', (b) => this.onControlPacket(b));
    control.on('lost', (why) => this.fail(why));
    control.on('disconnect', () => this.fail('the radio closed the connection'));
    await control.bind();
    await control.handshake();

    control.sendTracked(
      P.login(this.authState(), {
        user: this.user,
        pass: this.pass,
        clientName: this.clientName,
        tokenRequest: crypto.randomBytes(2).readUInt16LE(0),
      }),
    );
    await this.until(() => this.loginReply, 'the radio did not answer the login');
    if (P.isLoginRejected(this.loginReply)) {
      throw new LoginError('The radio rejected the user name or password.');
    }
    this.authId = Buffer.from(this.loginReply.subarray(0x1a, 0x20));

    control.startPing();
    control.sendTracked(P.token(this.authState(), this.authId, P.TOKEN.CONFIRM));
    control.startIdle();
    control.sendTracked(P.token(this.authState(), this.authId, P.TOKEN.RENEW));
    await this.until(() => this.radio && this.tokenAcked, 'the radio did not describe itself after login');

    // Our ends of the two extra streams, so we can tell the radio the ports.
    const civ = (this.civ = new IcomStream('command', this.host, 50002));
    const audio = (this.audio = new IcomStream('audio', this.host, 50003));
    await civ.bind();
    await audio.bind();

    this.requested = true;
    control.sendTracked(
      P.connInfoRequest(this.authState(), this.authId, {
        guid: this.radio.guid,
        radioName: this.radio.name,
        user: this.user,
        sampleRate: SAMPLE_RATE,
        civPort: civ.localPort,
        audioPort: audio.localPort,
        txBufferMs: TX_BUFFER_MS,
        stereo: this.stereo,
      }),
    );
    await this.until(
      () => this.grant || this.refused,
      'the radio did not open its command and audio streams (is another program connected to it?)',
    );
    if (!this.grant) throw new Error(this.refused);

    civ.port = this.grant.civPort;
    audio.port = this.grant.audioPort;

    civ.on('data', (b) => {
      const data = P.civPayload(b);
      if (data) this.emit('civ', data);
    });
    civ.on('lost', (why) => this.fail(why));
    await civ.handshake();
    civ.startPing();
    civ.startIdle();
    civ.sendTracked(P.civOpenClose(civ.myId, civ.remoteId, this.civSeq++, true));

    audio.on('data', (b) => {
      const pcm = P.audioPayload(b);
      if (pcm) this.emit('audio', pcm);
    });
    audio.on('lost', (why) => this.fail(why));
    await audio.handshake();
    audio.startPing();

    this.renewTimer = setInterval(() => {
      control.sendTracked(P.token(this.authState(), this.authId, P.TOKEN.RENEW));
    }, TOKEN_RENEW_MS);
  }

  // data: a complete CI-V frame, FE FE ... FD.
  sendCiv(data) {
    if (this.ended || !this.civ) return;
    this.civ.sendTracked(P.civData(this.civ.myId, this.civ.remoteId, this.civSeq, data));
    this.civSeq = (this.civSeq + 1) & 0xffff;
  }

  // pcm: 16-bit mono samples at 48 kHz, any length. Sent on in 20 ms blocks.
  sendAudio(pcm) {
    if (this.ended || !this.audio) return;
    this.txPending = this.txPending.length ? Buffer.concat([this.txPending, pcm]) : pcm;
    while (this.txPending.length >= TX_BLOCK_BYTES) {
      const block = this.txPending.subarray(0, TX_BLOCK_BYTES);
      this.txPending = this.txPending.subarray(TX_BLOCK_BYTES);
      for (const part of [block.subarray(0, TX_FIRST_PART), block.subarray(TX_FIRST_PART)]) {
        this.audio.sendTracked(P.audioData(this.audio.myId, this.audio.remoteId, this.audioSeq, part));
        this.audioSeq = (this.audioSeq + 1) & 0xffff;
      }
    }
  }

  // Forget any half-filled transmit block (called when transmitting stops).
  flushAudio() {
    this.txPending = Buffer.alloc(0);
  }

  close() {
    if (this.ended) return;
    this.ended = true;
    clearInterval(this.renewTimer);
    clearTimeout(this.grantFallback);
    for (const w of this.waiters) {
      clearTimeout(w.timer);
      w.reject(new Error('connection closed'));
    }
    this.waiters = [];
    try {
      if (this.civ && this.civ.remoteId) {
        this.civ.sendTracked(P.civOpenClose(this.civ.myId, this.civ.remoteId, this.civSeq++, false));
      }
      if (this.control && this.authId && this.control.remoteId) {
        const s = { myId: this.control.myId, remoteId: this.control.remoteId, innerSeq: this.innerSeq++ };
        this.control.sendTracked(P.token(s, this.authId, P.TOKEN.REMOVE));
      }
    } catch {
      /* the sockets may already be gone */
    }
    for (const stream of [this.audio, this.civ, this.control]) {
      if (stream) stream.close();
    }
  }
}

module.exports = { IcomSession, LoginError, SAMPLE_RATE };
