// Reads Morse code out of the radio's sound.
//
// Morse is one tone switched on and off: a short "dot", a "dash" three times
// as long, a dot's length of silence between them, three between letters and
// seven between words. To read it, this:
//
//   1. watches a row of narrow listening slots from 300 to 1500 Hz. Most of
//      them hold only noise at any moment, so the middle one of them gives
//      the noise level, and it is followed quickly when it rises (a squelch
//      opening) and slowly when it falls; and it learns how each slot usually
//      compares with that (a receiver's hiss is not the same at every pitch);
//   2. follows the slot where something stands out of its noise, so it does
//      not matter what pitch the signal comes out at, or whether it is a CW
//      signal or the tone of a repeater's identification;
//   3. decides, two hundred times a second, whether the tone is on;
//   4. times the ons and offs, and works out the sender's speed from them,
//      since short and long marks fall into two clear groups;
//   5. turns dots and dashes into letters.
//
// Speech and bursts of noise also put energy in those slots, and would come
// out as a stream of E's and T's. Three things tell keying apart: it is the
// loudest thing in the spectrum while it is on; it is steady for as long as
// it is on, where a voice wavers; and its marks come in two tidy lengths.
// When what is heard stops looking like that, nothing is printed.
//
// Nothing here touches the page: feed it samples, read `text`.

const ANALYSIS_RATE = 12000; // plenty for tones up to 1500 Hz
const WINDOW_S = 0.02; // each look at the sound covers 20 ms
const HOP_S = 0.005; // and there is one every 5 ms
const FIRST_HZ = 300;
const LAST_HZ = 1500;
const STEP_HZ = 50;

const PEAK_FALL = Math.exp(-HOP_S / 2); // loudest-recently readings fade over two seconds
const QUIETEST_TONE = 0.002; // below this it is digital silence, not a signal

// Each slot is measured against the middle slot of the moment. How a slot
// usually stands to that (its "tilt") is taken as the ratio it is under 30%
// of the time, found by nudging an estimate up a little when the slot is
// above it and down a little more when it is below. A slot that is noise
// alone is at 1.39 times that half the time, which is the yardstick.
const FLOOR_UP = 1 + 0.006 * 0.3;
const FLOOR_DOWN = 1 - 0.006 * 0.7;
const FLOOR_TO_TYPICAL = 1.39;
const NOISE_QUICK = 0.35; // the noise level is followed within a few looks when it jumps up
const NOISE_SLOW = 0.02; // and held for a quarter of a second or so when it drops
const SILENCE = 1e-6; // a noise level this low means no sound at all (a closed squelch)
const STUCK_ON_HOPS = 600; // on for three seconds: a carrier, not keying
const EDGE_HOPS = 3; // a mark's first and last moments are its rise and fall

// How sure to be. `tune` lets the tests try other values.
const DEFAULTS = {
  appear: 4.5, // a tone must stand this far above the noise to be taken up
  vanish: 3.2, // and is dropped when it no longer stands this far above
  floor: 3, // "on" means at least this far above the noise...
  half: 0.5, // ...and at least this fraction of the tone's recent loudest
  highFall: 1, // seconds for "recent loudest" to fade
  smooth: 3, // looks averaged together before deciding
  misfit: 0.3, // how badly marks may fit dots and dashes before it stops reading
  waver: 0.36, // how much a mark's loudness may vary and still be "steady"
  marksToLock: 7, // marks needed before trusting a speed
  crowd: 1, // other slots that may be busy at the same moment
  gapsToLock: 2, // dot-length gaps needed before trusting a speed
};
const DEBOUNCE_HOPS = 2; // a change has to last 10 ms to count
const SETTLE_HOPS = 10; // the first looks only fill the buffer
const HEARD_FOR_MS = 1500;

const SHORTEST_UNIT_MS = 20; // 60 words a minute
const LONGEST_UNIT_MS = 300; // 4 words a minute
const RECENT_MARKS = 24;
const SHORTEST_MARK_MS = 22; // a dot at 55 words a minute; anything shorter is a click
const FORGET_AFTER_MS = 10000; // marks this old say nothing about what comes next

export const MORSE = {
  '.-': 'A', '-...': 'B', '-.-.': 'C', '-..': 'D', '.': 'E', '..-.': 'F', '--.': 'G', '....': 'H', '..': 'I',
  '.---': 'J', '-.-': 'K', '.-..': 'L', '--': 'M', '-.': 'N', '---': 'O', '.--.': 'P', '--.-': 'Q', '.-.': 'R',
  '...': 'S', '-': 'T', '..-': 'U', '...-': 'V', '.--': 'W', '-..-': 'X', '-.--': 'Y', '--..': 'Z',
  '-----': '0', '.----': '1', '..---': '2', '...--': '3', '....-': '4', '.....': '5', '-....': '6', '--...': '7',
  '---..': '8', '----.': '9',
  '.-.-.-': '.', '--..--': ',', '..--..': '?', '-..-.': '/', '-...-': '=', '-....-': '-', '.----.': "'",
  '---...': ':', '-.-.-.': ';', '-.--.-': ')', '.-..-.': '"', '.--.-.': '@', '-.-.--': '!',
  // Procedure signals: several letters run together to mean one thing.
  '.-.-.': '<AR>', // end of message
  '...-.-': '<SK>', // end of contact
  '-.--.': '<KN>', // go ahead, named station only
  '.-...': '<AS>', // wait
  '........': '<ERR>', // "ignore my last word"
  '...---...': '<SOS>',
};

const UNKNOWN = '*';

// The length of one dot, from recent mark lengths (ms), or null if they do
// not yet show two groups a Morse-like distance apart.
export function estimateUnit(marks) {
  if (marks.length < 4) return null;
  const d = marks.slice().sort((a, b) => a - b);
  // The widest relative gap between neighbours separates dots from dashes.
  let widest = 0;
  let at = -1;
  for (let i = 1; i < d.length; i++) {
    const ratio = d[i] / d[i - 1];
    if (ratio > widest) {
      widest = ratio;
      at = i;
    }
  }
  if (widest < 1.6) return null; // all dots, or all dashes, so far
  const mean = (list) => list.reduce((sum, x) => sum + x, 0) / list.length;
  const dot = mean(d.slice(0, at));
  const dash = mean(d.slice(at));
  if (dash / dot < 1.8 || dash / dot > 5) return null; // not Morse
  // Each group has to hang together, too: marks of every length are noise.
  if (d[at - 1] / d[0] > 1.9 || d[d.length - 1] / d[at] > 1.9) return null;
  const unit = (dot * at + (dash / 3) * (d.length - at)) / d.length;
  return unit >= SHORTEST_UNIT_MS && unit <= LONGEST_UNIT_MS ? unit : null;
}

export class MorseDecoder {
  constructor(sampleRate = 48000, tune = {}) {
    this.tune = { ...DEFAULTS, ...tune };
    this.setRate(sampleRate);
    this.reset();
  }

  setRate(sampleRate) {
    this.sampleRate = sampleRate;
    this.decimate = Math.max(1, Math.round(sampleRate / ANALYSIS_RATE));
    const rate = sampleRate / this.decimate;
    this.window = Math.round(rate * WINDOW_S);
    this.hop = Math.round(rate * HOP_S);
    this.hopMs = (this.hop / rate) * 1000;
    this.freqs = [];
    for (let f = FIRST_HZ; f <= LAST_HZ; f += STEP_HZ) this.freqs.push(f);
    this.coeffs = this.freqs.map((f) => 2 * Math.cos((2 * Math.PI * f) / rate));
    // A smooth-edged window keeps one tone from spilling into far-off slots.
    this.shape = new Float32Array(this.window);
    for (let i = 0; i < this.window; i++) this.shape[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (this.window - 1));
    this.ring = new Float32Array(this.window);
    this.frame = new Float32Array(this.window);
    this.amps = new Float32Array(this.freqs.length);
    this.norm = new Float32Array(this.freqs.length);
    this.sorted = new Float32Array(this.freqs.length);
    this.highFall = Math.exp(-this.hopMs / 1000 / this.tune.highFall);
  }

  // Forgets everything heard so far.
  reset() {
    this.ring.fill(0);
    this.ringAt = 0;
    this.sinceHop = 0;
    this.sum = 0;
    this.summed = 0;
    this.floors = new Float32Array(this.freqs.length).fill(1 / FLOOR_TO_TYPICAL); // each slot's tilt
    this.peaks = new Float32Array(this.freqs.length); // how far each has stood out lately
    this.bin = -1;
    this.high = 0; // how far the tone has stood out of the noise lately
    this.loudest = 0; // and how loud it has been
    this.loudestEver = 0; // the same, remembered a little longer
    this.looks = 0;
    this.quick = 0; // the noise level, followed fast
    this.slow = 0; // and slowly
    this.present = false; // a tone is standing out of the noise
    this.recent = []; // the last few levels, for smoothing
    this.levels = []; // the level through the mark in progress
    this.crowds = []; // and whether other slots were busy too
    this.fit = 0; // how badly recent marks fit dots and dashes
    this.raw = false; // tone on, before debouncing
    this.rawHops = 0;
    this.down = false; // tone on, as accepted
    this.stateHops = 0;
    this.heardHops = Infinity;
    this.marks = []; // mark lengths in this transmission, ms
    this.unit = null; // one dot, ms
    // Each transmission may come from a different sender at a different
    // speed. Until this one's speed shows, what is heard is kept in `waiting`
    // rather than read at the last sender's speed.
    this.fresh = true;
    this.waiting = [];
    this.symbol = ''; // dots and dashes of the letter in progress
    this.spaced = true; // a word space has been written (or nothing has)
    this.text = '';
  }

  // How fast the sender is going, in words a minute, or 0 if not known yet.
  get wpm() {
    return this.unit ? Math.round(1200 / this.unit) : 0;
  }

  // The pitch of the tone being followed, in hertz, or 0.
  get pitch() {
    return this.bin >= 0 ? this.freqs[this.bin] : 0;
  }

  // True while a tone has been standing out of the noise recently.
  get hearing() {
    return this.heardHops * this.hopMs < HEARD_FOR_MS;
  }

  // True at this instant if the tone is on (for a blinking light).
  get keyDown() {
    return this.down;
  }

  // samples: one channel of sound, as numbers from -1 to 1.
  push(samples) {
    const { decimate, ring, window } = this;
    for (let i = 0; i < samples.length; i++) {
      this.sum += samples[i];
      if (++this.summed < decimate) continue;
      ring[this.ringAt] = this.sum / decimate;
      this.ringAt = (this.ringAt + 1) % window;
      this.sum = 0;
      this.summed = 0;
      if (++this.sinceHop >= this.hop) {
        this.sinceHop = 0;
        this.look();
      }
    }
  }

  // One look at the last 20 ms: how strong is each listening slot?
  look() {
    const { ring, frame, shape, window, coeffs, amps, norm, floors, peaks } = this;
    for (let i = 0; i < window; i++) frame[i] = ring[(this.ringAt + i) % window] * shape[i];

    for (let k = 0; k < coeffs.length; k++) {
      // The Goertzel filter: the strength of one frequency, cheaply.
      const c = coeffs[k];
      let s1 = 0;
      let s2 = 0;
      for (let i = 0; i < window; i++) {
        const s0 = frame[i] + c * s1 - s2;
        s2 = s1;
        s1 = s0;
      }
      const power = s1 * s1 + s2 * s2 - c * s1 * s2;
      amps[k] = (Math.sqrt(Math.max(0, power)) * 4) / window; // as the tone's own amplitude
    }

    // The noise level: most slots hold nothing else, so the middle one shows it.
    this.sorted.set(amps);
    this.sorted.sort();
    const middle = this.sorted[this.sorted.length >> 1];
    this.quick += (middle - this.quick) * NOISE_QUICK;
    this.slow += (middle - this.slow) * NOISE_SLOW;
    // A pure tone on a dead-quiet background leaves every other slot empty.
    // Nothing is allowed to stand more than a thousand times above "noise".
    const loudest = this.sorted[this.sorted.length - 1];
    const noise = Math.max(this.quick, this.slow, loudest * 1e-3);
    const silent = noise < SILENCE;
    if (++this.looks <= SETTLE_HOPS) return;

    // Each slot against the noise of the moment, allowing for its tilt; and
    // which one stands out most.
    const b0 = this.bin;
    const holding = this.down && this.stateHops < STUCK_ON_HOPS;
    // Tilt is each slot against the middle slot of the same instant, so that
    // it is not thrown by how loud things were a moment ago. It is learned
    // mostly from moments of plain noise. With several slots far above their
    // usual level at once (a voice, say) it is only allowed to creep up:
    // slowly enough that a voice does not teach it much, but not never, or a
    // change in the colour of the noise itself (another mode, another
    // filter) would never be learned at all.
    const learning = middle > SILENCE;
    let far = 0;
    if (learning) for (let k = 0; k < amps.length; k++) if (amps[k] / middle > 6 * floors[k] * FLOOR_TO_TYPICAL) far++;
    const up = far < 3 ? FLOOR_UP : 1 + (FLOOR_UP - 1) / 4;
    let leader = 0;
    let best = 0;
    for (let k = 0; k < amps.length; k++) {
      const ratio = silent ? 0 : amps[k] / noise;
      // While the tone is on, its own slots are not noise and are left alone.
      if (learning && !(holding && Math.abs(k - b0) <= 2)) {
        floors[k] = Math.min(8, Math.max(0.05, floors[k] * (amps[k] / middle > floors[k] ? up : FLOOR_DOWN)));
      }
      norm[k] = ratio / (floors[k] * FLOOR_TO_TYPICAL);
      if (norm[k] > norm[leader]) leader = k;
      // Which slot has been loudest lately, allowing for tilt. Plain loudness
      // here, since the noise reading jumps about at the instant of keying.
      peaks[k] = Math.max(amps[k] / (floors[k] * FLOOR_TO_TYPICAL), peaks[k] * PEAK_FALL);
      if (peaks[k] > peaks[best]) best = k;
    }

    // Follow the slot with the tone, without hopping about on small
    // differences or in the middle of a mark.
    // The old tone has been silent for a while and another slot is standing
    // out right now: go to it, without waiting for the old one to fade. Within
    // two seconds only for something about as loud, since the gap between
    // two words is nearly half a second of silence too.
    const quietFor = this.heardHops * this.hopMs;
    if (
      this.bin >= 0 &&
      quietFor > 400 &&
      Math.abs(leader - this.bin) > 1 &&
      norm[leader] > this.tune.appear &&
      amps[leader] > QUIETEST_TONE &&
      (quietFor > 2000 || amps[leader] > 0.3 * this.loudestEver)
    ) {
      peaks[this.bin] = 0;
      best = leader;
    }
    if (this.bin < 0 || (!this.down && peaks[best] > 1.6 * peaks[this.bin])) {
      // A different pitch is a different signal: what was being pieced
      // together from the old one does not carry over.
      if (this.bin >= 0 && Math.abs(best - this.bin) > 1) this.startOver();
      this.bin = best;
    }
    const b = this.bin;
    const t = this.tune;
    const around = (list) => Math.max(list[b], b > 0 ? list[b - 1] : 0, b < list.length - 1 ? list[b + 1] : 0);
    const stands = around(norm); // how far the tone stands out of the noise

    // Keying is the loudest thing there is while it is on, and the only
    // thing: a voice or a burst of noise fills many slots at once. (How
    // crowded the spectrum was is judged over each whole mark, not here,
    // because the instant a key closes is briefly crowded too.)
    let crowd = 0;
    const busy = Math.max(3, 0.25 * stands);
    for (let k = 0; k < norm.length; k++) if (Math.abs(k - b) > 2 && norm[k] > busy) crowd++;
    const leading = Math.abs(leader - b) <= 1 && amps[leader] > QUIETEST_TONE;

    // Whether there is a tone at all is a matter of standing out of the noise.
    this.high = leading ? Math.max(stands, this.high * this.highFall) : this.high * this.highFall;
    if (this.present ? this.high < t.vanish : this.high > t.appear) this.present = !this.present;

    // When exactly it is on is read from its plain loudness, against its own
    // recent loudest and against the noise in its slot. (The noise reading
    // jumps about at the instant of keying, and must not move the edges.)
    // A short average steadies it against the noise riding on it.
    this.recent.push(around(amps));
    if (this.recent.length > t.smooth) this.recent.shift();
    let level = 0;
    for (const v of this.recent) level += v;
    level /= this.recent.length;
    this.loudest = leading ? Math.max(level, this.loudest * this.highFall) : this.loudest * this.highFall;
    this.loudestEver = Math.max(this.down ? level : 0, this.loudestEver * PEAK_FALL);
    const threshold = Math.max(t.half * this.loudest, t.floor * this.slow * floors[b] * FLOOR_TO_TYPICAL);
    const on = this.present && leading && level > (this.down ? 0.8 * threshold : threshold);
    this.heardHops = on ? 0 : this.heardHops + 1;
    if (this.down) {
      this.levels.push(level);
      this.crowds.push(crowd > t.crowd);
    }
    this.tick(on);
  }

  // Times the ons and offs.
  tick(on) {
    if (on !== this.raw) {
      this.raw = on;
      this.rawHops = 0;
    }
    this.rawHops++;
    this.stateHops++;
    if (this.raw !== this.down && this.rawHops >= DEBOUNCE_HOPS) {
      // The change really happened when it was first seen.
      const ended = (this.stateHops - this.rawHops) * this.hopMs;
      if (this.down) this.mark(ended, this.steadiness());
      else if (this.fresh) this.waiting.push({ on: false, ms: ended });
      this.down = this.raw;
      this.stateHops = this.rawHops;
      this.levels = [];
      this.crowds = [];
    }
    if (!this.down) this.silence(this.stateHops * this.hopMs);
  }

  // Was the mark just ended a steady tone on its own? Leaving out its rise
  // and fall: true if its level held and the rest of the spectrum stayed
  // quiet, false if not, null if it was too short to say.
  steadiness() {
    const from = EDGE_HOPS;
    const to = this.levels.length - EDGE_HOPS - this.rawHops;
    if (to - from < 4) return null;
    let sum = 0;
    let crowded = 0;
    for (let i = from; i < to; i++) {
      sum += this.levels[i];
      if (this.crowds[i]) crowded++;
    }
    const mean = sum / (to - from);
    let squares = 0;
    for (let i = from; i < to; i++) squares += (this.levels[i] - mean) * (this.levels[i] - mean);
    const waver = Math.sqrt(squares / (to - from)) / mean;
    return waver < this.tune.waver && crowded <= (to - from) * 0.3;
  }

  // steady: from steadiness().
  mark(ms, steady = null) {
    // A click far shorter than a dot is not keying.
    if (ms < (this.fresh ? SHORTEST_MARK_MS : 0.35 * this.unit)) return;
    this.marks.push(ms);
    if (this.marks.length > RECENT_MARKS) this.marks.shift();
    const unit = this.marks.length >= this.tune.marksToLock ? estimateUnit(this.marks) : null;

    if (!this.fresh) {
      if (unit) this.unit = 0.7 * this.unit + 0.3 * unit; // senders drift
      this.element(ms, steady);
      return;
    }
    this.waiting.push({ on: true, ms, steady });
    if (unit && this.believable(unit)) this.lock(unit);
    // Eight marks all alike (a row of dots, say): go by the last sender's speed.
    else if (this.unit && this.marks.length >= 8 && !unit && this.fits(this.unit)) this.lock(this.unit);
    else if (this.waiting.length > 60) this.startOver();
  }

  // Before trusting a speed: were the marks steady tones, and are the short
  // gaps between them about one dot long, as they are inside a letter?
  believable(unit) {
    const marks = this.waiting.filter((e) => e.on);
    const judged = marks.filter((e) => e.steady !== null);
    if (judged.length >= 2 && judged.filter((e) => !e.steady).length > judged.length * 0.25) return false;
    // Both lengths at least twice: one long mark among short ones is not yet a pattern.
    const dots = marks.filter((e) => e.ms < 2 * unit).length;
    if (dots < 2 || marks.length - dots < 2) return false;
    // Letters are made of marks a dot's length apart. Noise comes as lone
    // marks with any gap at all between them.
    const short = this.waiting.filter((e) => !e.on && e.ms < 2 * unit).map((e) => e.ms);
    if (short.length < this.tune.gapsToLock) return false;
    const mean = short.reduce((sum, x) => sum + x, 0) / short.length;
    if (mean < 0.5 * unit || mean > 1.6 * unit) return false;
    return Math.max(...short) / Math.min(...short) <= 2.4;
  }

  // True if every mark kept so far sits close to a dot or a dash of this length.
  fits(unit) {
    const marks = this.waiting.filter((e) => e.on);
    return marks.length > 0 && marks.every((e) => e.steady !== false && Math.abs(Math.log(e.ms / (e.ms < 2 * unit ? unit : 3 * unit))) < 0.3);
  }

  // What is being heard is not Morse (or not yet): drop it and wait for better.
  startOver() {
    this.fresh = true;
    this.symbol = '';
    this.marks = [];
    this.waiting = [];
  }

  // The speed of this transmission is known: read what was kept meanwhile.
  lock(unit) {
    this.unit = unit;
    this.fresh = false;
    this.fit = 0.12;
    const heard = this.waiting;
    this.waiting = [];
    for (const e of heard) {
      if (!e.on) this.gap(e.ms);
      else if (e.ms >= 0.35 * unit) this.element(e.ms, e.steady);
      if (this.fresh) return; // it stopped looking like Morse part-way through
    }
  }

  element(ms, steady = null) {
    const dot = ms < 2 * this.unit;
    // Real keying lands close to one or three units and holds steady. Noise
    // and speech chopped into "marks" do neither, and then it is better to
    // stop than to print rubbish.
    const off = steady === false ? 0.8 : Math.abs(Math.log(ms / (dot ? this.unit : 3 * this.unit)));
    this.fit += (off - this.fit) * 0.2;
    if (this.fit > this.tune.misfit) {
      this.startOver();
      return;
    }
    this.symbol += dot ? '.' : '-';
    if (this.symbol.length > 9) this.letter();
  }

  // A finished silence of known length (only used when catching up).
  gap(ms) {
    if (ms >= 2 * this.unit) this.letter();
    if (ms >= 5 * this.unit) this.word();
  }

  // A silence still going on, `ms` long so far.
  silence(ms) {
    if (this.fresh) {
      // Something short was sent and then nothing ("R", "73", "TU"). It is
      // all there will be, so read it now: at its own speed if it shows one,
      // else at the last speed known if it fits that. A lone blip is not a letter.
      if (this.waiting.length && ms >= Math.max(1500, 8 * (this.unit || 0))) {
        const own = this.marks.length >= 4 ? estimateUnit(this.marks) : null;
        if (own && this.believable(own)) this.lock(own);
        else if (this.unit && this.waiting.filter((e) => e.on).length >= 2 && this.fits(this.unit)) this.lock(this.unit);
        else this.startOver();
      } else if (ms >= FORGET_AFTER_MS) {
        this.marks = [];
        this.waiting = [];
      }
      if (this.fresh) return;
    }
    if (ms >= 2 * this.unit) this.letter();
    if (ms >= 5 * this.unit) this.word();
    // A pause this long ends a transmission. The next starts on its own line.
    if (ms >= Math.max(2000, 12 * this.unit)) {
      this.startOver();
      if (this.text && !this.text.endsWith('\n')) this.text = `${this.text.trimEnd()}\n`;
    }
  }

  letter() {
    if (!this.symbol) return;
    this.text += MORSE[this.symbol] || UNKNOWN;
    this.symbol = '';
    this.spaced = false;
  }

  word() {
    if (this.spaced) return;
    this.text += ' ';
    this.spaced = true;
  }
}

// ---------------------------------------------------------------- Sending
//
// The other direction, used by the tests and for trying the decoder out:
// text as the sound of Morse.

const CODE_FOR = Object.fromEntries(Object.entries(MORSE).map(([code, char]) => [char, code]));

// Returns samples (-1 to 1) of `text` sent at `wpm` words a minute.
// jitter: how unevenly it is keyed, 0 for machine-perfect, 0.2 for a tired hand.
// noise: how loud the background hiss is, next to a tone of `level`.
// lead: seconds of quiet before it starts.
export function morseAudio(text, { wpm = 20, pitch = 600, sampleRate = 48000, level = 0.3, noise = 0, jitter = 0, lead = 0.7, random = Math.random } = {}) {
  const unit = 1.2 / wpm; // seconds
  const wobble = () => 1 + (random() * 2 - 1) * jitter;
  const parts = []; // [on, seconds]
  parts.push([false, lead]);
  for (const word of text.toUpperCase().trim().split(/\s+/)) {
    // A procedure signal such as <AR> is sent as one letter.
    const letters = word.match(/<[A-Z]+>|./g) || [];
    letters.forEach((letter, i) => {
      const code = CODE_FOR[letter];
      if (!code) return;
      [...code].forEach((mark, j) => {
        parts.push([true, unit * (mark === '.' ? 1 : 3) * wobble()]);
        if (j < code.length - 1) parts.push([false, unit * wobble()]);
      });
      if (i < letters.length - 1) parts.push([false, unit * 3 * wobble()]);
    });
    parts.push([false, unit * 7 * wobble()]);
  }
  parts.push([false, unit * 10]);

  const total = Math.ceil(parts.reduce((sum, [, s]) => sum + s, 0) * sampleRate);
  const out = new Float32Array(total);
  const edge = Math.round(sampleRate * 0.004); // soft starts and stops, as real transmitters make
  let at = 0;
  let phase = 0;
  const step = (2 * Math.PI * pitch) / sampleRate;
  for (const [on, seconds] of parts) {
    const n = Math.round(seconds * sampleRate);
    for (let i = 0; i < n && at < total; i++, at++) {
      let gain = 0;
      if (on) {
        gain = 1;
        if (i < edge) gain = 0.5 - 0.5 * Math.cos((Math.PI * i) / edge);
        else if (n - i < edge) gain = 0.5 - 0.5 * Math.cos((Math.PI * (n - i)) / edge);
      }
      out[at] = level * gain * Math.sin(phase);
      phase += step;
    }
  }
  if (noise > 0) {
    for (let i = 0; i < total; i++) {
      // Two uniform numbers make one bell-curve number (Box-Muller).
      const g = Math.sqrt(-2 * Math.log(1 - random())) * Math.cos(2 * Math.PI * random());
      out[i] += g * noise * level;
    }
  }
  return out;
}
