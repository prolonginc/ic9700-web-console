// When a satellite will be in the sky over one place.

import { look } from './sgp4.js';

const STEP_MS = 30000;
const LOOK_BACK_MS = 30 * 60000;

function elevation(sat, observer, ms) {
  const seen = look(sat, observer, new Date(ms));
  return seen ? seen.el : null;
}

// The moment between lo and hi (ms) when the satellite crosses the horizon.
function crossing(sat, observer, lo, hi) {
  const rising = elevation(sat, observer, hi) > 0;
  while (hi - lo > 500) {
    const mid = (lo + hi) / 2;
    if (elevation(sat, observer, mid) > 0 === rising) hi = mid;
    else lo = mid;
  }
  return hi;
}

// Passes that are under way at `from` or start within `hours` of it, whose
// highest point is at least `minElevation` degrees up.
// Each: { start, end, peak (Dates), maxEl, azStart, azPeak, azEnd (degrees),
//         sunlit (at the highest point) }
export function findPasses(sat, observer, from, hours = 24, minElevation = 5) {
  const passes = [];
  let t = from.getTime();
  const until = t + hours * 3600000;

  // Already up? Step back to before it rose, so the pass is found whole.
  const back = t - LOOK_BACK_MS;
  while (t > back && elevation(sat, observer, t) > 0) t -= STEP_MS;

  let before = elevation(sat, observer, t);
  if (before === null) return passes;
  let start = null;
  for (t += STEP_MS; t <= until + LOOK_BACK_MS; t += STEP_MS) {
    const now = elevation(sat, observer, t);
    if (now === null) break;
    if (before <= 0 && now > 0) {
      start = crossing(sat, observer, t - STEP_MS, t);
    } else if (before > 0 && now <= 0 && start !== null) {
      const end = crossing(sat, observer, t - STEP_MS, t);
      if (start <= until) {
        // The highest point, to the nearest few seconds.
        let peak = start;
        let maxEl = -90;
        for (let p = start; p <= end; p += 4000) {
          const el = elevation(sat, observer, p);
          if (el > maxEl) {
            maxEl = el;
            peak = p;
          }
        }
        if (maxEl >= minElevation) {
          const at = (ms) => look(sat, observer, new Date(ms));
          const top = at(peak);
          passes.push({
            start: new Date(start),
            end: new Date(end),
            peak: new Date(peak),
            maxEl,
            azStart: at(start + 1000).az,
            azPeak: top.az,
            azEnd: at(end - 1000).az,
            sunlit: top.sunlit,
          });
        }
      }
      start = null;
      if (t > until) break;
    }
    before = now;
  }
  return passes;
}

// ------------------------------------------------------------ Locations

// A Maidenhead grid square ("FN31" or "FN31pr") → the middle of it.
export function gridToLocation(text) {
  const g = String(text).trim().toUpperCase();
  if (!/^[A-R]{2}\d{2}([A-X]{2})?$/.test(g)) return null;
  let lon = (g.charCodeAt(0) - 65) * 20 - 180 + Number(g[2]) * 2;
  let lat = (g.charCodeAt(1) - 65) * 10 - 90 + Number(g[3]);
  if (g.length === 6) {
    lon += ((g.charCodeAt(4) - 65) * 2) / 24 + 1 / 24;
    lat += (g.charCodeAt(5) - 65) / 24 + 1 / 48;
  } else {
    lon += 1;
    lat += 0.5;
  }
  return { lat, lon, exact: g.length === 6 };
}

export function locationToGrid(lat, lon) {
  const x = lon + 180;
  const y = lat + 90;
  const A = 65;
  return (
    String.fromCharCode(A + Math.floor(x / 20), A + Math.floor(y / 10)) +
    Math.floor((x % 20) / 2) +
    Math.floor(y % 10) +
    String.fromCharCode(A + 32 + Math.floor(((x % 2) * 24) / 2), A + 32 + Math.floor((y % 1) * 24))
  );
}

// "41.71, -72.73", "41.71 N 72.73 W", or a grid square.
export function parseLocation(text) {
  const grid = gridToLocation(text);
  if (grid) return grid;
  const m = String(text)
    .trim()
    .match(/^(-?\d+(?:\.\d+)?)\s*°?\s*([NS])?[\s,;]+(-?\d+(?:\.\d+)?)\s*°?\s*([EW])?$/i);
  if (!m) return null;
  let lat = Number(m[1]);
  let lon = Number(m[3]);
  if (m[2] && m[2].toUpperCase() === 'S') lat = -Math.abs(lat);
  if (m[4] && m[4].toUpperCase() === 'W') lon = -Math.abs(lon);
  if (!(lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180)) return null;
  return { lat, lon, exact: true };
}
