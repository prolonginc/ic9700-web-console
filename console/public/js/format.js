// How numbers are written on the page, and how typed ones are read.

export function splitFrequency(hz) {
  const f = Math.round(hz);
  const mhz = Math.floor(f / 1e6);
  const khz = String(Math.floor((f % 1e6) / 1e3)).padStart(3, '0');
  const fine = String(f % 1e3).padStart(3, '0');
  return { main: `${mhz}.${khz}`, fine };
}

export function formatMHz(hz, decimals = 3) {
  // Show more places only when the frequency needs them.
  const exact = hz / 1e6;
  let d = decimals;
  while (d < 6 && Math.abs(exact * 10 ** d - Math.round(exact * 10 ** d)) > 1e-6) d++;
  return exact.toFixed(d);
}

export function formatDistance(hz) {
  return hz >= 1e6 ? `${hz / 1e6} MHz` : `${hz / 1e3} kHz`;
}

export function formatTone(tenths) {
  return `${(tenths / 10).toFixed(1)} Hz`;
}

// "146.52", "146,520", "147.920.000", "146520" (kHz) or "146520000" (Hz).
// Returns hertz, or NaN.
export function parseFrequency(text) {
  let t = String(text).trim().toLowerCase().replace(/mhz$/, '').replace(/,/g, '.').replace(/\s+/g, '');
  if (!/^\d[\d.]*$/.test(t)) return NaN;
  const dot = t.indexOf('.');
  if (dot >= 0) {
    // "147.920.000" is a common way to write it: keep the first dot only.
    t = t.slice(0, dot + 1) + t.slice(dot + 1).replace(/\./g, '');
    return Math.round(parseFloat(t) * 1e6);
  }
  const v = Number(t);
  if (v >= 1e7) return Math.round(v); // hertz
  if (v >= 1e4) return Math.round(v * 1e3); // kilohertz
  return Math.round(v * 1e6);
}

// "in 12 min", "in 2 h 5 min", "now".
export function formatWait(ms) {
  if (ms <= 0) return 'now';
  const minutes = Math.round(ms / 60000);
  if (minutes < 1) return 'in under a minute';
  if (minutes < 60) return `in ${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `in ${h} h ${m} min` : `in ${h} h`;
}

// "6 min 20 s", "45 s".
export function formatDuration(ms) {
  const total = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  if (!m) return `${s} s`;
  return s ? `${m} min ${s} s` : `${m} min`;
}

const COMPASS = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];
const COMPASS_SHORT = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];

export function compass(degrees, short = false) {
  const i = Math.round((((degrees % 360) + 360) % 360) / 45) % 8;
  return (short ? COMPASS_SHORT : COMPASS)[i];
}
