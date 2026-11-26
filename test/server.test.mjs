// The parts of the server that can be checked without a radio.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { toAdif } = require('../console/lib/adif.js');
const { Store } = require('../console/lib/store.js');
const { PhoneAccess } = require('../console/lib/phone.js');
const guard = require('../console/lib/guard.js');

test('ADIF export', () => {
  const text = toAdif(
    [
      { call: 'w1aw', time: '2026-11-26T15:30:00Z', freq: 146940000, mode: 'FM', rstSent: '59', rstRcvd: '57', name: 'Hiram', notes: 'first – contact' },
      { call: 'N0CALL/P', time: '2026-11-26T14:00:00Z', freq: 144200000, mode: 'USB', rstSent: '55' },
      { call: 'W1AW/4', time: '2026-11-26T16:00:00Z', freq: 436795000, txFreq: 145850000, mode: 'FM', satellite: 'SO-50' },
      { call: '', time: '2026-11-26T16:00:00Z' },
    ],
    { myCall: 'n0call', now: new Date('2026-11-26T17:00:00Z') },
  );
  const lines = text.trim().split('\n');
  assert.equal(lines[lines.indexOf('<EOH>') - 1], '<CREATED_TIMESTAMP:15>20261126 170000');
  const records = lines.slice(lines.indexOf('<EOH>') + 1);
  assert.equal(records.length, 3); // the one with no call sign is left out
  // Oldest first, with sideband split into mode and submode.
  assert.equal(records[0], '<CALL:8>N0CALL/P <QSO_DATE:8>20261126 <TIME_ON:6>140000 <BAND:2>2m <FREQ:7>144.200 <MODE:3>SSB <SUBMODE:3>USB <RST_SENT:2>55 <STATION_CALLSIGN:6>N0CALL <OPERATOR:6>N0CALL <EOR>');
  assert.match(records[1], /<CALL:4>W1AW .*<NAME:5>Hiram .*<COMMENT:15>first \? contact <EOR>$/); // plain ASCII only
  // A satellite contact: the frequency is the one transmitted on.
  assert.match(records[2], /<BAND:2>2m <FREQ:7>145\.850 <BAND_RX:4>70cm <FREQ_RX:7>436\.795 <MODE:2>FM <PROP_MODE:3>SAT <SAT_NAME:5>SO-50/);
  // Every field's stated length is its real length.
  for (const m of text.matchAll(/<([A-Z_]+):(\d+)>([^<]*)/g)) assert.equal(m[3].trimEnd().length, Number(m[2]), m[1]);
});

test('the data folder keeps values between runs', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'console-test-'));
  try {
    const store = new Store(path.join(dir, 'data'));
    assert.equal(store.read('favorites', null), null);
    store.write('favorites', [{ name: 'x', freq: 146520000 }]);
    assert.deepEqual(new Store(path.join(dir, 'data')).read('favorites'), [{ name: 'x', freq: 146520000 }]);
    assert.equal(fs.statSync(path.join(dir, 'data', 'favorites.json')).mode & 0o077, 0); // readable by its owner only
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('phone sign-in: passwords, lock-out and session cookies', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'console-test-'));
  try {
    const store = new Store(dir);
    const quiet = () => {};
    assert.match(new PhoneAccess({ store, password: 'short', log: quiet }).problem(), /at least 8/);
    const access = new PhoneAccess({ store, password: 'a-test-password', log: quiet });

    assert.equal(access.attempt('10.0.0.5', 'a-test-password').ok, true);
    for (let i = 0; i < 4; i++) assert.deepEqual(access.attempt('10.0.0.6', 'wrong'), { ok: false, wait: 0 });
    assert.equal(access.attempt('10.0.0.6', 'wrong').wait, 60); // the fifth miss starts a pause
    assert.equal(access.attempt('10.0.0.6', 'a-test-password').ok, false); // even the right one waits
    assert.equal(access.attempt('10.0.0.7', 'a-test-password').ok, true); // other devices are unaffected

    const cookie = access.sessionCookie();
    assert.match(cookie, /HttpOnly; Secure; SameSite=Strict$/);
    const header = cookie.split(';')[0];
    assert.equal(access.signedIn({ headers: { cookie: header } }), true);
    assert.equal(access.signedIn({ headers: {} }), false);
    assert.equal(access.signedIn({ headers: { cookie: header.replace(/.$/, (c) => (c === '0' ? '1' : '0')) } }), false);
    assert.equal(access.signedIn({ headers: { cookie: `console_session=${Date.now() - 1000}.${'0'.repeat(64)}` } }), false);
    // Changing the password signs everyone out.
    assert.equal(new PhoneAccess({ store, password: 'another-password', log: quiet }).signedIn({ headers: { cookie: header } }), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('requests from other sites, or by a name that is not ours, are refused', () => {
  const req = (headers) => ({ headers });
  assert.equal(guard.sameOrigin(req({ host: 'localhost:9700' })), true);
  assert.equal(guard.sameOrigin(req({ host: 'localhost:9700', origin: 'http://localhost:9700' })), true);
  assert.equal(guard.sameOrigin(req({ host: 'localhost:9700', origin: 'http://evil.example' })), false);
  assert.equal(guard.sameOrigin(req({ host: 'localhost:9700', 'sec-fetch-site': 'cross-site' })), false);
  assert.equal(guard.hostAllowed(req({ host: 'localhost:9700' }), false), true);
  assert.equal(guard.hostAllowed(req({ host: '127.0.0.1:9700' }), false), true);
  assert.equal(guard.hostAllowed(req({ host: '[::1]:9700' }), false), true);
  assert.equal(guard.hostAllowed(req({ host: 'evil.example:9700' }), false), false);
  assert.equal(guard.hostAllowed(req({ host: 'evil.example:9743' }), true), false);
  assert.equal(guard.hostAllowed(req({}), false), false);
});
