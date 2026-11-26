// The cheat sheets' contents: nothing missing, nothing doubled, and the
// license chart consistent with itself.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Q_CODES, SHORTHAND, VOICE_WORDS, PHONETICS, spellOut, PRIVILEGES, LICENSES, modeLimitAt, READABILITY, STRENGTH } from '../console/public/js/reference.js';

test('every term has a meaning, and none is listed twice', () => {
  for (const [name, list] of [['Q codes', Q_CODES], ['shorthand', SHORTHAND], ['on-air words', VOICE_WORDS]]) {
    const seen = new Set();
    for (const [term, meaning, more] of list) {
      assert.ok(term && meaning, `${name}: ${term || '(blank)'} needs a meaning`);
      assert.equal(typeof more, 'string', `${name}: ${term}`);
      assert.ok(!seen.has(term), `${name}: ${term} is listed twice`);
      seen.add(term);
    }
  }
  assert.ok(Q_CODES.every(([code]) => /^Q[A-Z]{2}$/.test(code)));
  assert.equal(Q_CODES.find(([code]) => code === 'QSY')[1], 'Change frequency');
});

test('the phonetic alphabet is complete, and spells things out', () => {
  for (const c of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789') assert.ok(PHONETICS[c], c);
  assert.equal(spellOut('n0call/p'), 'November Zero Charlie Alfa Lima Lima Stroke Papa');
  assert.equal(spellOut('W1AW'), 'Whiskey One Alfa Whiskey');
  assert.equal(spellOut('  '), '');
});

test('signal report scales run 1 to 5 and 1 to 9', () => {
  assert.deepEqual(READABILITY.map(([n]) => n), ['1', '2', '3', '4', '5']);
  assert.deepEqual(STRENGTH.map(([n]) => n), ['1', '2', '3', '4', '5', '6', '7', '8', '9']);
});

test('the license chart is consistent', () => {
  assert.deepEqual(LICENSES.map((l) => l.id), ['technician', 'general', 'extra']);
  let lastStart = 0;
  for (const band of PRIVILEGES) {
    let previousEnd = null;
    for (const [range, what, technician, general, extra] of band.rows) {
      const [from, to] = range.split('–').map(Number);
      assert.ok(from < to, `${band.band} ${range}`);
      if (previousEnd !== null) assert.equal(from, previousEnd, `${band.band}: ${range} should start where the last stretch ended`);
      previousEnd = to;
      assert.ok(what, `${band.band} ${range}`);
      // A higher class can do everything a lower one can.
      assert.equal(extra, true, `${band.band} ${range}: Extra has everything`);
      if (general === false) assert.equal(technician, false, `${band.band} ${range}`);
      if (technician !== false) assert.equal(general, true, `${band.band} ${range}`);
    }
    const start = Number(band.rows[0][0].split('–')[0]);
    assert.ok(start > lastStart, `${band.band} is out of order`);
    lastStart = start;
  }
  // The three bands of the IC-9700 are open to every class, end to end.
  const mine = PRIVILEGES.filter((b) => b.thisRadio);
  assert.deepEqual(mine.map((b) => b.band), ['2 m', '70 cm', '23 cm']);
  for (const band of mine) for (const row of band.rows) assert.deepEqual(row.slice(2), [true, true, true]);
});

test('the Morse-only stretch of 2 meters', () => {
  assert.ok(modeLimitAt(144050000, 'FM'));
  assert.ok(modeLimitAt(144000000, 'USB'));
  assert.equal(modeLimitAt(144050000, 'CW'), null);
  assert.equal(modeLimitAt(144100000, 'FM'), null);
  assert.equal(modeLimitAt(146520000, 'FM'), null);
});

test('which side of Line A a place is on', async () => {
  const { sideOfLineA } = await import('../console/public/js/reference.js');
  // Along the stretches defined by a parallel or a meridian the answer is exact.
  assert.equal(sideOfLineA(42.73, -84.55), 'north'); // Lansing
  assert.equal(sideOfLineA(41.66, -83.55), 'north'); // Toledo
  assert.equal(sideOfLineA(39.96, -83), 'south'); // Columbus
  assert.equal(sideOfLineA(48.75, -110), 'north'); // northern Montana
  assert.equal(sideOfLineA(46.6, -112), 'south'); // Helena
  assert.equal(sideOfLineA(41.05, -83.6), 'near'); // a few kilometres from the 41st parallel
  assert.equal(sideOfLineA(42.3, -85.1), 'near'); // beside the 85th meridian
  // Along the great-circle stretches.
  assert.equal(sideOfLineA(48.75, -122.48), 'north'); // Bellingham
  assert.equal(sideOfLineA(45.52, -122.68), 'south'); // Portland, Oregon
  assert.equal(sideOfLineA(44.98, -93.27), 'south'); // Minneapolis
  assert.equal(sideOfLineA(47.9, -91.8), 'north'); // far northern Minnesota
  assert.equal(sideOfLineA(42.89, -78.88), 'north'); // Buffalo
  assert.equal(sideOfLineA(42.36, -71.06), 'south'); // Boston
  assert.equal(sideOfLineA(40.71, -74.01), 'south'); // New York
  assert.equal(sideOfLineA(46.7, -92.2), 'near'); // Duluth itself
  // Places the line has nothing to say about.
  assert.equal(sideOfLineA(61.2, -149.9), 'south'); // Alaska
  assert.equal(sideOfLineA(51.5, -0.1), 'south'); // London
  assert.equal(sideOfLineA(25.8, -80.2), 'south'); // Miami
});
