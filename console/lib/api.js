'use strict';

// The small web API the page uses for things that are kept on this computer
// rather than in the radio:
//
//   GET/PUT  /api/data/favorites|repeaters|settings   one saved value each
//   GET      /api/logbook                 every contact
//   POST     /api/logbook                 add a contact
//   PUT      /api/logbook/<id>            change one
//   DELETE   /api/logbook/<id>            remove one
//   GET      /api/logbook.adi             the logbook as an ADIF file
//   GET      /api/orbits                  orbit data for amateur satellites
//
// Bodies and answers are JSON. The server only calls this for requests that
// already passed its same-site checks.

const fs = require('fs');
const crypto = require('crypto');
const { toAdif } = require('./adif');

const MAX_BODY_BYTES = 2 << 20;
const MAX_LOG_ENTRIES = 50000;

// name → what kind of value it must be
const DATA = { favorites: 'array', repeaters: 'array', settings: 'object' };

// Orbit data comes from CelesTrak (https://celestrak.org), as CSV, the format
// it asks programs to use. Its rules, which this follows: fetch no more often
// than the data changes (it checks for new data every two hours), and stop
// rather than retry when it answers with an error.
const ORBIT_URLS = [
  'https://celestrak.org/NORAD/elements/gp.php?GROUP=amateur&FORMAT=csv',
  // FM satellites that are not filed under "amateur" there:
  'https://celestrak.org/NORAD/elements/gp.php?CATNR=101101&FORMAT=csv', // SO-131
  'https://celestrak.org/NORAD/elements/gp.php?CATNR=67291&FORMAT=csv', // RS95S
];
const ORBITS_FRESH_MS = 12 * 3600 * 1000; // older than this: fetch again
const ORBITS_MIN_REFETCH_MS = 2 * 3600 * 1000; // never more often than this
const ORBITS_RETRY_AFTER_ERROR_MS = 30 * 60 * 1000;
const ORBITS_FILE = 'satellite-orbits.csv';

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function send(res, status, value, headers = {}) {
  const body = typeof value === 'string' ? value : JSON.stringify(value);
  res.writeHead(status, {
    'Content-Type': typeof value === 'string' ? 'text/plain; charset=utf-8' : 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...headers,
  });
  res.end(body);
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    if (!/^application\/json\b/i.test(String(req.headers['content-type'] || ''))) {
      reject(new HttpError(415, 'Send JSON.'));
      return;
    }
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new HttpError(413, 'That is too much data to save.'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(new HttpError(400, 'That was not valid JSON.'));
      }
    });
    req.on('error', reject);
  });
}

const text = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

function cleanLogEntry(input, id) {
  if (!input || typeof input !== 'object') throw new HttpError(400, 'A contact is needed.');
  const call = text(input.call, 20)
    .toUpperCase()
    .replace(/[^A-Z0-9/]/g, '');
  if (!call) throw new HttpError(400, 'A call sign is needed.');
  const time = new Date(input.time || Date.now());
  if (Number.isNaN(time.getTime())) throw new HttpError(400, 'That time could not be read.');
  const hz = (v) => (Number.isFinite(Number(v)) && Number(v) > 0 && Number(v) < 2e10 ? Math.round(Number(v)) : 0);
  return {
    id,
    time: time.toISOString(),
    call,
    freq: hz(input.freq),
    txFreq: hz(input.txFreq),
    mode: text(input.mode, 12).toUpperCase(),
    rstSent: text(input.rstSent, 8),
    rstRcvd: text(input.rstRcvd, 8),
    name: text(input.name, 60),
    notes: text(input.notes, 300),
    satellite: text(input.satellite, 30),
  };
}

function createApi({ store, log = console.log }) {
  let orbitFetch = null; // one download at a time
  let orbitFailedAt = 0;

  async function fetchOrbits() {
    const parts = [];
    for (const [i, url] of ORBIT_URLS.entries()) {
      const res = await fetch(url, {
        headers: { 'User-Agent': 'ic9700-web-console' },
        signal: AbortSignal.timeout(15000),
      });
      const body = res.ok ? await res.text() : '';
      const usable = body.length < MAX_BODY_BYTES && /^OBJECT_NAME,/.test(body) && body.includes('\n');
      if (i === 0) {
        if (!res.ok) throw new Error(`CelesTrak answered ${res.status}`);
        if (!usable) throw new Error('CelesTrak sent something that is not orbit data');
        parts.push(body.trim());
      } else if (usable) {
        // The extra satellites share the first file's header row.
        parts.push(body.trim().split(/\r?\n/).slice(1).join('\n'));
      } else {
        break; // one refusal is a reason to stop asking
      }
    }
    const text = `${parts.filter(Boolean).join('\n')}\n`;
    fs.writeFileSync(store.path(ORBITS_FILE), text, { mode: 0o600 });
    log(`Satellites: fetched fresh orbit data (${text.split('\n').length - 2} satellites)`);
  }

  async function orbits(wantFresh) {
    const file = store.path(ORBITS_FILE);
    const age = () => {
      try {
        return Date.now() - fs.statSync(file).mtimeMs;
      } catch {
        return Infinity;
      }
    };
    let error = '';
    const before = age();
    const due = before > ORBITS_FRESH_MS || (wantFresh && before > ORBITS_MIN_REFETCH_MS);
    if (due && Date.now() - orbitFailedAt > ORBITS_RETRY_AFTER_ERROR_MS) {
      orbitFetch = orbitFetch || fetchOrbits().finally(() => {
        orbitFetch = null;
      });
      try {
        await orbitFetch;
      } catch (err) {
        orbitFailedAt = Date.now();
        error = `Couldn’t fetch fresh orbit data: ${err.message}.`;
        log(`Satellites: ${error}`);
      }
    } else if (due) {
      error = 'Couldn’t fetch fresh orbit data a little while ago. It will be tried again later.';
    }
    const now = age();
    if (now === Infinity) return { csv: '', fetchedAt: null, error: error || 'No orbit data yet.' };
    return { csv: fs.readFileSync(file, 'utf8'), fetchedAt: new Date(Date.now() - now).toISOString(), error };
  }

  const logbook = () => store.read('logbook', []);

  async function route(req, res, url) {
    const { pathname } = url;
    const method = req.method;

    const data = pathname.match(/^\/api\/data\/([a-z]+)$/);
    if (data) {
      const name = data[1];
      if (!DATA[name]) throw new HttpError(404, 'No such thing to save.');
      if (method === 'GET') return send(res, 200, { value: store.read(name, null) });
      if (method === 'PUT') {
        const { value } = await readJson(req);
        const ok = DATA[name] === 'array' ? Array.isArray(value) : value && typeof value === 'object' && !Array.isArray(value);
        if (!ok) throw new HttpError(400, `${name} must be ${DATA[name] === 'array' ? 'a list' : 'an object'}.`);
        store.write(name, value);
        return send(res, 200, { ok: true });
      }
      throw new HttpError(405, 'Use GET or PUT.');
    }

    if (pathname === '/api/logbook') {
      if (method === 'GET') return send(res, 200, { entries: logbook() });
      if (method === 'POST') {
        const entries = logbook();
        if (entries.length >= MAX_LOG_ENTRIES) throw new HttpError(400, 'The logbook is full. Export it and start a new one.');
        const entry = cleanLogEntry(await readJson(req), crypto.randomBytes(8).toString('hex'));
        store.write('logbook', [...entries, entry]);
        return send(res, 201, { entry });
      }
      throw new HttpError(405, 'Use GET or POST.');
    }

    const one = pathname.match(/^\/api\/logbook\/([0-9a-f]{16})$/);
    if (one) {
      const entries = logbook();
      const index = entries.findIndex((e) => e.id === one[1]);
      if (index < 0) throw new HttpError(404, 'That contact is no longer in the logbook.');
      if (method === 'PUT') {
        const entry = cleanLogEntry(await readJson(req), one[1]);
        store.write('logbook', entries.map((e, i) => (i === index ? entry : e)));
        return send(res, 200, { entry });
      }
      if (method === 'DELETE') {
        store.write('logbook', entries.filter((_, i) => i !== index));
        return send(res, 200, { ok: true });
      }
      throw new HttpError(405, 'Use PUT or DELETE.');
    }

    if (pathname === '/api/logbook.adi' && method === 'GET') {
      const settings = store.read('settings', {}) || {};
      const day = new Date().toISOString().slice(0, 10);
      return send(res, 200, toAdif(logbook(), { myCall: text(settings.callsign, 20) }), {
        'Content-Disposition': `attachment; filename="logbook-${day}.adi"`,
      });
    }

    if (pathname === '/api/orbits' && method === 'GET') {
      return send(res, 200, await orbits(url.searchParams.get('refresh') === '1'));
    }

    throw new HttpError(404, 'Not found.');
  }

  // Answers the request if it is for the API. Returns false if it is not.
  return function handle(req, res, url) {
    if (!url.pathname.startsWith('/api/')) return false;
    route(req, res, url).catch((err) => {
      if (res.headersSent) return res.end();
      if (!(err instanceof HttpError)) log(`API: ${err.stack || err.message}`);
      send(res, err instanceof HttpError ? err.status : 500, { error: err instanceof HttpError ? err.message : 'Something went wrong on the console.' });
    });
    return true;
  };
}

module.exports = { createApi };
