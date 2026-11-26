'use strict';

// CI-V: the command language Icom radios speak. A frame looks like
//
//   FE FE <to> <from> <command> [sub-command] [data...] FD
//
// Numbers travel as binary-coded decimal: each half of a byte is one digit.

const PREAMBLE = 0xfe;
const END = 0xfd;
const OK = 0xfb;
const NG = 0xfa;

function frame(to, from, payload) {
  return Buffer.concat([Buffer.from([PREAMBLE, PREAMBLE, to, from]), Buffer.from(payload), Buffer.from([END])]);
}

// Turns the byte stream from the radio back into frames. A network packet
// usually holds exactly one, but nothing guarantees it.
class CivParser {
  constructor() {
    this.pending = Buffer.alloc(0);
  }

  // Returns [{ to, from, payload }] for every complete frame.
  push(bytes) {
    this.pending = this.pending.length ? Buffer.concat([this.pending, bytes]) : Buffer.from(bytes);
    const frames = [];
    for (;;) {
      const start = this.pending.indexOf(Buffer.from([PREAMBLE, PREAMBLE]));
      if (start < 0) {
        this.pending = Buffer.alloc(0);
        break;
      }
      const end = this.pending.indexOf(END, start + 2);
      if (end < 0) {
        this.pending = this.pending.subarray(start);
        break;
      }
      // Skip any extra preamble bytes.
      let body = start + 2;
      while (this.pending[body] === PREAMBLE) body++;
      if (end - body >= 3) {
        frames.push({
          to: this.pending[body],
          from: this.pending[body + 1],
          payload: Buffer.from(this.pending.subarray(body + 2, end)),
        });
      }
      this.pending = this.pending.subarray(end + 1);
    }
    if (this.pending.length > 4096) this.pending = Buffer.alloc(0);
    return frames;
  }
}

function bcdByte(n) {
  return (Math.floor(n / 10) << 4) | n % 10;
}

function fromBcdByte(b) {
  return (b >> 4) * 10 + (b & 0x0f);
}

// Little-endian BCD: the first byte holds the two lowest digits. Used for
// frequencies (5 bytes, hertz) and repeater offsets (3 bytes, units of 100 Hz).
function toBcdLE(value, bytes) {
  const out = [];
  let v = Math.round(value);
  for (let i = 0; i < bytes; i++) {
    out.push(bcdByte(v % 100));
    v = Math.floor(v / 100);
  }
  return out;
}

function fromBcdLE(buf) {
  let value = 0;
  for (let i = buf.length - 1; i >= 0; i--) value = value * 100 + fromBcdByte(buf[i]);
  return value;
}

// Big-endian BCD: the first byte holds the highest digits. Used for levels
// (2 bytes, 0000 to 0255) and tone frequencies (tenths of a hertz).
function toBcdBE(value, bytes) {
  return toBcdLE(value, bytes).reverse();
}

function fromBcdBE(buf) {
  let value = 0;
  for (const b of buf) value = value * 100 + fromBcdByte(b);
  return value;
}

function startsWith(buf, prefix) {
  if (buf.length < prefix.length) return false;
  for (let i = 0; i < prefix.length; i++) if (buf[i] !== prefix[i]) return false;
  return true;
}

module.exports = { OK, NG, frame, CivParser, toBcdLE, fromBcdLE, toBcdBE, fromBcdBE, fromBcdByte, startsWith };
