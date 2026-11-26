// Audio worklets (run on the audio thread).

// Plays the radio's receive audio. Network packets arrive unevenly, so samples
// go through a small buffer: playback waits until TARGET is queued, and if the
// buffer runs dry it waits again rather than stuttering sample by sample.
class RxPlayer extends AudioWorkletProcessor {
  constructor() {
    super();
    this.size = sampleRate * 2; // 2 s ring
    this.ring = new Float32Array(this.size);
    this.read = 0;
    this.write = 0;
    this.fill = 0;
    this.target = Math.round(sampleRate * 0.12); // start playing at 120 ms
    this.max = Math.round(sampleRate * 0.5); // never lag more than 500 ms
    this.playing = false;
    this.port.onmessage = (e) => {
      if (e.data === 'flush') {
        this.read = this.write;
        this.fill = 0;
        this.playing = false;
        return;
      }
      this.push(e.data);
    };
  }

  push(samples) {
    for (let i = 0; i < samples.length; i++) {
      this.ring[this.write] = samples[i];
      this.write = (this.write + 1) % this.size;
    }
    this.fill += samples.length;
    if (this.fill > this.max) {
      // Fell behind (a burst arrived late): skip ahead to the target delay.
      const drop = this.fill - this.target;
      this.read = (this.read + drop) % this.size;
      this.fill -= drop;
    }
  }

  process(inputs, outputs) {
    const out = outputs[0][0];
    if (!out) return true;
    if (!this.playing && this.fill >= this.target) this.playing = true;
    if (!this.playing) return true; // output stays silent
    const n = Math.min(out.length, this.fill);
    for (let i = 0; i < n; i++) {
      out[i] = this.ring[this.read];
      this.read = (this.read + 1) % this.size;
    }
    this.fill -= n;
    if (this.fill === 0) this.playing = false;
    return true;
  }
}
registerProcessor('rx-player', RxPlayer);

// Captures the microphone as 16-bit samples, one message per audio block.
class MicCapture extends AudioWorkletProcessor {
  process(inputs) {
    const input = inputs[0] && inputs[0][0];
    if (!input || input.length === 0) return true;
    const pcm = new Int16Array(input.length);
    for (let i = 0; i < input.length; i++) {
      const s = Math.max(-1, Math.min(1, input[i]));
      pcm[i] = s < 0 ? s * 32768 : s * 32767;
    }
    this.port.postMessage(pcm.buffer, [pcm.buffer]);
    return true;
  }
}
registerProcessor('mic-capture', MicCapture);
