'use strict';

// Byte layouts of Icom's network remote-control protocol (the one RS-BA1
// speaks to radios such as the IC-705, IC-7610 and IC-9700).
//
// Icom has not published it. These layouts follow two open-source
// implementations that documented it: kappanhang (MIT, Norbert Varga HA2NON
// and Akos Marton ES1AKOS) and wfview. Nothing here is copied from either;
// the offsets and constants are facts about the wire format.
//
// Every packet starts with the same 16 bytes:
//
//   0   u32 LE  length of the whole packet
//   4   u16 LE  type (see TYPE)
//   6   u16 LE  sequence number
//   8   u32     sender's session id
//   12  u32     receiver's session id
//
// Session ids are opaque: each side picks its own and echoes the other's.

const HEADER = 16;

const TYPE = {
  DATA: 0x00, // idle when 16 bytes long, otherwise carries a payload
  RETRANSMIT: 0x01,
  ARE_YOU_THERE: 0x03,
  I_AM_HERE: 0x04,
  DISCONNECT: 0x05,
  READY: 0x06, // "are you ready" one way, "I am ready" back
  PING: 0x07,
};

const LEN = {
  PING: 0x15,
  TOKEN: 0x40,
  STATUS: 0x50,
  LOGIN_REPLY: 0x60,
  LOGIN: 0x80,
  CONNINFO: 0x90,
  CAPABILITIES: 0xa8,
  CIV_HEADER: 0x15,
  CIV_OPEN: 0x16,
  AUDIO_HEADER: 0x18,
};

// What the token packet asks for.
const TOKEN = { REMOVE: 0x01, CONFIRM: 0x02, RENEW: 0x05 };

// Audio formats the radio offers. 0x04 is 16-bit mono PCM.
const CODEC_PCM16_MONO = 0x04;
const CODEC_PCM16_STEREO = 0x10; // on a two-receiver radio: main on the left, second receiver on the right

function header(length, type, myId, remoteId) {
  const b = Buffer.alloc(length);
  b.writeUInt32LE(length, 0);
  b.writeUInt16LE(type, 4);
  b.writeUInt32BE(myId >>> 0, 8);
  b.writeUInt32BE(remoteId >>> 0, 12);
  return b;
}

function control(type, seq, myId, remoteId) {
  const b = header(HEADER, type, myId, remoteId);
  b.writeUInt16LE(seq & 0xffff, 6);
  return b;
}

// payload: 4 bytes the other side echoes back, so a reply can be matched.
function ping(seq, myId, remoteId, isReply, payload) {
  const b = header(LEN.PING, TYPE.PING, myId, remoteId);
  b.writeUInt16LE(seq & 0xffff, 6);
  b[16] = isReply ? 0x01 : 0x00;
  payload.copy(b, 17, 0, 4);
  return b;
}

// User names and passwords are not sent as typed: each character is shifted
// by its position and swapped through this table (index 0 is character 32).
const PASSCODE_TABLE = Buffer.from(
  '475d4c42662023464e57453d677660416239592d687e7c657d4929727378216e' +
    '5a5e4a3e712c2a543c3a634f437527795b3570486b566f34326c30616d7b2f4b' +
    '64382b2e50403f55333725772426746a28534d69225c443136583b7a515f52',
  'hex',
);

function passcode(text) {
  const out = Buffer.alloc(16);
  for (let i = 0; i < text.length && i < 16; i++) {
    let p = text.charCodeAt(i) + i;
    if (p > 126) p = 32 + (p % 127);
    out[i] = p >= 32 ? PASSCODE_TABLE[p - 32] : 0;
  }
  return out;
}

// The part shared by login, token and connection-info packets.
function authHeader(length, requestType, s) {
  const b = header(length, TYPE.DATA, s.myId, s.remoteId);
  b.writeUInt16BE(length - HEADER, 0x12);
  b[0x14] = 0x01; // this is a request
  b[0x15] = requestType;
  b.writeUInt16BE(s.innerSeq & 0xffff, 0x16);
  return b;
}

// s: { myId, remoteId, innerSeq }
function login(s, { user, pass, clientName, tokenRequest }) {
  const b = authHeader(LEN.LOGIN, 0x00, s);
  b.writeUInt16LE(tokenRequest & 0xffff, 0x1a);
  passcode(user).copy(b, 0x40);
  passcode(pass).copy(b, 0x50);
  b.write(clientName.slice(0, 15), 0x60, 'ascii');
  return b;
}

// authId: the 6 bytes the radio issued in its login reply.
function token(s, authId, what) {
  const b = authHeader(LEN.TOKEN, what, s);
  authId.copy(b, 0x1a, 0, 6);
  return b;
}

// Asks the radio to open its command and audio streams towards our ports.
function connInfoRequest(s, authId, o) {
  const b = authHeader(LEN.CONNINFO, 0x03, s);
  authId.copy(b, 0x1a, 0, 6);
  o.guid.copy(b, 0x20, 0, 16);
  b.write(o.radioName.slice(0, 31), 0x40, 'ascii');
  passcode(o.user).copy(b, 0x60);
  b[0x70] = 0x01; // receive audio wanted
  b[0x71] = 0x01; // transmit audio wanted
  b[0x72] = o.stereo ? CODEC_PCM16_STEREO : CODEC_PCM16_MONO; // what the radio sends us
  b[0x73] = CODEC_PCM16_MONO; // what we send it
  b.writeUInt32BE(o.sampleRate, 0x74);
  b.writeUInt32BE(o.sampleRate, 0x78);
  b.writeUInt32BE(o.civPort, 0x7c);
  b.writeUInt32BE(o.audioPort, 0x80);
  b.writeUInt32BE(o.txBufferMs, 0x84);
  b[0x88] = 0x01;
  return b;
}

function isLoginRejected(reply) {
  return reply[0x30] === 0xff && reply[0x31] === 0xff && reply[0x32] === 0xff && reply[0x33] === 0xfe;
}

function cString(buf, start, maxLen) {
  const slice = buf.subarray(start, start + maxLen);
  const end = slice.indexOf(0);
  return slice.subarray(0, end < 0 ? slice.length : end).toString('ascii');
}

// The first radio described in a capabilities packet.
function parseCapabilities(b) {
  return {
    guid: Buffer.from(b.subarray(0x42, 0x52)),
    mac: Buffer.from(b.subarray(0x4c, 0x52)).toString('hex').replace(/(..)(?=.)/g, '$1:'),
    name: cString(b, 0x52, 32),
    audioName: cString(b, 0x72, 32),
    civAddress: b[0x94],
  };
}

function parseStatus(b) {
  return {
    failed: b[0x30] === 0xff && b[0x31] === 0xff && b[0x32] === 0xff,
    disconnected: b[0x30] === 0 && b[0x31] === 0 && b[0x32] === 0 && b[0x40] === 0x01,
    civPort: b.readUInt16BE(0x42),
    audioPort: b.readUInt16BE(0x46),
  };
}

// Radio's view of who is connected.
function parseConnInfo(b) {
  return { name: cString(b, 0x40, 32), busy: b[0x60] === 0x01, computer: cString(b, 0x64, 16) };
}

// --- Command (CI-V) stream ---

function civOpenClose(myId, remoteId, sendSeq, open) {
  const b = header(LEN.CIV_OPEN, TYPE.DATA, myId, remoteId);
  b[0x10] = 0xc0;
  b[0x11] = 0x01;
  b.writeUInt16BE(sendSeq & 0xffff, 0x13);
  b[0x15] = open ? 0x04 : 0x00;
  return b;
}

function civData(myId, remoteId, sendSeq, data) {
  const b = header(LEN.CIV_HEADER + data.length, TYPE.DATA, myId, remoteId);
  b[0x10] = 0xc1;
  b.writeUInt16LE(data.length, 0x11);
  b.writeUInt16BE(sendSeq & 0xffff, 0x13);
  data.copy(b, LEN.CIV_HEADER);
  return b;
}

// Returns the CI-V bytes carried by a command-stream packet, or null.
function civPayload(b) {
  if (b.length <= LEN.CIV_HEADER || b[0x10] !== 0xc1) return null;
  const n = b.readUInt16LE(0x11);
  if (LEN.CIV_HEADER + n > b.length) return null;
  return b.subarray(LEN.CIV_HEADER, LEN.CIV_HEADER + n);
}

// --- Audio stream ---

function audioData(myId, remoteId, sendSeq, pcm) {
  const b = header(LEN.AUDIO_HEADER + pcm.length, TYPE.DATA, myId, remoteId);
  b[0x10] = 0x80;
  b.writeUInt16BE(sendSeq & 0xffff, 0x12);
  b.writeUInt16BE(pcm.length, 0x16);
  pcm.copy(b, LEN.AUDIO_HEADER);
  return b;
}

function audioPayload(b) {
  if (b.length <= LEN.AUDIO_HEADER) return null;
  const n = b.readUInt16BE(0x16);
  if (n === 0 || LEN.AUDIO_HEADER + n > b.length) return null;
  return b.subarray(LEN.AUDIO_HEADER, LEN.AUDIO_HEADER + n);
}

module.exports = {
  HEADER,
  TYPE,
  LEN,
  TOKEN,
  control,
  ping,
  passcode,
  login,
  token,
  connInfoRequest,
  isLoginRejected,
  parseCapabilities,
  parseStatus,
  parseConnInfo,
  civOpenClose,
  civData,
  civPayload,
  audioData,
  audioPayload,
};
