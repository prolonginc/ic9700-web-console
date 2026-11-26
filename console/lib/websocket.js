'use strict';

// A small WebSocket server, enough for a browser page on the same machine:
// text and binary messages in both directions, ping/pong, and close.
// (RFC 6455, without extensions such as compression.)

const crypto = require('crypto');
const { EventEmitter } = require('events');

const MAGIC = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const MAX_MESSAGE_BYTES = 1 << 20;
const SLOW_CLIENT_BYTES = 2 << 20; // drop droppable frames once this much is waiting

const OP = { CONTINUE: 0x0, TEXT: 0x1, BINARY: 0x2, CLOSE: 0x8, PING: 0x9, PONG: 0xa };

function refuse(socket, status, text) {
  socket.end(`HTTP/1.1 ${status}\r\nContent-Type: text/plain\r\nConnection: close\r\n\r\n${text}\n`);
}

// A page may only connect to the server it was loaded from. Without this,
// any website open in the same browser could connect and operate the radio.
function sameSite(req) {
  const origin = req.headers.origin;
  if (!origin) return true; // not a browser
  try {
    return new URL(origin).host === req.headers.host;
  } catch {
    return false;
  }
}

// Completes the handshake for an HTTP upgrade request. Returns a Connection,
// or null if the request was refused.
function accept(req, socket, head) {
  const key = req.headers['sec-websocket-key'];
  if (!key || String(req.headers.upgrade).toLowerCase() !== 'websocket') {
    refuse(socket, '400 Bad Request', 'Expected a WebSocket handshake');
    return null;
  }
  if (!sameSite(req)) {
    refuse(socket, '403 Forbidden', 'Forbidden: cross-site WebSocket');
    return null;
  }
  const answer = crypto.createHash('sha1').update(key + MAGIC).digest('base64');
  socket.write(
    'HTTP/1.1 101 Switching Protocols\r\n' +
      'Upgrade: websocket\r\n' +
      'Connection: Upgrade\r\n' +
      `Sec-WebSocket-Accept: ${answer}\r\n\r\n`,
  );
  socket.setNoDelay(true);
  const connection = new Connection(socket);
  if (head && head.length) connection.receive(head);
  return connection;
}

// Events: 'text' (string), 'binary' (Buffer), 'close'
class Connection extends EventEmitter {
  constructor(socket) {
    super();
    this.socket = socket;
    this.buffer = Buffer.alloc(0);
    this.parts = []; // a message split across frames
    this.partsOp = 0;
    this.partsBytes = 0;
    this.open = true;
    socket.on('data', (chunk) => this.receive(chunk));
    socket.on('close', () => this.ended());
    socket.on('error', () => this.ended());
  }

  ended() {
    if (!this.open) return;
    this.open = false;
    this.socket.destroy();
    this.emit('close');
  }

  receive(chunk) {
    this.buffer = this.buffer.length ? Buffer.concat([this.buffer, chunk]) : chunk;
    while (this.open) {
      const b = this.buffer;
      if (b.length < 2) return;
      const fin = (b[0] & 0x80) !== 0;
      const op = b[0] & 0x0f;
      const masked = (b[1] & 0x80) !== 0;
      let length = b[1] & 0x7f;
      let offset = 2;
      if (length === 126) {
        if (b.length < 4) return;
        length = b.readUInt16BE(2);
        offset = 4;
      } else if (length === 127) {
        if (b.length < 10) return;
        const big = b.readBigUInt64BE(2);
        if (big > BigInt(MAX_MESSAGE_BYTES)) return this.close(1009);
        length = Number(big);
        offset = 10;
      }
      // Browsers always mask what they send; anything else is not a browser.
      if (!masked || length > MAX_MESSAGE_BYTES) return this.close(1002);
      if (b.length < offset + 4 + length) return;

      const mask = b.subarray(offset, offset + 4);
      const payload = Buffer.from(b.subarray(offset + 4, offset + 4 + length));
      for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i & 3];
      this.buffer = b.subarray(offset + 4 + length);
      this.frame(fin, op, payload);
    }
  }

  frame(fin, op, payload) {
    if (op === OP.CLOSE) {
      this.close(1000);
      return;
    }
    if (op === OP.PING) {
      this.write(OP.PONG, payload);
      return;
    }
    if (op === OP.PONG) return;

    if (op !== OP.CONTINUE) {
      this.parts = [];
      this.partsBytes = 0;
      this.partsOp = op;
    }
    this.parts.push(payload);
    this.partsBytes += payload.length;
    if (this.partsBytes > MAX_MESSAGE_BYTES) {
      this.close(1009);
      return;
    }
    if (!fin) return;

    const message = this.parts.length === 1 ? this.parts[0] : Buffer.concat(this.parts);
    this.parts = [];
    if (this.partsOp === OP.TEXT) this.emit('text', message.toString('utf8'));
    else if (this.partsOp === OP.BINARY) this.emit('binary', message);
  }

  write(op, payload) {
    if (!this.open) return;
    const n = payload.length;
    let head;
    if (n < 126) {
      head = Buffer.from([0x80 | op, n]);
    } else if (n < 65536) {
      head = Buffer.alloc(4);
      head[0] = 0x80 | op;
      head[1] = 126;
      head.writeUInt16BE(n, 2);
    } else {
      head = Buffer.alloc(10);
      head[0] = 0x80 | op;
      head[1] = 127;
      head.writeBigUInt64BE(BigInt(n), 2);
    }
    this.socket.write(Buffer.concat([head, payload]));
  }

  sendText(text) {
    this.write(OP.TEXT, Buffer.from(text, 'utf8'));
  }

  sendJson(value) {
    this.sendText(JSON.stringify(value));
  }

  // droppable: live data (audio, spectrum) that is better skipped than
  // queued when the browser is not keeping up.
  sendBinary(data, droppable = false) {
    if (droppable && this.socket.writableLength > SLOW_CLIENT_BYTES) return;
    this.write(OP.BINARY, data);
  }

  close(code = 1000) {
    if (!this.open) return;
    const body = Buffer.alloc(2);
    body.writeUInt16BE(code, 0);
    this.write(OP.CLOSE, body);
    this.open = false;
    this.socket.end();
    this.emit('close');
  }
}

module.exports = { accept };
