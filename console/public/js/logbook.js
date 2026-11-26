// The logbook: who you talked to, when, and on what frequency. Kept on the
// console's computer, and exported as ADIF, the format logging sites take.

import { api } from './kept.js';
import { formatMHz, parseFrequency } from './format.js';

const DEFAULT_MODES = ['FM', 'DV', 'USB', 'LSB', 'CW', 'AM'];

function localInputValue(date) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

const whenFormat = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const whenFormatYear = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

function formatWhen(iso) {
  const d = new Date(iso);
  return (d.getFullYear() === new Date().getFullYear() ? whenFormat : whenFormatYear).format(d);
}

// ctx: { $, radio, state, toast, settings, tabs, listening() → { freq, mode }, tracking() → { name, uplink } | null }
export function setupLogbook(ctx) {
  const { $, radio, toast } = ctx;
  let entries = [];
  // Once you type in one of these it stops following the radio and the clock.
  const edited = { time: false, freq: false, mode: false };

  function buildModes() {
    const modes = (radio.info && radio.info.modes) || DEFAULT_MODES;
    const select = $('logMode');
    const keep = select.value;
    select.replaceChildren(...modes.map((m) => new Option(m, m)));
    if (keep && modes.includes(keep)) select.value = keep;
  }

  function prefill() {
    const { freq, mode } = ctx.listening();
    if (!edited.time) $('logTime').value = localInputValue(new Date());
    if (!edited.freq && freq) $('logFreq').value = formatMHz(freq);
    if (!edited.mode && mode) $('logMode').value = mode;
  }

  $('logTime').addEventListener('input', () => {
    edited.time = true;
  });
  $('logFreq').addEventListener('input', () => {
    edited.freq = true;
  });
  $('logMode').addEventListener('change', () => {
    edited.mode = true;
  });
  setInterval(prefill, 15000);

  // ---------------------------------------------------------------- List

  function render() {
    const sorted = entries.slice().sort((a, b) => new Date(b.time) - new Date(a.time));
    $('logRows').replaceChildren(
      ...sorted.map((entry) => {
        const tr = document.createElement('tr');
        const cell = (text, cls) => {
          const td = document.createElement('td');
          if (cls) td.className = cls;
          td.textContent = text;
          return td;
        };
        const when = cell(formatWhen(entry.time));
        when.title = `${entry.time.replace('T', ' ').slice(0, 16)} UTC`;
        const about = cell([entry.name, entry.notes].filter(Boolean).join(' · '), 'soft');
        if (entry.satellite) {
          const pill = document.createElement('span');
          pill.className = 'pill';
          pill.textContent = `via ${entry.satellite}`;
          about.prepend(pill, ' ');
        }
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'row-remove';
        remove.textContent = '×';
        remove.setAttribute('aria-label', `Remove the contact with ${entry.call}`);
        // Two presses, so a slip of the finger does not lose a contact.
        let armed = null;
        remove.addEventListener('click', async () => {
          if (!armed) {
            remove.textContent = 'Remove?';
            remove.style.width = 'auto';
            remove.style.padding = '0 8px';
            remove.style.fontSize = '14px';
            armed = setTimeout(() => {
              armed = null;
              remove.textContent = '×';
              remove.removeAttribute('style');
            }, 3000);
            return;
          }
          clearTimeout(armed);
          try {
            await api('DELETE', `api/logbook/${entry.id}`);
            entries = entries.filter((e) => e.id !== entry.id);
            render();
          } catch (err) {
            toast(`Couldn’t remove it: ${err.message}`);
          }
        });
        const last = document.createElement('td');
        last.className = 'num';
        last.append(remove);
        tr.append(
          when,
          cell(entry.call, 'figure'),
          cell(entry.freq ? formatMHz(entry.freq) : '', 'figure'),
          cell(entry.mode),
          cell(entry.rstSent),
          cell(entry.rstRcvd),
          about,
          last,
        );
        return tr;
      }),
    );

    $('logTableWrap').hidden = entries.length === 0;
    $('logExport').hidden = entries.length === 0;
    const summary = $('logSummary');
    if (entries.length) {
      const strong = document.createElement('strong');
      strong.textContent = `${entries.length} ${entries.length === 1 ? 'contact' : 'contacts'}`;
      summary.replaceChildren(strong, ' in your logbook, newest first.');
      $('logEmpty').textContent = '';
    } else {
      summary.textContent = '';
      $('logEmpty').textContent =
        'Nothing logged yet. After a contact, type the other station’s call sign above and press “Add to logbook”. The time, frequency and mode are filled in from the radio.';
    }
    const tab = $('tabLogbook');
    tab.replaceChildren('Logbook');
    if (entries.length) {
      const count = document.createElement('span');
      count.className = 'tab-count';
      count.textContent = String(entries.length);
      tab.append(count);
    }
  }

  // ----------------------------------------------------------------- Add

  $('logForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const error = $('logError');
    error.textContent = '';
    const call = $('logCall').value.trim().toUpperCase();
    if (!/^[A-Z0-9/]{3,}$/.test(call) || !/\d/.test(call) || !/[A-Z]/.test(call)) {
      error.textContent = 'That doesn’t look like a call sign. They are letters and digits, such as W1AW.';
      $('logCall').focus();
      return;
    }
    const freq = parseFrequency($('logFreq').value);
    if ($('logFreq').value.trim() && !Number.isFinite(freq)) {
      error.textContent = 'Type the frequency in MHz, such as 146.520.';
      $('logFreq').focus();
      return;
    }
    const time = $('logTime').value ? new Date($('logTime').value) : new Date();
    if (Number.isNaN(time.getTime())) {
      error.textContent = 'That date and time could not be read.';
      return;
    }
    const tracking = !edited.freq ? ctx.tracking() : null;
    const entry = {
      call,
      time: time.toISOString(),
      freq: Number.isFinite(freq) ? freq : 0,
      mode: $('logMode').value,
      rstSent: $('logSent').value.trim(),
      rstRcvd: $('logRcvd').value.trim(),
      name: $('logName').value.trim(),
      notes: $('logNotes').value.trim(),
      ...(tracking ? { satellite: tracking.name, txFreq: tracking.uplink } : {}),
    };
    try {
      const saved = await api('POST', 'api/logbook', entry);
      entries.push(saved.entry);
    } catch (err) {
      error.textContent = `Couldn’t save it: ${err.message}`;
      return;
    }
    for (const id of ['logCall', 'logName', 'logNotes']) $(id).value = '';
    $('logSent').value = '59';
    $('logRcvd').value = '59';
    edited.time = false;
    edited.freq = false;
    edited.mode = false;
    prefill();
    render();
    toast(`Logged ${call}.`, 3000);
  });

  // ------------------------------------------------------ My call sign

  const myCall = $('myCall');
  function showMyCall() {
    if (document.activeElement !== myCall) myCall.value = (ctx.settings.value && ctx.settings.value.callsign) || '';
  }
  myCall.addEventListener('change', async () => {
    const callsign = myCall.value.trim().toUpperCase().replace(/[^A-Z0-9/]/g, '');
    myCall.value = callsign;
    try {
      await ctx.settings.save({ ...(ctx.settings.value || {}), callsign });
    } catch (err) {
      toast(`Couldn’t save your call sign: ${err.message}`);
    }
  });

  // Opens the tab ready for a call sign to be typed.
  function open() {
    edited.time = false;
    edited.freq = false;
    edited.mode = false;
    prefill();
    ctx.tabs.show('tabLogbook');
    $('logCall').focus();
    $('panelLogbook').scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  $('logContactButton').addEventListener('click', open);

  radio.addEventListener('info', () => {
    buildModes();
    prefill();
  });
  radio.addEventListener('state', (e) => {
    if ('frequency' in e.detail || 'mode' in e.detail || 'subFrequency' in e.detail) prefill();
  });

  buildModes();
  prefill();
  render();
  api('GET', 'api/logbook')
    .then((data) => {
      entries = data.entries || [];
      render();
    })
    .catch(() => {
      $('logEmpty').textContent = 'The logbook couldn’t be read from the console just now.';
    });

  return { open, showMyCall };
}
