#!/usr/bin/env node
// Serves the radio console on http://localhost:9700.
//
// The page needs something to talk to the radio for it. There are two choices,
// picked with BACKEND (in the environment or in radio.conf):
//
//   direct   this program logs in to the radio itself. Nothing else to install.
//            This is the default.
//   wfweb    wfweb talks to the radio and this program passes messages through.
//
// With PHONE_PASS set, it also serves phones and tablets on the home network
// over HTTPS, behind that password (see lib/phone.js).
//
// No dependencies: Node's standard library only.

'use strict';

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { Store } = require('./lib/store');
const { createApi } = require('./lib/api');
const { PhoneAccess } = require('./lib/phone');
const guard = require('./lib/guard');

const PUBLIC_DIR = path.join(__dirname, 'public');

// Settings come from the environment, then from radio.conf next to this
// folder (KEY=value lines, as a shell would read them).
function loadConfig() {
  const fromFile = {};
  const file = process.env.RADIO_CONF || path.join(__dirname, '..', 'radio.conf');
  try {
    for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
      if (!m) continue;
      let value = m[2];
      const quoted = value.match(/^(['"])(.*)\1$/);
      if (quoted) value = quoted[2];
      fromFile[m[1]] = value;
    }
  } catch {
    /* no file: the environment has to supply everything */
  }
  const get = (key, fallback) => process.env[key] || fromFile[key] || fallback;
  return {
    port: Number(get('PORT', 9700)),
    bind: get('BIND', '127.0.0.1'),
    backend: String(get('BACKEND', 'direct')).toLowerCase(),
    radio: { host: get('RADIO_IP', ''), user: get('RADIO_USER', ''), pass: get('RADIO_PASS', '') },
    wfweb: { host: get('WFWEB_HOST', '127.0.0.1'), port: Number(get('WFWEB_PORT', 8080)) },
    dataDir: get('DATA_DIR', path.join(__dirname, '..', 'data')),
    phonePass: get('PHONE_PASS', ''),
    phonePort: Number(get('PHONE_PORT', 9743)),
  };
}

const config = loadConfig();
const store = new Store(config.dataDir);
const api = createApi({ store });

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

function plain(res, status, text, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
  res.end(`${text}\n`);
}

function json(res, status, value, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
  res.end(JSON.stringify(value));
}

function serveFile(req, res, urlPath) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { Allow: 'GET, HEAD' }).end();
    return;
  }
  // Resolve inside PUBLIC_DIR only.
  const filePath = path.normalize(path.join(PUBLIC_DIR, urlPath === '/' ? '/index.html' : urlPath));
  if (filePath !== PUBLIC_DIR && !filePath.startsWith(PUBLIC_DIR + path.sep)) {
    plain(res, 403, 'Forbidden');
    return;
  }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      plain(res, 404, 'Not found');
      return;
    }
    res.writeHead(200, {
      'Content-Type': TYPES[path.extname(filePath)] || 'application/octet-stream',
      // The page is edited in place while it is being developed.
      'Cache-Control': 'no-store',
    });
    res.end(req.method === 'HEAD' ? undefined : data);
  });
}

function readSmallJson(req) {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 4096) req.destroy();
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(body));
      } catch {
        resolve(null);
      }
    });
    req.on('error', () => resolve(null));
  });
}

// ------------------------------------------------------------ Phone access

let phone = null; // set when PHONE_PASS is usable
let phoneUrls = [];

// The sign-in door on the network listener. Returns true if it answered.
function phoneDoor(req, res, url) {
  const { pathname } = url;
  if (pathname === '/login.html' || pathname === '/login') {
    serveFile(req, res, '/login.html');
    return true;
  }
  if (pathname === '/console-certificate.crt' && req.method === 'GET') {
    res.writeHead(200, {
      'Content-Type': 'application/x-x509-ca-cert',
      'Content-Disposition': 'attachment; filename="radio-console.crt"',
      'Cache-Control': 'no-store',
    });
    res.end(phone.authorityCertificate());
    return true;
  }
  if (pathname === '/api/login' && req.method === 'POST') {
    if (!guard.sameOrigin(req)) {
      json(res, 403, { error: 'Sign in from the console’s own page.' });
      return true;
    }
    readSmallJson(req).then((body) => {
      const result = phone.attempt(req.socket.remoteAddress, body && body.password);
      if (result.ok) json(res, 200, { ok: true }, { 'Set-Cookie': phone.sessionCookie() });
      else if (result.wait) json(res, 429, { error: `Too many wrong passwords. Try again in ${result.wait} seconds.`, wait: result.wait });
      else json(res, 401, { error: 'That password isn’t right.' });
    });
    return true;
  }
  if (pathname === '/api/logout' && req.method === 'POST') {
    json(res, 200, { ok: true }, { 'Set-Cookie': phone.clearCookie() });
    return true;
  }
  if (phone.signedIn(req)) return false;

  // Not signed in: pages go to the sign-in form, everything else is refused.
  if (req.method === 'GET' && !pathname.startsWith('/api/') && String(req.headers.accept || '').includes('text/html')) {
    res.writeHead(302, { Location: '/login.html', 'Cache-Control': 'no-store' }).end();
  } else {
    json(res, 401, { error: 'Sign in first.' });
  }
  return true;
}

// ---------------------------------------------------------------- Requests

// remote: true for the HTTPS listener that other devices use.
function makeHandler({ remote }) {
  const lan = remote || !guard.isLoopbackAddress(config.bind);
  return (req, res) => {
    if (!guard.hostAllowed(req, lan)) {
      plain(res, 403, 'Forbidden: this console was reached by a name it does not know.');
      return;
    }
    let url; // just the two parts used: { pathname, searchParams }
    try {
      const parsed = new URL(req.url, 'http://localhost');
      url = { pathname: decodeURIComponent(parsed.pathname), searchParams: parsed.searchParams };
    } catch {
      plain(res, 400, 'Bad request');
      return;
    }
    if (remote && phoneDoor(req, res, url)) return;

    if (url.pathname.startsWith('/api/')) {
      if (!guard.sameOrigin(req)) {
        json(res, 403, { error: 'Forbidden: request from another site.' });
        return;
      }
      if (url.pathname === '/api/whoami' && req.method === 'GET') {
        // How this page was reached, and how a phone could reach it.
        json(res, 200, {
          remote,
          direct: config.backend === 'direct',
          phone: { enabled: !!phone, urls: remote ? [] : phoneUrls },
        });
        return;
      }
      api(req, res, url);
      return;
    }
    if (url.pathname === '/login.html' && !remote) {
      res.writeHead(302, { Location: '/' }).end(); // nothing to sign in to on this computer
      return;
    }
    serveFile(req, res, url.pathname);
  };
}

let backend = null; // only the direct backend has anything to shut down
let connectPage; // (req, socket, head) → hands a page's WebSocket to the backend

if (config.backend === 'direct') {
  if (!config.radio.host || !config.radio.user) {
    console.error('BACKEND=direct needs RADIO_IP, RADIO_USER and RADIO_PASS (in radio.conf or the environment).');
    process.exit(1);
  }
  const { DirectBackend } = require('./lib/direct');
  const websocket = require('./lib/websocket');
  backend = new DirectBackend(config.radio);
  connectPage = (req, socket, head) => {
    const ws = websocket.accept(req, socket, head);
    if (ws) backend.addClient(ws);
  };
} else if (config.backend === 'wfweb') {
  const { tunnelToWfweb } = require('./lib/wfweb-tunnel');
  connectPage = (req, socket, head) => tunnelToWfweb(req, socket, head, config.wfweb);
} else {
  console.error(`Unknown BACKEND "${config.backend}". Use "direct" or "wfweb".`);
  process.exit(1);
}

function refuseUpgrade(socket, status, text) {
  socket.end(`HTTP/1.1 ${status}\r\nContent-Type: text/plain\r\nConnection: close\r\n\r\n${text}\n`);
}

function makeUpgrade({ remote }) {
  const lan = remote || !guard.isLoopbackAddress(config.bind);
  return (req, socket, head) => {
    if (!guard.hostAllowed(req, lan) || !guard.sameOrigin(req)) {
      refuseUpgrade(socket, '403 Forbidden', 'Forbidden: cross-site WebSocket');
      return;
    }
    if (remote && !phone.signedIn(req)) {
      refuseUpgrade(socket, '401 Unauthorized', 'Sign in first');
      return;
    }
    connectPage(req, socket, head);
  };
}

function exitOnListenError(what, port) {
  return (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`Port ${port} is already in use. Is the console already running?`);
    } else {
      console.error(`${what}: ${err.message}`);
    }
    process.exit(1);
  };
}

const server = http.createServer(makeHandler({ remote: false }));
server.on('upgrade', makeUpgrade({ remote: false }));
server.on('error', exitOnListenError('Console', config.port));

let phoneServer = null;

function startPhoneAccess() {
  if (!config.phonePass) return;
  const access = new PhoneAccess({ store, password: config.phonePass });
  const problem = access.problem();
  if (problem) {
    console.error(`Phone access is off: ${problem}`);
    return;
  }
  let secure;
  try {
    secure = access.certificate();
  } catch (err) {
    console.error(`Phone access is off: could not make the HTTPS certificate (${String(err.stderr || err.message).trim().split('\n').pop()})`);
    return;
  }
  phone = access;
  phoneServer = https.createServer(secure, makeHandler({ remote: true }));
  phoneServer.on('upgrade', makeUpgrade({ remote: true }));
  phoneServer.on('error', (err) => {
    console.error(`Phone access is off: ${err.code === 'EADDRINUSE' ? `port ${config.phonePort} is already in use` : err.message}`);
    phone = null;
    phoneUrls = [];
  });
  phoneServer.listen(config.phonePort, '0.0.0.0', () => {
    phoneUrls = access.urls(config.phonePort);
    console.log(`Phone or tablet: ${phoneUrls.join('  or  ') || `https://<this computer's address>:${config.phonePort}`}  (password required)`);
  });
  // This computer's address can change with the network it is on; keep the
  // certificate and the advertised addresses in step.
  setInterval(() => {
    try {
      const names = access.names();
      if (access.certificateStale(access.files(), names)) phoneServer.setSecureContext(access.certificate());
      phoneUrls = access.urls(config.phonePort);
    } catch (err) {
      console.error(`Phone access: could not refresh the certificate (${err.message})`);
    }
  }, 5 * 60 * 1000).unref();
}

server.listen(config.port, config.bind, () => {
  console.log(`Radio console:  http://localhost:${config.port}`);
  if (backend) {
    console.log(`Connecting directly to the radio at ${config.radio.host}`);
    backend.start();
  } else {
    console.log(`Talking to wfweb at ${config.wfweb.host}:${config.wfweb.port}`);
  }
  startPhoneAccess();
});

// Leave the radio tidily: unkey the transmitter and log out before exiting.
let leaving = false;
async function leave(code) {
  if (leaving) return;
  leaving = true;
  if (backend) {
    try {
      await backend.stop();
    } catch {
      /* exiting anyway */
    }
  }
  process.exit(code);
}

process.on('SIGINT', () => leave(130));
process.on('SIGTERM', () => leave(143));
process.on('uncaughtException', (err) => {
  console.error(err);
  leave(1);
});
