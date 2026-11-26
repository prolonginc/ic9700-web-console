// The FM voice satellites worth trying with this radio, and the ISS.
//
// Frequencies and tones are from AMSAT's FM satellite frequency summary and
// ARISS (https://www.amsat.org/fm-satellite-frequency-summary/,
// https://www.ariss.org/contact-the-iss.html), read in November 2026.
// Satellites come and go, and some are only switched on now and then, so
// check https://status.amsat.org before counting on one.
//
// id: the catalog number its orbit data is filed under.
// uplink / downlink: hertz. tone: tenths of a hertz, 0 for none.
// quiet: often silent, listed dimmed.

export const SATELLITES_AS_OF = 'November 2026';
export const STATUS_URL = 'https://status.amsat.org';

export const SATELLITES = [
  {
    id: 25544,
    name: 'ISS',
    uplink: 145990000,
    downlink: 437800000,
    tone: 670,
    note: 'The space station’s own repeater. The strongest and easiest to hear, and busy. It is switched off during spacewalks and dockings.',
  },
  {
    id: 27607,
    name: 'SO-50',
    uplink: 145850000,
    downlink: 436795000,
    tone: 670,
    note: 'An old favorite. If it stays silent on a good pass, it may be asleep: someone has to transmit for two seconds with a 74.4 Hz tone to wake it for ten minutes.',
  },
  {
    id: 101101,
    name: 'SO-131',
    uplink: 145925000,
    downlink: 436888000,
    tone: 0,
    note: 'A newer satellite that needs no tone. Its own data bursts break into the audio now and then.',
  },
  {
    id: 43017,
    name: 'AO-91',
    uplink: 435250000,
    downlink: 145960000,
    tone: 0,
    sunlitOnly: true,
    note: 'Its battery has failed, so it only works in sunlight. Do not transmit to it on a pass marked “in shadow”.',
  },
  {
    id: 61781,
    name: 'AO-123',
    uplink: 145850000,
    downlink: 435400000,
    tone: 670,
    quiet: true,
    note: 'Often only its beacon is on, with the repeater switched off.',
  },
  {
    id: 67291,
    name: 'RS95S',
    uplink: 145920000,
    downlink: 436950000,
    tone: 670,
    quiet: true,
    note: 'Still being tested by its builders, so it is on only some of the time.',
  },
  {
    id: 43678,
    name: 'PO-101',
    uplink: 437500000,
    downlink: 145900000,
    tone: 1413,
    quiet: true,
    note: 'Switched on by its operators to a schedule, and reported to be failing. Usually silent.',
  },
];
