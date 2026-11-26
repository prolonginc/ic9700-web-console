// What each part of each band is used for, from the ARRL band plan (US):
// https://www.arrl.org/band-plan
//
// The band plan is a voluntary agreement, simplified here for a newcomer:
// neighbouring ARRL rows with the same practical meaning are merged. Local
// repeater coordinators can and do differ, which is why the hints say
// "usually".
//
// Segment fields: [startHz, endHz, kind, label]
// Optional 5th field: the repeater settings usually used there.

const MHZ = 1e6;
const KHZ = 1e3;

export const KINDS = {
  rout: {
    name: 'Repeater outputs',
    line: 'Repeaters transmit here, so this is where you listen.',
    tip: 'Repeaters transmit here, so this is where you listen. To talk through one, your radio has to transmit on the repeater’s other frequency (set Shift) and usually send an access tone.',
  },
  rin: {
    name: 'Repeater inputs',
    line: 'Repeaters listen here. You normally tune to a repeater’s output instead.',
    tip: 'Repeaters listen here. You normally don’t tune here yourself: tune to the repeater’s output and let Shift move your transmit frequency to this part of the band.',
  },
  simplex: {
    name: 'Simplex',
    line: 'Direct radio-to-radio contacts, no repeater. Keep Shift off.',
    tip: 'Simplex means talking directly radio to radio, with no repeater in between. You transmit and listen on the same frequency, so Shift should be off.',
  },
  weak: {
    name: 'Weak signal',
    line: 'Long-distance contacts using Morse (CW) and sideband (USB). Please don’t use FM here.',
    tip: 'Reserved for long-distance work with Morse code (CW) and sideband voice (USB), where stations are often barely audible. An FM signal here would cover them up.',
  },
  sat: {
    name: 'Satellites',
    line: 'Used for contacts through amateur satellites. Listen, but don’t transmit here otherwise.',
    tip: 'Set aside for contacts through amateur radio satellites. It’s fine to listen, but don’t transmit here unless you are working a satellite.',
  },
  other: {
    name: 'Other uses',
    line: 'Links, amateur TV, digital or experimental use. Listen first.',
    tip: 'Used for things like links between repeaters, amateur television, digital data and experiments. Listen for a while before transmitting.',
  },
};

const minus600 = { duplex: 'DUP-', offset: 600 * KHZ };
const plus600 = { duplex: 'DUP+', offset: 600 * KHZ };
const plus5M = { duplex: 'DUP+', offset: 5 * MHZ };
const minus5M = { duplex: 'DUP-', offset: 5 * MHZ };
const minus12M = { duplex: 'DUP-', offset: 12 * MHZ };

export const BANDS = [
  {
    id: '2m',
    name: '2 m',
    start: 144 * MHZ,
    end: 148 * MHZ,
    calling: { freq: 146.52 * MHZ, mode: 'FM' },
    segments: [
      [144.0, 144.1, 'weak', 'Morse (CW) and weak signals'],
      [144.1, 144.3, 'weak', 'Sideband voice and beacons'],
      [144.3, 144.5, 'sat', 'Satellites'],
      [144.5, 144.6, 'other', 'Linear translator inputs'],
      [144.6, 144.9, 'rin', 'Repeater inputs'],
      [144.9, 145.1, 'simplex', 'Simplex and packet data'],
      [145.1, 145.2, 'other', 'Linear translator outputs'],
      [145.2, 145.5, 'rout', 'Repeater outputs', minus600],
      [145.5, 145.8, 'other', 'Miscellaneous and experimental'],
      [145.8, 146.0, 'sat', 'Satellites'],
      [146.01, 146.37, 'rin', 'Repeater inputs'],
      [146.4, 146.58, 'simplex', 'Simplex'],
      [146.61, 146.97, 'rout', 'Repeater outputs', minus600],
      [147.0, 147.39, 'rout', 'Repeater outputs', plus600],
      [147.42, 147.57, 'simplex', 'Simplex'],
      [147.6, 147.99, 'rin', 'Repeater inputs'],
    ],
    marks: [
      [144.2, 'SSB calling frequency'],
      [146.52, 'National simplex calling frequency'],
    ],
  },
  {
    id: '70cm',
    name: '70 cm',
    start: 420 * MHZ,
    end: 450 * MHZ,
    calling: { freq: 446.0 * MHZ, mode: 'FM' },
    segments: [
      [420, 432, 'other', 'Amateur TV and links'],
      [432.0, 432.1, 'weak', 'Moonbounce and weak-signal Morse'],
      [432.1, 433.0, 'weak', 'Weak signal, mixed modes and beacons'],
      [433, 435, 'other', 'Auxiliary and repeater links'],
      [435, 438, 'sat', 'Satellites only'],
      [438, 442, 'other', 'Amateur TV repeater inputs and links'],
      [442, 445, 'rout', 'Repeaters (inputs or outputs, varies by region)', plus5M],
      [445, 447, 'simplex', 'Simplex, shared with links and repeaters'],
      [447, 450, 'rout', 'Repeaters (inputs or outputs, varies by region)', minus5M],
    ],
    marks: [
      [432.1, 'Weak-signal calling frequency'],
      [446.0, 'National simplex frequency'],
    ],
  },
  {
    id: '23cm',
    name: '23 cm',
    start: 1240 * MHZ,
    end: 1300 * MHZ,
    calling: { freq: 1294.5 * MHZ, mode: 'FM' },
    segments: [
      [1240, 1246, 'other', 'Amateur TV channel 1'],
      [1246, 1248, 'other', 'Point-to-point links'],
      [1248, 1252, 'other', 'Digital'],
      [1252, 1258, 'other', 'Amateur TV channel 2'],
      [1258, 1260, 'other', 'Point-to-point links'],
      [1260, 1270, 'sat', 'Satellite uplinks, experimental, simplex TV'],
      [1270, 1276, 'rin', 'Repeater inputs'],
      [1276, 1282, 'other', 'Amateur TV channel 3'],
      [1282, 1288, 'rout', 'Repeater outputs', minus12M],
      [1288, 1294, 'other', 'Broadband experimental and simplex TV'],
      [1294, 1295, 'simplex', 'FM simplex'],
      [1295, 1297, 'weak', 'Narrow band: weak signal, moonbounce, beacons'],
      [1297, 1300, 'other', 'Digital'],
    ],
    marks: [
      [1294.5, 'National FM simplex calling frequency'],
      [1296.1, 'Morse and sideband calling frequency'],
    ],
  },
].map((band) => ({
  ...band,
  segments: band.segments.map(([a, b, kind, label, usual]) => ({
    start: Math.round(a * MHZ),
    end: Math.round(b * MHZ),
    kind,
    label,
    usual: usual || null,
  })),
  marks: band.marks.map(([f, label]) => ({ freq: Math.round(f * MHZ), label })),
}));

export function bandFor(freqHz) {
  return BANDS.find((b) => freqHz >= b.start && freqHz <= b.end) || null;
}

export function segmentFor(freqHz) {
  const band = bandFor(freqHz);
  if (!band) return null;
  return band.segments.find((s) => freqHz >= s.start && freqHz <= s.end) || null;
}

// A named spot frequency within 2.5 kHz, e.g. a calling frequency.
export function markFor(freqHz) {
  const band = bandFor(freqHz);
  if (!band) return null;
  return band.marks.find((m) => Math.abs(m.freq - freqHz) <= 2500) || null;
}
