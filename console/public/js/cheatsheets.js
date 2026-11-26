// The Cheat sheets tab: things a newcomer would otherwise have to look up.
// One sheet at a time, and a search box that looks through all of them.

import {
  Q_CODES,
  SHORTHAND,
  VOICE_WORDS,
  PHONETICS,
  spellOut,
  READABILITY,
  STRENGTH,
  TONE,
  LICENSES,
  PRIVILEGES,
  PRIVILEGES_CHECKED,
  PRIVILEGES_SOURCE,
  PRIVILEGES_RULES,
  sideOfLineA,
} from './reference.js';

const STORAGE_KEY = 'console.sheet';

const SHEETS = [
  { id: 'bands', name: 'My bands' },
  { id: 'q', name: 'Q codes' },
  { id: 'shorthand', name: 'Shorthand' },
  { id: 'voice', name: 'On the air' },
  { id: 'phonetics', name: 'Phonetics' },
  { id: 'reports', name: 'Signal reports' },
];

// Lists that the search box looks through: [sheet name, entries].
const TERMS = [
  ['Q codes', Q_CODES],
  ['Shorthand', SHORTHAND],
  ['On the air', VOICE_WORDS],
];

const el = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

// The examples are written with the stand-in call sign N0CALL.
const STAND_IN = /N0CALL/g;

// A list of terms: the code, what it means, and a line of explanation.
// me: the reader's own call sign, to put in the examples, if they have one.
function termList(entries, me = '') {
  const list = el('dl', 'terms');
  for (const [term, meaning, more] of entries) {
    const item = el('div', 'term');
    item.append(el('dt', '', term));
    const dd = el('dd');
    dd.append(el('strong', '', meaning));
    if (more) dd.append(` ${me ? more.replace(STAND_IN, me) : more}`);
    item.append(dd);
    list.append(item);
  }
  return list;
}

function scale(title, rows, note) {
  const box = el('div', 'scale');
  box.append(el('h3', '', title));
  const table = el('table', 'scale-table');
  for (const [n, words] of rows) {
    const tr = el('tr');
    tr.append(el('th', '', n), el('td', '', words));
    table.append(tr);
  }
  box.append(table);
  if (note) box.append(el('p', 'sheet-note', note));
  return box;
}

// ctx: { $, settings, toast, onProfile() }
export function setupCheatsheets(ctx) {
  const { $, settings, toast } = ctx;
  const body = $('sheetBody');
  const search = $('sheetSearch');
  let current = 'bands';
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (SHEETS.some((s) => s.id === saved)) current = saved;
  } catch {
    /* start on the first sheet */
  }

  const license = () => (settings.value && settings.value.license) || '';
  const callsign = () => (settings.value && settings.value.callsign) || '';
  const place = () => {
    const loc = settings.value && settings.value.location;
    return loc && Number.isFinite(loc.lat) && Number.isFinite(loc.lon) ? loc : null;
  };

  // --------------------------------------------- Call sign and license
  //
  // Asked for once, at the top of the tab, and used by every sheet. The call
  // sign is the one the Logbook has too.

  const callInput = $('sheetCall');
  const licenseSelect = $('licenseSelect');
  licenseSelect.append(new Option('Not set', ''), new Option('Not licensed yet', 'none'), ...LICENSES.map((l) => new Option(l.name, l.id)));

  async function saveProfile(changes) {
    try {
      await settings.save({ ...(settings.value || {}), ...changes });
    } catch (err) {
      toast(`Couldn’t save that: ${err.message}`);
    }
    ctx.onProfile();
    render();
  }

  callInput.addEventListener('change', () => {
    const value = callInput.value.trim().toUpperCase().replace(/[^A-Z0-9/]/g, '');
    callInput.value = value;
    saveProfile({ callsign: value });
  });
  licenseSelect.addEventListener('change', () => saveProfile({ license: licenseSelect.value }));

  function renderProfile() {
    if (document.activeElement !== callInput) callInput.value = callsign();
    licenseSelect.value = license();
    $('sheetYouNote').textContent = callsign() ? 'The examples below use your call sign.' : 'Enter your call sign and the examples below will use it.';
  }

  // ------------------------------------------------------------ My bands

  function bandsSheet() {
    const mine = license();
    const wrap = el('div', 'cheat');

    // What it means for the radio on the desk.
    const summary = el('p', 'sheet-lead');
    const className = (LICENSES.find((l) => l.id === mine) || {}).name;
    if (mine === 'none') {
      summary.textContent =
        'Without a license you may listen anywhere, and that is the best way to start. Transmitting needs a license: in the United States the first one is Technician, and it covers every band this radio has.';
    } else if (className) {
      summary.append(
        el('strong', '', `${className}: you may transmit on all three of this radio’s bands, in every mode.`),
        ' On 2 meters, 70 centimeters and 23 centimeters all three license classes have the same privileges. The classes differ on the shortwave (HF) bands below, which need a different radio.',
      );
    } else {
      summary.textContent =
        'Choose your license class above to see what you may use. On this radio’s three bands all three US classes have the same privileges; they differ on the shortwave (HF) bands, which need a different radio.';
    }
    wrap.append(summary);

    const table = el('table', 'list privileges');
    const head = el('tr');
    head.append(el('th', '', 'Band'), el('th', '', 'MHz'), el('th', '', 'What for'));
    for (const l of LICENSES) {
      const th = el('th', l.id === mine ? 'mine' : '', l.name);
      head.append(th);
    }
    const thead = el('thead');
    thead.append(head);
    table.append(thead);
    const tbody = el('tbody');
    // The bands of the radio on the desk first, then everything else in
    // order of frequency.
    const group = (title) => {
      const tr = el('tr', 'group');
      const th = el('th', '', title);
      th.colSpan = 3 + LICENSES.length;
      th.scope = 'colgroup';
      tr.append(th);
      tbody.append(tr);
    };
    const ordered = [...PRIVILEGES.filter((b) => b.thisRadio), ...PRIVILEGES.filter((b) => !b.thisRadio)];
    for (const band of ordered) {
      if (band === ordered[0]) group('The bands this radio has');
      if (band === ordered.find((b) => !b.thisRadio)) group('Other amateur bands, which need other radios');
      band.rows.forEach(([range, what, ...who], i) => {
        const tr = el('tr', band.thisRadio ? 'this-radio' : '');
        if (i === 0) {
          const th = el('th', 'band-name');
          th.rowSpan = band.rows.length;
          th.scope = 'rowgroup';
          th.append(band.band);
          tr.append(th);
        }
        tr.append(el('td', 'figure', range), el('td', 'soft', what));
        who.forEach((allowed, c) => {
          const td = el('td', `may${LICENSES[c].id === mine ? ' mine' : ''}`);
          if (allowed === true) {
            td.textContent = 'Yes';
            td.classList.add('yes');
          } else if (allowed === false) {
            td.textContent = '–';
            td.classList.add('no');
            td.setAttribute('aria-label', 'No');
          } else {
            td.textContent = allowed;
            td.classList.add('part');
          }
          tr.append(td);
        });
        tbody.append(tr);
      });
    }
    table.append(tbody);
    const scroller = el('div', 'table-wrap tall');
    scroller.append(table);
    wrap.append(scroller);

    // Two rules for 70 centimeters that reach a radio of this power.
    const local = el('p', 'sheet-note');
    const here = place();
    const side = here ? sideOfLineA(here.lat, here.lon) : null;
    local.append(
      el('strong', '', 'Two things to know on 70 centimeters. '),
      'North of “Line A”, a line that runs a little south of the Canadian border, nobody may transmit between 420 and 430 MHz. ',
    );
    if (side === 'north') {
      local.append(el('strong', 'warn-text', 'The location you saved is north of that line, so 420 to 430 MHz is closed to you for transmitting. '));
    } else if (side === 'near') {
      local.append(el('strong', '', 'The location you saved is close to that line: find out which side you are on before using 420 to 430 MHz. '));
    } else if (side === 'south') {
      local.append('The location you saved is south of it. ');
    }
    local.append(
      'And in Arizona, Florida, New Mexico, parts of California, Nevada and Texas, and near some military sites elsewhere, the limit on that band is 50 watts, which is less than this radio’s full power.',
    );
    wrap.insertBefore(local, scroller); // above the chart: it is the part that depends on where you are

    const foot = el('p', 'panel-foot');
    const link = (text, href) => {
      const a = el('a', '', text);
      a.href = href;
      a.target = '_blank';
      a.rel = 'noopener';
      return a;
    };
    foot.append(
      `United States (FCC) rules, checked ${PRIVILEGES_CHECKED}. “Morse and data” parts are closed to voice; “voice and image” parts also allow Morse. The usual limit is 1,500 watts. On 60 meters there are also four single channels at 100 watts. The two bands below 1 MHz, and the 219 to 220 MHz data links, have special rules and are left out, as are the Novice and Advanced classes, which are no longer issued. For the full picture see `,
      link('the ARRL band chart', PRIVILEGES_SOURCE),
      ' or ',
      link('the rules themselves', PRIVILEGES_RULES),
      '. Whatever your class, give your call sign at the end of a contact and at least every ten minutes during it.',
    );
    wrap.append(foot);
    return wrap;
  }

  // ----------------------------------------------------------- Phonetics

  function phoneticsSheet() {
    const wrap = el('div', 'cheat');
    const row = el('div', 'spell');
    const label = el('label', 'inline-field');
    label.dataset.tip = 'spell';
    label.append('Spell out');
    const input = el('input');
    input.type = 'text';
    input.id = 'spellInput';
    input.maxLength = 24;
    input.autocomplete = 'off';
    input.spellcheck = false;
    input.placeholder = 'W1AW';
    input.value = callsign();
    label.append(input);
    const out = el('p', 'spell-out');
    out.setAttribute('aria-live', 'polite');
    const show = () => {
      out.textContent = spellOut(input.value) || 'Type a call sign or a word to hear how to say it letter by letter.';
      out.classList.toggle('soft', !spellOut(input.value));
    };
    input.addEventListener('input', show);
    show();
    row.append(label, out);
    wrap.append(row);

    const grid = el('div', 'phonetic-grid');
    for (const [char, word] of Object.entries(PHONETICS).sort(([a], [b]) => (/\d/.test(a) ? 1 : 0) - (/\d/.test(b) ? 1 : 0) || a.localeCompare(b))) {
      if (char === '/') continue;
      const cell = el('span');
      cell.append(el('b', '', char), word);
      grid.append(cell);
    }
    wrap.append(grid);
    wrap.append(
      el(
        'p',
        'sheet-note',
        'Use these words, not ones made up on the spot: they were chosen to be told apart through noise, and everyone knows them. Say your call sign in phonetics when you first call someone, and whenever they have trouble hearing it. A “/” in a call sign is said “stroke” or “portable”.',
      ),
    );
    return wrap;
  }

  // ------------------------------------------------------ Signal reports

  function reportsSheet() {
    const wrap = el('div', 'cheat');
    wrap.append(
      el(
        'p',
        'sheet-lead',
        'A signal report tells the other station how well you hear them. On voice it is two digits, readability then strength: “five nine” is perfectly readable and extremely strong, “four five” is readable but only fairly good. Morse adds a third digit for tone, so a good report is 599.',
      ),
    );
    const scales = el('div', 'scales');
    scales.append(
      scale('Readability', READABILITY),
      scale('Strength', STRENGTH, 'Read it off the signal meter: S5 on the meter is a strength of 5.'),
      scale('Tone, Morse only', TONE),
    );
    wrap.append(scales);
    wrap.append(
      el(
        'p',
        'sheet-note',
        'On FM repeaters people seldom give numbers. They say how quiet the signal is: “full quieting” for no hiss at all, “a little scratchy”, or “in and out”. Through a repeater the meter shows the repeater’s strength, not the other person’s.',
      ),
    );
    return wrap;
  }

  // ---------------------------------------------------------- On the air

  function voiceSheet() {
    const wrap = el('div', 'cheat');
    const me = callsign() || 'your call sign';
    const said = callsign() ? spellOut(callsign()) : 'your call sign in phonetics';
    const scripts = el('div', 'scripts');
    for (const [title, line, why] of [
      ['To find someone on a repeater', `“${me}, monitoring.”`, 'No “CQ” on repeaters. Listen for half a minute first.'],
      ['To call anyone on simplex', `“CQ CQ CQ, this is ${said}, calling CQ and standing by.”`, 'On a calling frequency, move elsewhere once you have a reply.'],
      ['To call one station', `“W1AW, this is ${me}.”`, 'Their call sign first, then yours.'],
      ['To finish', `“Seventy-three. ${me}, clear.”`, 'Your call sign at the end is a legal requirement, and every ten minutes meanwhile.'],
    ]) {
      const card = el('div', 'script');
      card.append(el('h3', '', title), el('p', 'script-line', line), el('p', 'sheet-note', why));
      scripts.append(card);
    }
    wrap.append(scripts, termList(VOICE_WORDS, callsign()));
    return wrap;
  }

  // -------------------------------------------------------------- Search

  function searchResults(query) {
    const q = query.toLowerCase();
    const wrap = el('div', 'cheat');
    let total = 0;
    for (const [name, entries] of TERMS) {
      // The code itself first, then anything that mentions the word. One or
      // two letters are too few to search the explanations with.
      const exact = entries.filter(([term]) => term.toLowerCase().startsWith(q));
      const other = q.length < 3 ? [] : entries.filter((e) => !exact.includes(e) && e.join(' ').toLowerCase().includes(q));
      const found = [...exact, ...other];
      if (!found.length) continue;
      total += found.length;
      wrap.append(el('h3', 'sheet-heading', name), termList(found, callsign()));
    }
    const letters = [...query.toUpperCase()].filter((c) => PHONETICS[c] && c !== '/');
    if (query.length === 1 && letters.length === 1) {
      total++;
      wrap.append(el('h3', 'sheet-heading', 'Phonetics'), termList([[letters[0], PHONETICS[letters[0]], '']]));
    }
    if (!total) wrap.append(el('p', 'panel-empty', `Nothing here matches “${query}”. Try the code itself, such as QSY, or a word from its meaning, such as “frequency”.`));
    return wrap;
  }

  // -------------------------------------------------------------- Render

  function render() {
    renderProfile();
    const query = search.value.trim();
    for (const b of $('sheetButtons').children) b.setAttribute('aria-pressed', String(!query && b.dataset.sheet === current));
    let content;
    if (query) content = searchResults(query);
    else if (current === 'bands') content = bandsSheet();
    else if (current === 'q') {
      content = el('div', 'cheat');
      content.append(
        el('p', 'sheet-lead', 'Three-letter codes from the days of Morse, now said on voice too. Each is a statement, or a question when asked as one: “QSY?” asks whether to change frequency.'),
        termList(Q_CODES, callsign()),
      );
    } else if (current === 'shorthand') {
      content = el('div', 'cheat');
      content.append(
        el('p', 'sheet-lead', 'Abbreviations from Morse, where every letter costs effort. You will see them in the Morse tab and in logs, and hear some of them spoken.'),
        termList(SHORTHAND, callsign()),
      );
    } else if (current === 'voice') content = voiceSheet();
    else if (current === 'phonetics') content = phoneticsSheet();
    else content = reportsSheet();
    body.replaceChildren(content);
  }

  $('sheetButtons').replaceChildren(
    ...SHEETS.map((sheet) => {
      const b = el('button', '', sheet.name);
      b.type = 'button';
      b.dataset.sheet = sheet.id;
      b.addEventListener('click', () => {
        current = sheet.id;
        search.value = '';
        try {
          localStorage.setItem(STORAGE_KEY, current);
        } catch {
          /* not remembered, no harm */
        }
        render();
      });
      return b;
    }),
  );
  search.addEventListener('input', render);

  render();
  return { render, license };
}
