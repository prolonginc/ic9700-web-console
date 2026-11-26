#!/usr/bin/env node
// Serves the radio console on http://localhost:9700.
//
// The page needs something to talk to the radio for it. There are two choices,
// picked with BACKEND (in the environment or in radio.conf):
//
//   direct   this program logs in to the radio itself. Nothing else to install.
//   wfweb    wfweb talks to the radio and this program passes messages through.
//
// No dependencies: Node's standard library only.

'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');

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
    backend: String(get('BACKEND', 'wfweb')).toLowerCase(),
    radio: { host: get('RADIO_IP', ''), user: get('RADIO_USER', ''), pass: get('RADIO_PASS', '') },
    wfweb: { host: get('WFWEB_HOST', '127.0.0.1'), port: Number(get('WFWEB_PORT', 8080)) },
  };
}

const config = loadConfig();

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

const server = http.createServer((req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { Allow: 'GET, HEAD' }).end();
    return;
  }
  let urlPath;
  try {
    urlPath = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  } catch {
    res.writeHead(400).end('Bad request');
    return;
  }
  if (urlPath === '/') urlPath = '/index.html';

  // Resolve inside PUBLIC_DIR only.
  const filePath = path.normalize(path.join(PUBLIC_DIR, urlPath));
  if (filePath !== PUBLIC_DIR && !filePath.startsWith(PUBLIC_DIR + path.sep)) {
    res.writeHead(403).end('Forbidden');
    return;
  }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Not found');
      return;
    }
    res.writeHead(200, {
      'Content-Type': TYPES[path.extname(filePath)] || 'application/octet-stream',
      // The page is edited in place while it is being developed.
      'Cache-Control': 'no-store',
    });
    res.end(req.method === 'HEAD' ? undefined : data);
  });
});

let backend = null; // only the direct backend has anything to shut down

if (config.backend === 'direct') {
  if (!config.radio.host || !config.radio.user) {
    console.error('BACKEND=direct needs RADIO_IP, RADIO_USER and RADIO_PASS (in radio.conf or the environment).');
    process.exit(1);
  }
  const { DirectBackend } = require('./lib/direct');
  const websocket = require('./lib/websocket');
  backend = new DirectBackend(config.radio);
  server.on('upgrade', (req, socket, head) => {
    const ws = websocket.accept(req, socket, head);
    if (ws) backend.addClient(ws);
  });
} else if (config.backend === 'wfweb') {
  const { tunnelToWfweb } = require('./lib/wfweb-tunnel');
  server.on('upgrade', (req, socket, head) => tunnelToWfweb(req, socket, head, config.wfweb));
} else {
  console.error(`Unknown BACKEND "${config.backend}". Use "direct" or "wfweb".`);
  process.exit(1);
}

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`Port ${config.port} is already in use. Is the console already running?`);
  } else {
    console.error(err.message);
  }
  process.exit(1);
});

server.listen(config.port, config.bind, () => {
  console.log(`Radio console:  http://localhost:${config.port}`);
  if (backend) {
    console.log(`Connecting directly to the radio at ${config.radio.host}`);
    backend.start();
  } else {
    console.log(`Talking to wfweb at ${config.wfweb.host}:${config.wfweb.port}`);
  }
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
