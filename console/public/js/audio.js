// Sound in both directions: playing the radio's receive audio, and capturing
// the microphone for transmit.

const WORKLET_URL = 'js/worklets.js';
const AUDIO_HEADER_BYTES = 6;

export class Speaker {
  constructor() {
    this.ctx = null;
    this.node = null;
    this.gain = null;
    this.volume = 0.8;
    this.muted = false;
    this.framesReceived = 0;
    // How loud each receiver is when both arrive (see play).
    this.mainLevel = 1;
    this.subLevel = 0;
  }

  get running() {
    return !!this.ctx;
  }

  // Must be called from a click: browsers block sound until the user acts.
  async start(sampleRate) {
    if (this.ctx) return;
    const ctx = new AudioContext({ sampleRate, latencyHint: 'interactive' });
    await ctx.audioWorklet.addModule(WORKLET_URL);
    this.node = new AudioWorkletNode(ctx, 'rx-player', {
      numberOfInputs: 0,
      numberOfOutputs: 1,
      outputChannelCount: [1],
    });
    this.gain = ctx.createGain();
    this.node.connect(this.gain).connect(ctx.destination);
    this.ctx = ctx;
    this.applyGain();
    if (ctx.state !== 'running') await ctx.resume();
  }

  stop() {
    if (!this.ctx) return;
    this.ctx.close();
    this.ctx = null;
    this.node = null;
    this.gain = null;
  }

  // A 0x02 frame from the radio link. With two channels in it (main receiver
  // on the left, second receiver on the right) they are blended here, each at
  // its own level, into the one stream that is played.
  play(buffer, mayBeStereo = true) {
    if (!this.node) return;
    this.framesReceived++;
    const stereo = mayBeStereo && new Uint8Array(buffer, 1, 1)[0] === 2;
    const pcm = new Int16Array(buffer, AUDIO_HEADER_BYTES, Math.floor((buffer.byteLength - AUDIO_HEADER_BYTES) / 2));
    let samples;
    if (stereo) {
      const n = pcm.length >> 1;
      const a = this.mainLevel / 32768;
      const b = this.subLevel / 32768;
      samples = new Float32Array(n);
      for (let i = 0; i < n; i++) samples[i] = pcm[2 * i] * a + pcm[2 * i + 1] * b;
    } else {
      samples = new Float32Array(pcm.length);
      for (let i = 0; i < pcm.length; i++) samples[i] = pcm[i] / 32768;
    }
    this.node.port.postMessage(samples, [samples.buffer]);
  }

  // Levels from 0 to 1 for the main and the second receiver.
  setLevels(main, sub) {
    this.mainLevel = main;
    this.subLevel = sub;
  }

  setVolume(v) {
    this.volume = v;
    this.applyGain();
  }

  // Silenced while transmitting so you don't hear your own delayed voice.
  setMuted(muted) {
    if (this.muted === muted) return;
    this.muted = muted;
    this.applyGain();
    if (muted && this.node) this.node.port.postMessage('flush');
  }

  applyGain() {
    if (!this.gain) return;
    // Squared so the slider feels even to the ear.
    const target = this.muted ? 0 : this.volume * this.volume;
    this.gain.gain.setTargetAtTime(target, this.ctx.currentTime, 0.02);
  }
}

export class Microphone {
  constructor() {
    this.stream = null;
    this.ctx = null;
    this.label = '';
    this.level = 0; // 0..1 peak of the latest block, for the level bar
    this.onBlock = null; // called with each block of 16-bit samples
  }

  get ready() {
    return !!this.stream;
  }

  async start() {
    if (this.stream) return;
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    try {
      const ctx = new AudioContext({ sampleRate: 48000 });
      await ctx.audioWorklet.addModule(WORKLET_URL);
      const source = ctx.createMediaStreamSource(stream);
      const capture = new AudioWorkletNode(ctx, 'mic-capture', { numberOfInputs: 1, numberOfOutputs: 0 });
      capture.port.onmessage = (e) => {
        const pcm = new Int16Array(e.data);
        let peak = 0;
        for (let i = 0; i < pcm.length; i++) {
          const a = Math.abs(pcm[i]);
          if (a > peak) peak = a;
        }
        this.level = peak / 32768;
        if (this.onBlock) this.onBlock(e.data);
      };
      source.connect(capture);
      if (ctx.state !== 'running') await ctx.resume();
      this.ctx = ctx;
      this.stream = stream;
      const track = stream.getAudioTracks()[0];
      this.label = track ? track.label : '';
    } catch (err) {
      stream.getTracks().forEach((t) => t.stop());
      throw err;
    }
  }

  stop() {
    if (!this.stream) return;
    this.stream.getTracks().forEach((t) => t.stop());
    this.ctx.close();
    this.stream = null;
    this.ctx = null;
    this.level = 0;
  }
}
