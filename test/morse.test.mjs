// The Morse decoder against Morse it is sent: clean and noisy, slow and fast,
// machine-keyed and hand-keyed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { MorseDecoder, morseAudio, estimateUnit } from '../console/public/js/morse.js';

// A repeatable source of "random" numbers, so a failure can be reproduced.
function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function decode(samples, sampleRate = 48000, chunk = 480) {
  const decoder = new MorseDecoder(sampleRate);
  for (let i = 0; i < samples.length; i += chunk) decoder.push(samples.subarray(i, i + chunk));
  return decoder;
}

const MESSAGE = 'CQ CQ DE N0CALL N0CALL K';

test('clean Morse at 20 words a minute', () => {
  const d = decode(morseAudio(MESSAGE, { wpm: 20 }));
  assert.equal(d.text.trim(), MESSAGE);
  assert.ok(Math.abs(d.wpm - 20) <= 1, `speed read as ${d.wpm}`);
  assert.equal(d.pitch, 600);
});

for (const wpm of [6, 12, 28, 38]) {
  test(`at ${wpm} words a minute`, () => {
    const d = decode(morseAudio(MESSAGE, { wpm }));
    assert.equal(d.text.trim(), MESSAGE);
    assert.ok(Math.abs(d.wpm - wpm) <= Math.max(1, wpm * 0.08), `speed read as ${d.wpm}`);
  });
}

for (const pitch of [350, 480, 725, 1000, 1450]) {
  test(`a tone at ${pitch} Hz`, () => {
    const d = decode(morseAudio(MESSAGE, { pitch }));
    assert.equal(d.text.trim(), MESSAGE);
    assert.ok(Math.abs(d.pitch - pitch) <= 50, `pitch read as ${d.pitch}`);
  });
}

test('through hiss as loud as the tone', () => {
  const d = decode(morseAudio(MESSAGE, { noise: 1, random: seeded(1) }));
  assert.equal(d.text.trim(), MESSAGE);
});

test('through hiss twice as loud as the tone', () => {
  const d = decode(morseAudio(MESSAGE, { noise: 2, random: seeded(2) }));
  assert.equal(d.text.trim(), MESSAGE);
});

test('uneven hand keying', () => {
  for (const seed of [3, 4, 5]) {
    const d = decode(morseAudio(MESSAGE, { wpm: 16, jitter: 0.2, noise: 0.5, random: seeded(seed) }));
    assert.equal(d.text.trim(), MESSAGE, `seed ${seed}`);
  }
});

test('a faint signal', () => {
  const d = decode(morseAudio(MESSAGE, { level: 0.01, noise: 0.5, random: seeded(6) }));
  assert.equal(d.text.trim(), MESSAGE);
});

test('numbers, punctuation and procedure signals', () => {
  const text = 'UR RST 599 5NN = QTH? W1AW/4 73 <AR> <SK>';
  assert.equal(decode(morseAudio(text, { wpm: 22 })).text.trim(), text);
});

test('one sender after another at a different speed', () => {
  const slow = morseAudio('CQ DE N0CALL K', { wpm: 13, pitch: 600 });
  const fast = morseAudio('N0CALL DE W1AW 599 K', { wpm: 27, pitch: 650 });
  const both = new Float32Array(slow.length + 48000 * 12 + fast.length); // twelve seconds apart
  both.set(slow, 0);
  both.set(fast, slow.length + 48000 * 12);
  assert.equal(decode(both).text.trim().replace(/\s+/g, ' '), 'CQ DE N0CALL K N0CALL DE W1AW 599 K');
});

test('hiss alone, and silence, produce no text', () => {
  const random = seeded(7);
  const hiss = new Float32Array(48000 * 60);
  for (let i = 0; i < hiss.length; i++) hiss[i] = (Math.sqrt(-2 * Math.log(1 - random())) * Math.cos(2 * Math.PI * random())) * 0.2;
  const d = decode(hiss);
  assert.equal(d.text, '');
  assert.equal(d.hearing, false);
  assert.equal(decode(new Float32Array(48000 * 5)).text, '');
});

test('a steady tone that is not Morse produces no text', () => {
  const tone = new Float32Array(48000 * 10);
  for (let i = 0; i < tone.length; i++) tone[i] = 0.3 * Math.sin((2 * Math.PI * 700 * i) / 48000);
  assert.equal(decode(tone).text, '');
});

test('other sample rates, and sound arriving in odd-sized pieces', () => {
  assert.equal(decode(morseAudio(MESSAGE, { sampleRate: 16000 }), 16000, 333).text.trim(), MESSAGE);
  assert.equal(decode(morseAudio(MESSAGE, { sampleRate: 44100 }), 44100, 1).text.trim(), MESSAGE);
  assert.equal(decode(morseAudio(MESSAGE), 48000, 7919).text.trim(), MESSAGE);
});

test('two stations in turn, a few seconds apart, each at their own speed', () => {
  const parts = [
    morseAudio('W1AW DE N0CALL GA UR 599 K', { wpm: 14, pitch: 600 }),
    morseAudio('N0CALL DE W1AW R TU 73 <SK>', { wpm: 30, pitch: 620, lead: 3 }),
    morseAudio('TU E E', { wpm: 14, pitch: 600, lead: 3 }),
  ];
  // Two seconds of quiet at the end, as there would be on the air: the last,
  // very short transmission is read once it is clear nothing more is coming.
  const all = new Float32Array(parts.reduce((n, x) => n + x.length, 0) + 48000 * 2);
  let at = 0;
  for (const x of parts) {
    all.set(x, at);
    at += x.length;
  }
  assert.equal(decode(all).text.trim().replace(/\s+/g, ' '), 'W1AW DE N0CALL GA UR 599 K N0CALL DE W1AW R TU 73 <SK> TU E E');
});

// ---- Sounds that are not Morse. A decoder that prints letters for these
// would fill the screen with E's and T's on any busy channel.

function gaussian(random) {
  return Math.sqrt(-2 * Math.log(1 - random())) * Math.cos(2 * Math.PI * random());
}

// A receiver's squelch opening and closing: bursts of hiss, louder at low pitches.
function squelchBursts(seconds, random) {
  const out = new Float32Array(48000 * seconds);
  let i = 0;
  let low = 0;
  while (i < out.length) {
    const quiet = Math.round(48000 * (0.1 + random() * 1.2));
    i += quiet;
    const loud = Math.round(48000 * (0.08 + random() * 0.8));
    for (let n = 0; n < loud && i < out.length; n++, i++) {
      low += (gaussian(random) - low) * 0.08; // tilt it toward the low end
      out[i] = low * 0.9;
    }
  }
  return out;
}

// Something like a voice: a stack of harmonics on a wandering pitch, in syllables.
function voiceLike(seconds, random) {
  const out = new Float32Array(48000 * seconds);
  let i = 0;
  let phase = 0;
  while (i < out.length) {
    const syllable = Math.round(48000 * (0.09 + random() * 0.28));
    const f0 = 95 + random() * 110;
    const bend = (random() - 0.5) * 40;
    const formant = 400 + random() * 900;
    for (let n = 0; n < syllable && i < out.length; n++, i++) {
      const f = f0 + (bend * n) / syllable;
      phase += (2 * Math.PI * f) / 48000;
      const envelope = Math.sin((Math.PI * n) / syllable) ** 0.6;
      let v = 0;
      for (let k = 1; k <= 14; k++) v += Math.sin(k * phase) / (1 + Math.abs(k * f - formant) / 220);
      out[i] = 0.12 * envelope * v + gaussian(random) * 0.004;
    }
    i += Math.round(48000 * (0.03 + random() * 0.22));
  }
  return out;
}

// The single beep a repeater sends when someone lets go of the key.
function beeps(seconds) {
  const out = new Float32Array(48000 * seconds);
  for (let t = 2; t < seconds - 1; t += 4.3) {
    const start = Math.round(t * 48000);
    for (let n = 0; n < 7200; n++) out[start + n] = 0.3 * Math.sin((2 * Math.PI * 1000 * n) / 48000) * Math.min(1, n / 200, (7200 - n) / 200);
  }
  return out;
}

test('a squelch opening and closing on hiss produces no text', () => {
  for (const seed of [11, 12, 13]) assert.equal(decode(squelchBursts(60, seeded(seed))).text, '', `seed ${seed}`);
});

test('something like a voice produces next to nothing', () => {
  // This stand-in is far more tone-like than a real voice (real speech,
  // recorded off the air, prints nothing), so a stray letter is allowed.
  let letters = 0;
  for (const seed of [21, 22, 23, 24, 25]) letters += decode(voiceLike(60, seeded(seed))).text.replace(/\s/g, '').length;
  assert.ok(letters <= 3, `${letters} letters from five minutes of it`);
});

test('a repeater\'s beeps produce no text, before or after real Morse', () => {
  assert.equal(decode(beeps(30)).text, '');
  const morse = morseAudio(MESSAGE, { wpm: 20, pitch: 1000 });
  const after = beeps(20);
  const both = new Float32Array(morse.length + after.length);
  both.set(morse, 0);
  both.set(after, morse.length);
  assert.equal(decode(both).text.trim(), MESSAGE);
});

test('Morse is still read after loud hiss and then dead silence, as a squelch makes', () => {
  const random = seeded(41);
  const hiss = new Float32Array(48000 * 10);
  let low = 0;
  for (let i = 0; i < hiss.length; i++) {
    low += (gaussian(random) - low) * 0.08;
    hiss[i] = low * 0.9;
  }
  const morse = morseAudio(MESSAGE, { wpm: 18, noise: 0.6, lead: 2.5, random: seeded(42) });
  const both = new Float32Array(hiss.length + 48000 * 12 + morse.length); // twelve silent seconds between
  both.set(hiss, 0);
  both.set(morse, hiss.length + 48000 * 12);
  assert.equal(decode(both).text.trim(), MESSAGE);
});

test('Morse is read once it has had a while to get used to a different kind of hiss', () => {
  // Muffled hiss, as an FM receiver makes, then the even hiss of a CW
  // receiver: the change a mode switch brings.
  const random = seeded(51);
  const muffled = new Float32Array(48000 * 12);
  let low = 0;
  for (let i = 0; i < muffled.length; i++) {
    low += (gaussian(random) - low) * 0.03;
    muffled[i] = low * 2;
  }
  const morse = morseAudio(`${MESSAGE} ${MESSAGE}`, { wpm: 18, noise: 0.6, lead: 12, random: seeded(52) });
  const both = new Float32Array(muffled.length + morse.length);
  both.set(muffled, 0);
  both.set(morse, muffled.length);
  assert.equal(decode(both).text.trim(), `${MESSAGE} ${MESSAGE}`);
});

test('a strong tone on a nearly silent background, as on FM', () => {
  const d = decode(morseAudio(MESSAGE, { wpm: 20, pitch: 1000, level: 0.5, noise: 0.002, random: seeded(43) }));
  assert.equal(d.text.trim(), MESSAGE);
});

test('Morse is still read with a voice-like sound before it', () => {
  const voice = voiceLike(8, seeded(31));
  const morse = morseAudio(MESSAGE, { wpm: 18, noise: 0.5, lead: 2.5, random: seeded(32) });
  const both = new Float32Array(voice.length + morse.length);
  both.set(voice, 0);
  both.set(morse, voice.length);
  assert.equal(decode(both).text.trim(), MESSAGE);
});

test('working out the speed from mark lengths', () => {
  assert.equal(estimateUnit([60, 60, 60]), null); // too few
  assert.equal(estimateUnit([60, 61, 59, 60, 62]), null); // all dots: no way to tell yet
  assert.ok(Math.abs(estimateUnit([60, 180, 60, 60, 180]) - 60) < 1);
  assert.ok(Math.abs(estimateUnit([100, 310, 95, 290, 105, 300]) - 100) < 5);
  assert.equal(estimateUnit([60, 61, 600, 62, 590]), null); // ten to one is not dots and dashes
  assert.equal(estimateUnit([20, 45, 60, 150, 170, 400]), null); // every length there is: noise
});
