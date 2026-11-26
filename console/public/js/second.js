// The radio's second receiver: a strip under the main readout to switch it
// on, tune it, set how loud it is next to the main one, and swap the two.

import { bandFor } from './bandplan.js';
import { formatMHz, parseFrequency } from './format.js';

// ctx: { $, radio, state, speaker, store, toast, inRadioRange(hz), rangeText() }
export function setupSecond(ctx) {
  const { $, radio, state, speaker, store } = ctx;
  const volume = $('secondVolume');
  volume.value = String(store.get('secondVolume', 60));

  const available = () => !!(radio.info && radio.info.features && radio.info.features.secondReceiver);

  // Which receivers this page needs sent to it.
  function wantedMix() {
    if (state.satMode) return 'sub'; // the satellite is heard on the second receiver
    if (state.dualWatch && Number(volume.value) > 0) return 'both';
    return 'main';
  }

  function applyMix() {
    if (!available()) return;
    const v = Number(volume.value) / 100;
    // Squared so the slider feels even to the ear, like the main volume.
    speaker.setLevels(1, v * v);
    radio.send('setAudioMix', { value: wantedMix() });
  }

  function render() {
    const strip = $('second');
    // In satellite mode the tracking bar says what the two receivers are doing.
    strip.hidden = !available() || !!state.satMode;
    if (strip.hidden) return;
    const on = !!state.dualWatch;
    const toggle = $('secondToggle');
    toggle.setAttribute('aria-pressed', String(on));
    toggle.textContent = on ? 'On' : 'Off';
    $('secondOn').hidden = !on;
    if (!on) return;
    $('secondFreqText').textContent = state.subFrequency ? formatMHz(state.subFrequency) : '---.---';
    $('secondMode').textContent = state.subMode || '';
  }

  $('secondToggle').addEventListener('click', () => {
    const on = !state.dualWatch;
    radio.send('setDualWatch', { value: on });
    radio.merge({ dualWatch: on });
  });

  function closeForm() {
    $('secondForm').hidden = true;
    $('secondFreq').hidden = false;
    $('secondError').textContent = '';
  }

  $('secondFreq').addEventListener('click', () => {
    $('secondFreq').hidden = true;
    $('secondForm').hidden = false;
    const input = $('secondInput');
    input.value = state.subFrequency ? formatMHz(state.subFrequency) : '';
    input.focus();
    input.select();
  });
  $('secondCancel').addEventListener('click', closeForm);
  $('secondInput').addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeForm();
  });
  $('secondForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const hz = parseFrequency($('secondInput').value);
    const error = $('secondError');
    if (!Number.isFinite(hz)) {
      error.textContent = 'Type a frequency in MHz, such as 446.000.';
      return;
    }
    if (!ctx.inRadioRange(hz)) {
      error.textContent = `This radio covers ${ctx.rangeText()}.`;
      return;
    }
    const mainBand = bandFor(state.frequency);
    const band = bandFor(hz);
    if (mainBand && band && mainBand.id === band.id) {
      error.textContent = `The two receivers have to be on different bands, and the main one is on ${mainBand.name}. Pick another band, or use “Swap with main”.`;
      return;
    }
    radio.send('setSubFrequency', { value: hz });
    radio.merge({ subFrequency: hz });
    closeForm();
  });

  volume.addEventListener('input', () => {
    store.set('secondVolume', Number(volume.value));
    applyMix();
  });

  $('secondSwap').addEventListener('click', () => {
    if (state.transmitting) return;
    radio.send('swapBands');
  });

  radio.addEventListener('info', () => {
    render();
    if (radio.rigConnected) applyMix();
  });
  radio.addEventListener('state', (e) => {
    const d = e.detail;
    if ('dualWatch' in d || 'satMode' in d) applyMix();
    if ('dualWatch' in d || 'satMode' in d || 'subFrequency' in d || 'subMode' in d) render();
  });

  render();
  return { render, applyMix };
}
