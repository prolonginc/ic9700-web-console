'use strict';

// Access from a phone or tablet on the home network.
//
// A browser only lets a page use the microphone and play live audio when the
// page arrives over HTTPS (this computer itself is the one exception). So
// when PHONE_PASS is set, the console also listens on an HTTPS port for the
// rest of the network, and that door has a password on it, because anyone who
// gets in can key the transmitter.
//
// HTTPS needs a certificate. The console makes its own, with the `openssl`
// program: first a small certificate authority that belongs to this computer
// alone, then a certificate for this computer's name and addresses signed by
// it. A phone will warn about it once, since no public authority vouches for
// it. Installing the authority's certificate on the phone removes the warning
// for good, and it is restricted to home-network addresses so that it cannot
// be used to impersonate any other site.

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const { lanAddresses } = require('./guard');

const COOKIE = 'console_session';
const SESSION_DAYS = 30;
const CA_DAYS = 3650;
const LEAF_DAYS = 820; // Apple devices reject longer-lived server certificates
const RENEW_BEFORE_MS = 30 * 24 * 3600 * 1000;
const MIN_PASSWORD_LENGTH = 8;
const MAX_FAILS = 5;
const LOCKOUT_MS = 60 * 1000;

const PRIVATE_V4 = /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.)/;

function sha256(...parts) {
  const h = crypto.createHash('sha256');
  for (const p of parts) h.update(p);
  return h.digest();
}

function openssl(args, cwd) {
  return execFileSync('openssl', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
}

class PhoneAccess {
  constructor({ store, password, log = console.log }) {
    this.store = store;
    this.password = String(password || '');
    this.log = log;
    this.fails = new Map(); // address → { count, until }
    this.key = null; // signs session cookies; changes if the password does
  }

  // Why phone access cannot be switched on, or '' if it can.
  problem() {
    if (this.password.length < MIN_PASSWORD_LENGTH) {
      return `PHONE_PASS needs at least ${MIN_PASSWORD_LENGTH} characters.`;
    }
    try {
      openssl(['version']);
    } catch {
      return 'the openssl program, which makes the HTTPS certificate, is not installed.';
    }
    return '';
  }

  // ------------------------------------------------------- Certificates

  names() {
    const host = os.hostname().split('.')[0].toLowerCase().replace(/[^a-z0-9-]/g, '');
    const dns = ['localhost'];
    if (host) dns.unshift(`${host}.local`);
    const ips = [...lanAddresses().filter((a) => PRIVATE_V4.test(a)), '127.0.0.1'];
    return { dns, ips };
  }

  // The addresses to type on the phone: by number first, which every phone
  // understands, then by name.
  urls(port) {
    const { dns, ips } = this.names();
    return [...ips.filter((a) => a !== '127.0.0.1'), ...dns.filter((n) => n !== 'localhost')].map((h) => `https://${h}:${port}`);
  }

  files() {
    const p = (name) => this.store.path(name);
    return {
      caKey: p('phone-ca-key.pem'),
      caCert: p('phone-ca.pem'),
      key: p('phone-key.pem'),
      cert: p('phone-cert.pem'),
    };
  }

  makeAuthority(f, dir) {
    const conf = path.join(dir, 'ca.cnf');
    fs.writeFileSync(
      conf,
      [
        '[req]',
        'distinguished_name = dn',
        'prompt = no',
        'x509_extensions = v3_ca',
        '[dn]',
        `CN = Radio console on ${os.hostname().split('.')[0] || 'this computer'}`,
        '[v3_ca]',
        'basicConstraints = critical, CA:TRUE, pathlen:0',
        'keyUsage = critical, keyCertSign, cRLSign',
        'subjectKeyIdentifier = hash',
        // Only home-network names and addresses: useless for any other site.
        'nameConstraints = critical, permitted;DNS:local, permitted;DNS:localhost, ' +
          'permitted;IP:10.0.0.0/255.0.0.0, permitted;IP:172.16.0.0/255.240.0.0, ' +
          'permitted;IP:192.168.0.0/255.255.0.0, permitted;IP:169.254.0.0/255.255.0.0, ' +
          'permitted;IP:127.0.0.0/255.0.0.0',
        '',
      ].join('\n'),
    );
    openssl(
      ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-sha256', '-days', String(CA_DAYS), '-config', conf, '-keyout', f.caKey, '-out', f.caCert],
      dir,
    );
    fs.chmodSync(f.caKey, 0o600);
  }

  makeCertificate(f, dir, names) {
    const conf = path.join(dir, 'leaf.cnf');
    const csr = path.join(dir, 'leaf.csr');
    const alt = [...names.dns.map((n) => `DNS:${n}`), ...names.ips.map((a) => `IP:${a}`)].join(', ');
    fs.writeFileSync(
      conf,
      [
        '[req]',
        'distinguished_name = dn',
        'prompt = no',
        '[dn]',
        `CN = ${names.dns[0]}`,
        '[v3_leaf]',
        'basicConstraints = critical, CA:FALSE',
        'keyUsage = critical, digitalSignature, keyEncipherment',
        'extendedKeyUsage = serverAuth',
        `subjectAltName = ${alt}`,
        'authorityKeyIdentifier = keyid',
        '',
      ].join('\n'),
    );
    openssl(['req', '-new', '-newkey', 'rsa:2048', '-nodes', '-sha256', '-config', conf, '-keyout', f.key, '-out', csr], dir);
    openssl(
      [
        'x509', '-req', '-in', csr, '-CA', f.caCert, '-CAkey', f.caKey,
        '-set_serial', `0x${crypto.randomBytes(8).toString('hex')}`,
        '-sha256', '-days', String(LEAF_DAYS), '-extfile', conf, '-extensions', 'v3_leaf', '-out', f.cert,
      ],
      dir,
    );
    fs.chmodSync(f.key, 0o600);
    this.store.write('phone-cert', {
      dns: names.dns,
      ips: names.ips,
      expires: new Date(Date.now() + LEAF_DAYS * 24 * 3600 * 1000).toISOString(),
    });
  }

  // True if the certificate on disk is missing, about to expire, or does not
  // name every address this computer has now (addresses change with the
  // network it is on).
  certificateStale(f, names) {
    if (!fs.existsSync(f.key) || !fs.existsSync(f.cert)) return true;
    const made = this.store.read('phone-cert', null);
    if (!made) return true;
    if (new Date(made.expires).getTime() - Date.now() < RENEW_BEFORE_MS) return true;
    return !names.dns.every((n) => made.dns.includes(n)) || !names.ips.every((a) => made.ips.includes(a));
  }

  // { key, cert } for the HTTPS server, making whatever is missing.
  certificate() {
    const f = this.files();
    const names = this.names();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'radio-console-'));
    try {
      if (!fs.existsSync(f.caKey) || !fs.existsSync(f.caCert)) {
        this.makeAuthority(f, dir);
        this.log('Phone access: made this computer’s own certificate authority');
      }
      if (this.certificateStale(f, names)) {
        this.makeCertificate(f, dir, names);
        this.log(`Phone access: made a certificate for ${[...names.dns, ...names.ips].join(', ')}`);
      }
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
    // The authority's certificate rides along so a phone that trusts it can
    // check the chain.
    return { key: fs.readFileSync(f.key), cert: Buffer.concat([fs.readFileSync(f.cert), fs.readFileSync(f.caCert)]) };
  }

  authorityCertificate() {
    return fs.readFileSync(this.files().caCert);
  }

  // ------------------------------------------------------------ Sessions

  signingKey() {
    if (this.key) return this.key;
    let secret = this.store.read('phone-secret', null);
    if (!secret) {
      secret = crypto.randomBytes(32).toString('hex');
      this.store.write('phone-secret', secret);
    }
    this.key = sha256(secret, '\n', this.password);
    return this.key;
  }

  sign(expires) {
    return crypto.createHmac('sha256', this.signingKey()).update(String(expires)).digest('hex');
  }

  signedIn(req) {
    const found = String(req.headers.cookie || '')
      .split(';')
      .map((c) => c.trim())
      .find((c) => c.startsWith(`${COOKIE}=`));
    if (!found) return false;
    const [expires, mac] = found.slice(COOKIE.length + 1).split('.');
    if (!/^\d+$/.test(expires || '') || !/^[0-9a-f]{64}$/.test(mac || '')) return false;
    if (Number(expires) < Date.now()) return false;
    return crypto.timingSafeEqual(Buffer.from(mac, 'hex'), Buffer.from(this.sign(expires), 'hex'));
  }

  sessionCookie() {
    const expires = Date.now() + SESSION_DAYS * 24 * 3600 * 1000;
    return `${COOKIE}=${expires}.${this.sign(expires)}; Path=/; Max-Age=${SESSION_DAYS * 24 * 3600}; HttpOnly; Secure; SameSite=Strict`;
  }

  clearCookie() {
    return `${COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict`;
  }

  // Checks a password attempt from `address`.
  // Returns { ok: true }, or { ok: false, wait } with seconds until the next try is allowed.
  attempt(address, password) {
    const now = Date.now();
    const state = this.fails.get(address) || { count: 0, until: 0 };
    if (state.until > now) return { ok: false, wait: Math.ceil((state.until - now) / 1000) };

    const good = crypto.timingSafeEqual(sha256(String(password || '')), sha256(this.password));
    if (good) {
      this.fails.delete(address);
      return { ok: true };
    }
    state.count += 1;
    if (state.count >= MAX_FAILS) {
      state.count = 0;
      state.until = now + LOCKOUT_MS;
      this.log(`Phone access: ${MAX_FAILS} wrong passwords from ${address}, pausing sign-in from there for a minute`);
    }
    this.fails.set(address, state);
    // Forget old entries so the table cannot grow without limit.
    if (this.fails.size > 500) {
      for (const [key, value] of this.fails) if (value.until < now && key !== address) this.fails.delete(key);
    }
    return { ok: false, wait: state.until > now ? Math.ceil(LOCKOUT_MS / 1000) : 0 };
  }
}

module.exports = { PhoneAccess, MIN_PASSWORD_LENGTH };
