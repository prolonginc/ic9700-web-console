// The Morse tab: feeds the radio's sound to the decoder and shows what it reads.

import { MorseDecoder, MORSE } from './morse.js';

const KEEP_CHARS = 4000;
const AUDIO_HEADER_BYTES = 6;

// One channel of a sound frame from the radio link, as numbers from -1 to 1.
// With two receivers in the frame, the main one (the first) is taken.
function monoSamples(buffer, mayBeStereo) {
  const stereo = mayBeStereo && new Uint8Array(buffer, 1, 1)[0] === 2;
  const pcm = new Int16Array(buffer, AUDIO_HEADER_BYTES, Math.floor((buffer.byteLength - AUDIO_HEADER_BYTES) / 2));
  const step = stereo ? 2 : 1;
  const out = new Float32Array(Math.floor(pcm.length / step));
  for (let i = 0; i < out.length; i++) out[i] = pcm[i * step] / 32768;
  return out;
}

// ctx: { $, radio, toast, syncAudio() }
export function setupMorse(ctx) {
  const { $, radio, toast } = ctx;
  const decoder = new MorseDecoder(48000);
  let running = false;
  let rate = 48000;
  let shown = null;
  let lastSoundAt = 0;

  // Called with every sound frame while reading.
  function feed(buffer, mayBeStereo) {
    if (!running || buffer.byteLength < AUDIO_HEADER_BYTES + 2) return;
    const frameRate = new DataView(buffer).getUint16(4, true) * 1000 || 48000;
    if (frameRate !== rate) {
      rate = frameRate;
      decoder.setRate(rate);
      decoder.reset();
    }
    lastSoundAt = Date.now();
    decoder.push(monoSamples(buffer, mayBeStereo));
    if (decoder.text.length > KEEP_CHARS) decoder.text = decoder.text.slice(-KEEP_CHARS / 2);
  }

  function status() {
    if (!running) return '';
    if (!radio.rigConnected) return 'Waiting for the radio…';
    if (Date.now() - lastSoundAt > 1500) return 'Waiting for sound from the radio…';
    if (!decoder.hearing) return 'Listening for Morse…';
    if (decoder.fresh || !decoder.wpm) return 'There is a tone. Working out how fast it is being sent…';
    return `Reading Morse at about ${decoder.wpm} words a minute, on a tone of ${decoder.pitch} Hz.`;
  }

  function render() {
    const toggle = $('morseToggle');
    toggle.textContent = running ? 'Stop reading' : 'Read Morse';
    toggle.classList.toggle('primary', !running);
    const has = decoder.text.trim().length > 0;
    $('morseOut').hidden = !running && !has;
    $('morseEmpty').hidden = running || has;
    $('morseCopy').hidden = !has;
    $('morseClear').hidden = !has;
    $('morseStatus').textContent = status();
    if (decoder.text !== shown) {
      shown = decoder.text;
      const out = $('morseOut');
      const atEnd = out.scrollHeight - out.scrollTop - out.clientHeight < 40;
      $('morseText').textContent = shown;
      if (atEnd) out.scrollTop = out.scrollHeight;
    }
  }

  $('morseToggle').addEventListener('click', () => {
    running = !running;
    if (running) {
      const text = decoder.text; // keep what was read before
      decoder.reset();
      decoder.text = text && !text.endsWith('\n') ? `${text.trimEnd()}\n` : text;
      lastSoundAt = 0;
    }
    ctx.syncAudio();
    render();
  });

  $('morseClear').addEventListener('click', () => {
    decoder.text = '';
    render();
  });

  $('morseCopy').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(decoder.text.trim());
      toast('Copied.', 2500);
    } catch {
      toast('Couldn’t copy. Select the text and copy it by hand.');
    }
  });

  // The light follows the keying; the rest changes more slowly.
  const lamp = $('morseLamp');
  function blink() {
    lamp.classList.toggle('on', running && decoder.keyDown && decoder.hearing);
    requestAnimationFrame(blink);
  }
  requestAnimationFrame(blink);
  setInterval(() => {
    if (running) render();
  }, 150);

  // The alphabet, for learning it.
  const chart = $('morseChart');
  const wanted = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789.,?/='.split('');
  const codeFor = Object.fromEntries(Object.entries(MORSE).map(([code, char]) => [char, code]));
  chart.replaceChildren(
    ...wanted.map((char) => {
      const cell = document.createElement('span');
      const letter = document.createElement('b');
      letter.textContent = char;
      const code = document.createElement('i');
      code.textContent = codeFor[char].replace(/\./g, '•').replace(/-/g, '–');
      cell.append(letter, code);
      return cell;
    }),
  );

  render();
  return {
    get running() {
      return running;
    },
    feed,
    decoder,
  };
}
