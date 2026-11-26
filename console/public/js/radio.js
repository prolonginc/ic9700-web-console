// The link to the radio, by way of the console server. The messages are the
// ones wfweb's own page uses, so the server can either pass them through to
// wfweb or answer them itself:
//
//   text frames    JSON, either commands we send ({cmd, value, ...}) or
//                  messages from the server ({type, ...})
//   binary 0x01    spectrum sweep: [1][scopeMode][outOfRange][pad]
//                  [start MHz f32][end MHz f32][one byte per pixel]
//   binary 0x02    receive audio: 6-byte header, then 16-bit mono PCM
//   binary 0x03    transmit audio, sent by us: [3][0][seq u16][0 u16][PCM]
//
// Events: 'link' (socket up/down), 'info' (what the radio can do),
//         'state' (settings and meters changed; detail = the changed fields),
//         'spectrum', 'audio', 'notice' (a message worth showing the user).

const RETRY_MIN_MS = 1000;
const RETRY_MAX_MS = 5000;

export class Radio extends EventTarget {
  constructor(url) {
    super();
    this.url = url;
    this.ws = null;
    this.info = null; // rig capabilities, null until the radio is identified
    this.state = {}; // latest known settings and meter readings
    this.linkUp = false;
    this.retryMs = RETRY_MIN_MS;
    this.micSeq = 0;
  }

  get rigConnected() {
    return !!(this.linkUp && this.info && this.info.connected);
  }

  connect() {
    const ws = new WebSocket(this.url);
    ws.binaryType = 'arraybuffer';
    this.ws = ws;

    ws.onopen = () => {
      this.linkUp = true;
      this.retryMs = RETRY_MIN_MS;
      this.emit('link');
    };
    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.linkUp = false;
      this.info = null;
      this.emit('link');
      setTimeout(() => this.connect(), this.retryMs);
      this.retryMs = Math.min(this.retryMs * 1.6, RETRY_MAX_MS);
    };
    ws.onmessage = (event) => {
      if (event.data instanceof ArrayBuffer) this.onBinary(event.data);
      else this.onText(event.data);
    };
  }

  emit(type, detail) {
    this.dispatchEvent(new CustomEvent(type, { detail }));
  }

  send(cmd, fields) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return false;
    this.ws.send(JSON.stringify({ cmd, ...fields }));
    return true;
  }

  // One block of microphone audio (an ArrayBuffer of 16-bit samples).
  sendMicAudio(pcm) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    const frame = new ArrayBuffer(6 + pcm.byteLength);
    const view = new DataView(frame);
    view.setUint8(0, 0x03);
    view.setUint8(1, 0x00);
    view.setUint16(2, this.micSeq++ & 0xffff, true);
    view.setUint16(4, 0, true);
    new Uint8Array(frame, 6).set(new Uint8Array(pcm));
    this.ws.send(frame);
  }

  onBinary(buffer) {
    if (buffer.byteLength < 2) return;
    const view = new DataView(buffer);
    const type = view.getUint8(0);
    if (type === 0x02) {
      if (buffer.byteLength >= 8) this.emit('audio', buffer);
      return;
    }
    if (type !== 0x01 || buffer.byteLength < 13) return;
    this.emit('spectrum', {
      scopeMode: view.getUint8(1),
      start: view.getFloat32(4, true) * 1e6,
      end: view.getFloat32(8, true) * 1e6,
      pixels: new Uint8Array(buffer, 12),
    });
  }

  onText(text) {
    let msg;
    try {
      msg = JSON.parse(text);
    } catch {
      return;
    }
    switch (msg.type) {
      case 'rigInfo':
        this.info = msg;
        this.emit('info');
        break;
      case 'rigConnected':
        // The radio was identified after we connected. Its details arrive
        // here; ask for the settings too, which were sent before it was known.
        this.info = { ...(this.info || {}), ...msg, connected: true };
        this.emit('info');
        setTimeout(() => this.send('getStatus'), 1500);
        break;
      case 'status':
      case 'update':
      case 'meters':
      case 'lanStatus':
        this.merge(msg);
        break;
      case 'audioAvailable':
        if (this.info) {
          this.info.audioAvailable = !!msg.available;
          if (msg.txAudioAvailable !== undefined) this.info.txAudioAvailable = !!msg.txAudioAvailable;
          this.emit('info');
        }
        break;
      case 'audioStatus':
        this.merge({ audioEnabled: !!msg.enabled });
        break;
      case 'audioError':
        this.emit('notice', { text: `Audio problem: ${msg.reason}` });
        break;
      case 'micWarning':
        if (msg.message) this.emit('notice', { text: msg.message });
        break;
      case 'error':
        if (msg.message) this.emit('notice', { text: msg.message });
        break;
      default:
        break; // logbook, APRS and the rest are not used by this page
    }
  }

  merge(msg) {
    const changed = {};
    for (const [key, value] of Object.entries(msg)) {
      if (key === 'type') continue;
      if (this.state[key] !== value) {
        this.state[key] = value;
        changed[key] = value;
      }
    }
    if (Object.keys(changed).length) this.emit('state', changed);
  }
}
