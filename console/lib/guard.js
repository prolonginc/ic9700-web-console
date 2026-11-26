'use strict';

// Checks that keep other websites away from the console.
//
// A page on some other site, open in the same browser, can make that browser
// send requests to http://localhost:9700. Two checks stop it operating the
// radio that way:
//
//   sameOrigin  the request must come from a page this server served
//   hostAllowed the address typed to reach us must be one of ours, which
//               defeats a site that points its own name at this computer

const os = require('os');

const LOOPBACK = ['localhost', '127.0.0.1', '[::1]'];

let cachedNames = null;
let cachedAt = 0;

// Every name and address this computer answers to on its networks.
function machineNames() {
  const now = Date.now();
  if (cachedNames && now - cachedAt < 10000) return cachedNames;
  const names = new Set();
  const host = os.hostname().toLowerCase();
  if (host) {
    names.add(host);
    names.add(host.endsWith('.local') ? host : `${host.split('.')[0]}.local`);
  }
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list || []) {
      if (a.internal) continue;
      names.add(a.family === 'IPv6' ? `[${a.address.toLowerCase()}]` : a.address);
    }
  }
  cachedNames = names;
  cachedAt = now;
  return names;
}

// The addresses on the local network a phone could use, IPv4 only since that
// is what people can type.
function lanAddresses() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list || []) {
      if (!a.internal && a.family === 'IPv4') out.push(a.address);
    }
  }
  return out;
}

function hostName(req) {
  const host = String(req.headers.host || '').toLowerCase();
  // Strip the port, minding IPv6 literals such as [::1]:9700.
  return host.startsWith('[') ? host.slice(0, host.indexOf(']') + 1) : host.split(':')[0];
}

// lan: whether this listener is meant to be reached from other devices.
function hostAllowed(req, lan) {
  const name = hostName(req);
  if (LOOPBACK.includes(name)) return true;
  return lan && machineNames().has(name);
}

function sameOrigin(req) {
  const site = req.headers['sec-fetch-site'];
  if (site && site !== 'same-origin' && site !== 'none') return false;
  const origin = req.headers.origin;
  if (!origin) return true; // not a browser, or a plain page load
  try {
    return new URL(origin).host === String(req.headers.host || '').toLowerCase();
  } catch {
    return false;
  }
}

function isLoopbackAddress(address) {
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1';
}

module.exports = { hostAllowed, sameOrigin, machineNames, lanAddresses, isLoopbackAddress };
