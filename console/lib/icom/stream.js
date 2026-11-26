'use strict';

// One UDP conversation with the radio. The control, command and audio streams
// each run one of these, with the same housekeeping:
//
//   - a handshake ("are you there" / "I am here", then "ready" both ways)
//   - pings in both directions, which is how each side knows the other is alive
//   - idle packets whenever there is nothing else to say
//   - a short memory of what was sent, so the radio can ask for a repeat
//
// Events: 'data' (a payload packet), 'lost' (the radio stopped answering),
//         'disconnect' (the radio closed the stream).

const dgram = require('dgram');
const crypto = require('crypto');
const { EventEmitter } = require('events');
const P = require('./packets');

const HANDSHAKE_RETRY_MS = 300;
const HANDSHAKE_TIMEOUT_MS = 4000;
const IDLE_INTERVAL_MS = 100;
const PING_INTERVAL_MS = 1000;
const PING_TIMEOUT_MS = 6000;
const RESEND_MEMORY = 512; // packets kept for the radio to re-request
const DEDUP_MEMORY = 128;

class IcomStream extends EventEmitter {
  constructor(name, host, port) {
    super();
    this.name = name;
    this.host = host;
    this.port = port;
    this.socket = null;
    this.localPort = 0;
    this.myId = crypto.randomBytes(4).readUInt32BE(0);
    this.remoteId = 0;
    this.txSeq = 1;
    this.sent = new Map(); // seq -> packet
    this.seen = []; // recent incoming sequence numbers
    this.pingSeq = 1;
    this.lastHeardAt = 0;
    this.lastTrackedAt = 0;
    this.timers = [];
    this.closed = false;
  }

  bind() {
    return new Promise((resolve, reject) => {
      const socket = dgram.createSocket('udp4');
      socket.once('error', reject);
      socket.bind(0, () => {
        socket.off('error', reject);
        socket.on('error', (err) => this.emit('lost', err.message));
        socket.on('message', (msg) => this.receive(msg));
        this.socket = socket;
        this.localPort = socket.address().port;
        resolve();
      });
    });
  }

  raw(packet) {
    if (this.closed || !this.socket) return;
    this.socket.send(packet, this.port, this.host);
  }

  // Sends a packet the radio may later ask to have repeated.
  sendTracked(packet) {
    if (this.closed) return;
    const seq = this.txSeq;
    this.txSeq = (this.txSeq + 1) & 0xffff;
    packet.writeUInt16LE(seq, 6);
    this.sent.set(seq, packet);
    if (this.sent.size > RESEND_MEMORY) this.sent.delete(this.sent.keys().next().value);
    this.lastTrackedAt = Date.now();
    this.raw(packet);
  }

  handshake() {
    return new Promise((resolve, reject) => {
      let waitingFor = P.TYPE.I_AM_HERE;
      const knock = () => {
        if (waitingFor === P.TYPE.I_AM_HERE) this.raw(P.control(P.TYPE.ARE_YOU_THERE, 0, this.myId, 0));
        else this.raw(P.control(P.TYPE.READY, 1, this.myId, this.remoteId));
      };
      const finish = (err) => {
        clearInterval(retry);
        clearTimeout(deadline);
        this.off('control', onControl);
        if (err) reject(err);
        else resolve();
      };
      const onControl = (type, packet) => {
        if (waitingFor === P.TYPE.I_AM_HERE && type === P.TYPE.I_AM_HERE) {
          this.remoteId = packet.readUInt32BE(8);
          waitingFor = P.TYPE.READY;
          knock();
        } else if (waitingFor === P.TYPE.READY && type === P.TYPE.READY) {
          this.lastHeardAt = Date.now();
          finish();
        }
      };
      this.on('control', onControl);
      const retry = setInterval(knock, HANDSHAKE_RETRY_MS);
      const deadline = setTimeout(
        () => finish(new Error(`no answer on the ${this.name} port (${this.port})`)),
        HANDSHAKE_TIMEOUT_MS,
      );
      knock();
    });
  }

  startPing() {
    this.lastHeardAt = Date.now();
    this.timers.push(
      setInterval(() => {
        this.raw(P.ping(this.pingSeq, this.myId, this.remoteId, false, crypto.randomBytes(4)));
        this.pingSeq = (this.pingSeq + 1) & 0xffff;
        if (Date.now() - this.lastHeardAt > PING_TIMEOUT_MS) this.emit('lost', `${this.name} stream went quiet`);
      }, PING_INTERVAL_MS),
    );
  }

  startIdle() {
    this.timers.push(
      setInterval(() => {
        if (Date.now() - this.lastTrackedAt >= IDLE_INTERVAL_MS) {
          this.sendTracked(P.control(P.TYPE.DATA, 0, this.myId, this.remoteId));
        }
      }, IDLE_INTERVAL_MS),
    );
  }

  receive(packet) {
    if (packet.length < P.HEADER) return;
    this.lastHeardAt = Date.now();
    const type = packet.readUInt16LE(4);

    // Pings are recognised by size: the radio does not always fill in the
    // length field on them.
    if (packet.length === P.LEN.PING && type === P.TYPE.PING) {
      if (packet[16] === 0x00) {
        const seq = packet.readUInt16LE(6);
        this.raw(P.ping(seq, this.myId, this.remoteId, true, packet.subarray(17, 21)));
      }
      return;
    }

    if (type === P.TYPE.RETRANSMIT) {
      if (packet.length === P.HEADER) {
        this.resend(packet.readUInt16LE(6));
      } else {
        for (let i = P.HEADER; i + 4 <= packet.length; i += 4) {
          const from = packet.readUInt16LE(i);
          const to = packet.readUInt16LE(i + 2);
          for (let seq = from, n = 0; n < RESEND_MEMORY; seq = (seq + 1) & 0xffff, n++) {
            this.resend(seq);
            if (seq === to) break;
          }
        }
      }
      return;
    }

    if (type === P.TYPE.I_AM_HERE || type === P.TYPE.READY) {
      this.emit('control', type, packet);
      return;
    }
    if (type === P.TYPE.DISCONNECT) {
      this.emit('disconnect');
      return;
    }
    if (type !== P.TYPE.DATA || packet.length === P.HEADER) return; // idle

    // A repeated packet (the radio resends when it thinks one was lost).
    const seq = packet.readUInt16LE(6);
    if (this.seen.includes(seq)) return;
    this.seen.push(seq);
    if (this.seen.length > DEDUP_MEMORY) this.seen.shift();

    this.emit('data', packet);
  }

  resend(seq) {
    const packet = this.sent.get(seq);
    // If it has been forgotten, an idle packet with that number satisfies
    // the radio and stops it asking.
    this.raw(packet || P.control(P.TYPE.DATA, seq, this.myId, this.remoteId));
  }

  close() {
    if (this.closed) return;
    for (const t of this.timers) clearInterval(t);
    this.timers = [];
    if (this.socket && this.remoteId) {
      const bye = P.control(P.TYPE.DISCONNECT, 0, this.myId, this.remoteId);
      this.raw(bye);
      this.raw(bye);
    }
    this.closed = true;
    if (this.socket) {
      const socket = this.socket;
      this.socket = null;
      // Give the goodbye a moment to leave before the socket goes away.
      setTimeout(() => {
        try {
          socket.close();
        } catch {
          /* already closed */
        }
      }, 50).unref();
    }
  }
}

module.exports = { IcomStream };
