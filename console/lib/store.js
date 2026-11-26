'use strict';

// What the console remembers between runs: favorites, the repeater list, the
// logbook and a few settings. Each is one small JSON file in the data folder
// next to radio.conf, so every device that opens the page sees the same thing.

const fs = require('fs');
const path = require('path');

class Store {
  constructor(dir) {
    this.dir = dir;
    this.cache = new Map();
  }

  file(name) {
    return path.join(this.dir, `${name}.json`);
  }

  // The stored value, or `fallback` when nothing has been saved yet.
  read(name, fallback = null) {
    if (this.cache.has(name)) return this.cache.get(name);
    let value = fallback;
    try {
      value = JSON.parse(fs.readFileSync(this.file(name), 'utf8'));
    } catch (err) {
      if (err.code !== 'ENOENT') console.error(`Could not read ${this.file(name)}: ${err.message}`);
    }
    this.cache.set(name, value);
    return value;
  }

  // Written to a temporary file first, so a crash never leaves half a file.
  write(name, value) {
    fs.mkdirSync(this.dir, { recursive: true, mode: 0o700 });
    const file = this.file(name);
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(value, null, 1), { mode: 0o600 });
    fs.renameSync(tmp, file);
    this.cache.set(name, value);
  }

  // Plain files that are not JSON (certificates, cached orbit data).
  path(fileName) {
    fs.mkdirSync(this.dir, { recursive: true, mode: 0o700 });
    return path.join(this.dir, fileName);
  }
}

module.exports = { Store };
