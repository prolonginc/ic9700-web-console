// The orbit model against the reference results published with
// "Revisiting Spacetrack Report #3" (Vallado, Crawford, Hujsak, Kelso, 2006).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createSatellite, propagateMinutes, elementsFromTle, elementsFromOmm, look, dopplerDown, dopplerUp, gmst } from '../console/public/js/sgp4.js';
import { findPasses, gridToLocation, locationToGrid, parseLocation } from '../console/public/js/passes.js';

const CASES = [
  {
    name: '00005, an eccentric orbit',
    lines: ['1 00005U 58002B   00179.78495062  .00000023  00000-0  28098-4 0  4753', '2 00005  34.2682 348.7242 1859667 331.7664  19.3264 10.82419157413667'],
    at: [
      [0, [7022.46529266, -1400.08296755, 0.03995155], [1.893841015, 6.405893759, 4.53480725]],
      [360, [-7154.03120202, -3783.17682504, -3536.19412294], [4.741887409, -4.151817765, -2.093935425]],
      [720, [-7134.59340119, 6531.68641334, 3260.27186483], [-4.113793027, -2.911922039, -2.557327851]],
    ],
  },
  {
    name: '06251, a low orbit with drag',
    lines: ['1 06251U 62025E   06176.82412014  .00008885  00000-0  12808-3 0  3985', '2 06251  58.0579  54.0425 0030035 139.1568 221.1854 15.56387291  6774'],
    at: [
      [0, [3988.31022699, 5498.96657235, 0.90055879], [-3.290032738, 2.35765282, 6.496623475]],
      [120, [-3935.69800083, 409.10980837, 5471.33577327], [-3.374784183, -6.635211043, -1.942056221]],
    ],
  },
  {
    name: '28057, a sun-synchronous orbit',
    lines: ['1 28057U 03049A   06177.78615833  .00000060  00000-0  35940-4 0  1836', '2 28057  98.4283 247.6961 0000884  88.1964 271.9322 14.35478080140550'],
    at: [[0, [-2715.28237486, -6619.26436889, -0.01341443], [-1.008587273, 0.422782003, 7.385272942]]],
  },
];

for (const c of CASES) {
  test(`SGP4 reproduces the reference for ${c.name}`, () => {
    const sat = createSatellite(elementsFromTle(c.name, ...c.lines));
    assert.ok(sat);
    for (const [minutes, r, v] of c.at) {
      const got = propagateMinutes(sat, minutes);
      for (let i = 0; i < 3; i++) {
        assert.ok(Math.abs(got.r[i] - r[i]) < 1e-5, `position ${i} at ${minutes} min`);
        assert.ok(Math.abs(got.v[i] - v[i]) < 1e-8, `velocity ${i} at ${minutes} min`);
      }
    }
  });
}

// A space-station-like orbit, written the way CelesTrak's CSV gives it.
const station = () =>
  createSatellite(
    elementsFromOmm({
      OBJECT_NAME: 'TEST STATION',
      NORAD_CAT_ID: '99999',
      EPOCH: '2026-11-26T04:00:00.000000',
      MEAN_MOTION: '15.5',
      ECCENTRICITY: '.0004',
      INCLINATION: '51.64',
      RA_OF_ASC_NODE: '100.0',
      ARG_OF_PERICENTER: '90.0',
      MEAN_ANOMALY: '10.0',
      BSTAR: '.00012',
    }),
  );

test('orbits too high for this model, and broken data, are turned away', () => {
  assert.equal(createSatellite(elementsFromOmm({ EPOCH: '2026-11-26T04:00:00', MEAN_MOTION: '1.0027', ECCENTRICITY: '.0002', INCLINATION: '0.02', RA_OF_ASC_NODE: '0', ARG_OF_PERICENTER: '0', MEAN_ANOMALY: '0', BSTAR: '0' })), null);
  assert.equal(createSatellite(elementsFromOmm({ EPOCH: 'nonsense', MEAN_MOTION: '15.5' })), null);
});

test('a pass rises, peaks with the range rate near zero, and sets', () => {
  const sat = station();
  const here = { lat: 41.73, lon: -72.71 };
  const passes = findPasses(sat, here, new Date('2026-11-26T12:00:00Z'), 24, 5);
  assert.ok(passes.length >= 2 && passes.length <= 8, `${passes.length} passes in a day`);
  for (const pass of passes) {
    assert.ok(pass.end > pass.start && pass.end - pass.start < 12 * 60000);
    assert.ok(pass.maxEl >= 5 && pass.maxEl <= 90);
    assert.ok(Math.abs(look(sat, here, pass.start).el) < 0.1);
    assert.ok(Math.abs(look(sat, here, pass.end).el) < 0.1);
    assert.ok(look(sat, here, new Date(pass.start.getTime() + 20000)).rangeRate < -1, 'approaching at the start');
    assert.ok(look(sat, here, new Date(pass.end.getTime() - 20000)).rangeRate > 1, 'receding at the end');
    assert.ok(Math.abs(look(sat, here, pass.peak).rangeRate) < 0.3, 'range rate near zero at the top');
  }
});

test('the range rate matches the change in range', () => {
  const sat = station();
  const here = { lat: 41.73, lon: -72.71 };
  const [pass] = findPasses(sat, here, new Date('2026-11-26T12:00:00Z'), 24, 5);
  const t = pass.start.getTime() + 60000;
  const before = look(sat, here, new Date(t - 500)).range;
  const after = look(sat, here, new Date(t + 500)).range;
  assert.ok(Math.abs(look(sat, here, new Date(t)).rangeRate - (after - before)) < 0.002);
});

test('Doppler: an approaching satellite is heard high and must be called low', () => {
  const approaching = -7; // km/s
  assert.ok(dopplerDown(436795000, approaching) - 436795000 > 10000);
  assert.ok(dopplerUp(145850000, approaching) - 145850000 < -3000);
  assert.equal(dopplerDown(436795000, 0), 436795000);
  // What we send, shifted by the same motion, lands on the satellite's frequency.
  assert.ok(Math.abs(dopplerDown(dopplerUp(145850000, approaching), approaching) - 145850000) < 1e-3);
});

test('the Earth turns once a sidereal day', () => {
  const a = gmst(new Date('2026-11-26T00:00:00Z'));
  const b = gmst(new Date('2026-11-27T00:00:00Z'));
  const turned = (((b - a) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  assert.ok(Math.abs(turned - (2 * Math.PI * 236.555) / 86164.09) < 1e-4); // about 3 min 56.6 s extra per day
});

test('grid squares', () => {
  assert.deepEqual(gridToLocation('FN31'), { lat: 41.5, lon: -73, exact: false });
  assert.equal(locationToGrid(41.7146, -72.7273), 'FN31pr');
  assert.equal(locationToGrid(51.5, -0.12), 'IO91wm');
  assert.equal(locationToGrid(-33.87, 151.21), 'QF56od');
  const back = gridToLocation('fn31pr');
  assert.ok(Math.abs(back.lat - 41.729) < 0.001 && Math.abs(back.lon + 72.708) < 0.001);
  assert.deepEqual(parseLocation('41.71, -72.73'), { lat: 41.71, lon: -72.73, exact: true });
  assert.deepEqual(parseLocation('41.71 N 72.73 W'), { lat: 41.71, lon: -72.73, exact: true });
  assert.equal(parseLocation('somewhere'), null);
  assert.equal(parseLocation('95, 10'), null);
});
