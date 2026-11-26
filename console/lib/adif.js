'use strict';

// Writes the logbook as ADIF, the plain-text format that logging programs and
// sites such as Logbook of The World, QRZ and eQSL import.
// Specification: https://adif.org (version 3.1.4).

const BANDS = [
  ['2m', 144e6, 148e6],
  ['70cm', 420e6, 450e6],
  ['23cm', 1240e6, 1300e6],
];

// The radio's mode names → ADIF's MODE and SUBMODE.
const MODES = {
  FM: ['FM'],
  AM: ['AM'],
  USB: ['SSB', 'USB'],
  LSB: ['SSB', 'LSB'],
  CW: ['CW'],
  'CW-R': ['CW'],
  RTTY: ['RTTY'],
  'RTTY-R': ['RTTY'],
  DV: ['DIGITALVOICE', 'DSTAR'],
  DD: ['DIGITALVOICE', 'DSTAR'],
};

function bandOf(hz) {
  const found = BANDS.find(([, a, b]) => hz >= a && hz <= b);
  return found ? found[0] : '';
}

// ADIF's plain format is ASCII: anything else becomes a question mark, and
// line breaks become spaces.
function clean(value) {
  return String(value)
    .replace(/[\r\n]+/g, ' ')
    .replace(/[^\x20-\x7e]/g, '?')
    .trim();
}

function field(name, value) {
  const text = clean(value);
  return text ? `<${name}:${text.length}>${text}` : '';
}

function mhz(hz) {
  // Six places at most, without trailing zeros beyond the kilohertz.
  return (hz / 1e6).toFixed(6).replace(/0{1,3}$/, '');
}

function record(entry, myCall) {
  const when = new Date(entry.time);
  if (!entry.call || Number.isNaN(when.getTime())) return '';
  const iso = when.toISOString(); // always UTC
  const [mode, submode] = MODES[entry.mode] || [entry.mode || ''];
  const sat = entry.satellite;
  // For a satellite contact "the frequency" is the one transmitted on.
  const txHz = sat && entry.txFreq ? entry.txFreq : entry.freq;
  const rxHz = sat && entry.txFreq ? entry.freq : 0;

  const parts = [
    field('CALL', String(entry.call).toUpperCase()),
    field('QSO_DATE', iso.slice(0, 10).replace(/-/g, '')),
    field('TIME_ON', iso.slice(11, 19).replace(/:/g, '')),
    txHz ? field('BAND', bandOf(txHz)) : '',
    txHz ? field('FREQ', mhz(txHz)) : '',
    rxHz ? field('BAND_RX', bandOf(rxHz)) : '',
    rxHz ? field('FREQ_RX', mhz(rxHz)) : '',
    field('MODE', mode),
    submode ? field('SUBMODE', submode) : '',
    field('RST_SENT', entry.rstSent || ''),
    field('RST_RCVD', entry.rstRcvd || ''),
    field('NAME', entry.name || ''),
    sat ? field('PROP_MODE', 'SAT') : '',
    sat ? field('SAT_NAME', sat) : '',
    myCall ? field('STATION_CALLSIGN', myCall.toUpperCase()) : '',
    myCall ? field('OPERATOR', myCall.toUpperCase()) : '',
    field('COMMENT', entry.notes || ''),
  ].filter(Boolean);
  return `${parts.join(' ')} <EOR>`;
}

// entries: the logbook, in any order. Returns the text of a .adi file.
function toAdif(entries, { myCall = '', now = new Date() } = {}) {
  const stamp = now.toISOString().replace(/[-:]/g, '').slice(0, 15).replace('T', ' ');
  const header = [
    'Logbook exported from IC-9700 Web Console',
    field('ADIF_VER', '3.1.4'),
    field('PROGRAMID', 'ic9700-web-console'),
    field('CREATED_TIMESTAMP', stamp),
    '<EOH>',
  ];
  const sorted = entries.slice().sort((a, b) => new Date(a.time) - new Date(b.time));
  return `${[...header, ...sorted.map((e) => record(e, myCall)).filter(Boolean)].join('\n')}\n`;
}

module.exports = { toAdif, bandOf };
