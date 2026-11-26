'use strict';

// What this program needs to know about a particular radio model.
// Command bytes, spans and tones are from Icom's CI-V reference for the
// IC-9700. The meter calibration points follow the ones wfview uses for it.

const IC9700 = {
  model: 'IC-9700',
  civAddress: 0xa2,

  bands: [
    { name: '23cm', start: 1240000000, end: 1300000000 },
    { name: '70cm', start: 420000000, end: 450000000 },
    { name: '2m', start: 144000000, end: 148000000 },
  ],

  // Mode name and the byte the radio uses for it, in the order shown to people.
  modes: [
    ['LSB', 0x00],
    ['USB', 0x01],
    ['AM', 0x02],
    ['CW', 0x03],
    ['RTTY', 0x04],
    ['FM', 0x05],
    ['CW-R', 0x07],
    ['RTTY-R', 0x08],
    ['DV', 0x17],
    ['DD', 0x22],
  ],

  // Scope spans in center mode: hertz either side of the tuned frequency.
  spans: [2500, 5000, 10000, 25000, 50000, 100000, 250000, 500000],

  // CTCSS tones in tenths of a hertz.
  ctcssTones: [
    670, 693, 719, 744, 770, 797, 825, 854, 885, 915, 948, 974, 1000, 1035, 1072, 1109, 1148, 1188, 1230, 1273, 1318,
    1365, 1413, 1462, 1514, 1567, 1598, 1622, 1655, 1679, 1738, 1773, 1799, 1835, 1862, 1928, 1966, 1995, 2035, 2065,
    2107, 2181, 2257, 2291, 2336, 2418, 2503, 2541,
  ],

  // Tone-squelch type byte and the name the page uses for it.
  toneModes: [
    [0x00, 'OFF'],
    [0x01, 'TONE'],
    [0x02, 'TSQL'],
    [0x03, 'DTCS'],
    [0x06, 'DTCS(T)'],
    [0x07, 'TONE(T)/DTCS(R)'],
    [0x08, 'DTCS(T)/TSQL(R)'],
    [0x09, 'TONE(T)/TSQL(R)'],
  ],

  // Meter readings arrive as 0 to 255. Each table maps that to a real unit.
  sMeter: [[0, -54], [10, -48], [30, -36], [60, -24], [90, -12], [120, 0], [241, 64]], // dB relative to S9
  powerMeter: [
    [0, 0], [21, 5], [43, 10], [65, 15], [83, 20], [95, 25], [105, 30], [114, 35], [124, 40], [143, 50], [183, 75],
    [213, 100], [255, 120],
  ], // watts
  swrMeter: [[0, 1], [48, 1.5], [80, 2], [120, 3], [240, 6]],

  // "Data Off Mod Input": where transmit audio comes from in voice modes.
  modInputLan: 5,
};

function profileFor(/* modelName */) {
  // Only the IC-9700 has been tested. Other network-capable Icoms speak the
  // same protocol, so they get this profile until they have their own.
  return IC9700;
}

// Straight-line interpolation through a calibration table.
function calibrate(table, raw) {
  if (raw <= table[0][0]) return table[0][1];
  for (let i = 1; i < table.length; i++) {
    const [x1, y1] = table[i];
    if (raw <= x1) {
      const [x0, y0] = table[i - 1];
      return y0 + ((raw - x0) / (x1 - x0)) * (y1 - y0);
    }
  }
  return table[table.length - 1][1];
}

module.exports = { IC9700, profileFor, calibrate };
