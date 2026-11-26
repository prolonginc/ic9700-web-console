// Where a satellite is, from its published orbit data.
//
// This is SGP4, the standard model that orbit data ("two-line elements", or
// the same numbers in CelesTrak's CSV) is meant to be used with. It follows
// Vallado, Crawford, Hujsak and Kelso, "Revisiting Spacetrack Report #3"
// (2006), for satellites that circle the Earth in under 225 minutes, which
// covers every low-orbit amateur satellite. Higher orbits need the model's
// deep-space half, which is left out.
//
// Positions come out in kilometres in the model's own frame (TEME), which
// `look` turns into what matters on the ground: direction, height above the
// horizon, distance, and how fast the distance is changing.

const TWO_PI = 2 * Math.PI;
const DEG = Math.PI / 180;

// WGS-72 constants, the ones the orbit data was fitted with.
const MU = 398600.8; // km³/s²
const EARTH_RADIUS = 6378.135; // km
const XKE = 60 / Math.sqrt((EARTH_RADIUS * EARTH_RADIUS * EARTH_RADIUS) / MU);
const J2 = 0.001082616;
const J3 = -0.00000253881;
const J4 = -0.00000165597;
const J3OJ2 = J3 / J2;
const X2O3 = 2 / 3;
const KM_PER_SEC = (EARTH_RADIUS * XKE) / 60;

// WGS-84 for the observer on the ground.
const WGS84_A = 6378.137;
const WGS84_F = 1 / 298.257223563;
const EARTH_ROTATION = 7.292115e-5; // rad/s
const LIGHT_SPEED = 299792.458; // km/s

const mod2pi = (x) => {
  const r = x % TWO_PI;
  return r < 0 ? r + TWO_PI : r;
};

// elements: { name, id, epoch: Date, meanMotion (revolutions a day),
//   eccentricity, inclination, raan, argPerigee, meanAnomaly (degrees), bstar }
// Returns the satellite ready to propagate, or null if it cannot be
// (missing numbers, or an orbit too high for this half of the model).
export function createSatellite(elements) {
  const e = elements;
  const numbers = [e.meanMotion, e.eccentricity, e.inclination, e.raan, e.argPerigee, e.meanAnomaly, e.bstar];
  if (!numbers.every(Number.isFinite) || !(e.epoch instanceof Date) || Number.isNaN(e.epoch.getTime())) return null;
  if (e.meanMotion <= 0 || e.eccentricity < 0 || e.eccentricity >= 1) return null;
  if (1440 / e.meanMotion >= 225) return null; // deep space

  const s = {
    name: e.name,
    id: e.id,
    epoch: e.epoch,
    bstar: e.bstar,
    ecco: e.eccentricity,
    argpo: e.argPerigee * DEG,
    inclo: e.inclination * DEG,
    mo: e.meanAnomaly * DEG,
    nodeo: e.raan * DEG,
  };
  const noKozai = (e.meanMotion * TWO_PI) / 1440; // radians a minute

  // The published mean motion uses an older convention; convert it.
  const eccsq = s.ecco * s.ecco;
  const omeosq = 1 - eccsq;
  const rteosq = Math.sqrt(omeosq);
  const cosio = Math.cos(s.inclo);
  const cosio2 = cosio * cosio;
  const ak = (XKE / noKozai) ** X2O3;
  const d1 = (0.75 * J2 * (3 * cosio2 - 1)) / (rteosq * omeosq);
  let del = d1 / (ak * ak);
  const adel = ak * (1 - del * del - del * (1 / 3 + (134 * del * del) / 81));
  del = d1 / (adel * adel);
  s.no = noKozai / (1 + del);

  const ao = (XKE / s.no) ** X2O3;
  const sinio = Math.sin(s.inclo);
  const po = ao * omeosq;
  const con42 = 1 - 5 * cosio2;
  s.con41 = -con42 - cosio2 - cosio2;
  const posq = po * po;
  const rp = ao * (1 - s.ecco);
  if (rp < 1) return null; // the orbit dips below the ground: decayed

  // Drag terms depend on how low the orbit comes.
  s.isimp = rp < 220 / EARTH_RADIUS + 1;
  let sfour = 78 / EARTH_RADIUS + 1;
  let qzms24 = ((120 - 78) / EARTH_RADIUS) ** 4;
  const perige = (rp - 1) * EARTH_RADIUS;
  if (perige < 156) {
    sfour = perige - 78;
    if (perige < 98) sfour = 20;
    qzms24 = ((120 - sfour) / EARTH_RADIUS) ** 4;
    sfour = sfour / EARTH_RADIUS + 1;
  }
  const pinvsq = 1 / posq;
  const tsi = 1 / (ao - sfour);
  s.eta = ao * s.ecco * tsi;
  const etasq = s.eta * s.eta;
  const eeta = s.ecco * s.eta;
  const psisq = Math.abs(1 - etasq);
  const coef = qzms24 * tsi ** 4;
  const coef1 = coef / psisq ** 3.5;
  const cc2 = coef1 * s.no * (ao * (1 + 1.5 * etasq + eeta * (4 + etasq)) + ((0.375 * J2 * tsi) / psisq) * s.con41 * (8 + 3 * etasq * (8 + etasq)));
  s.cc1 = s.bstar * cc2;
  let cc3 = 0;
  if (s.ecco > 1e-4) cc3 = (-2 * coef * tsi * J3OJ2 * s.no * sinio) / s.ecco;
  s.x1mth2 = 1 - cosio2;
  s.cc4 =
    2 *
    s.no *
    coef1 *
    ao *
    omeosq *
    (s.eta * (2 + 0.5 * etasq) +
      s.ecco * (0.5 + 2 * etasq) -
      ((J2 * tsi) / (ao * psisq)) * (-3 * s.con41 * (1 - 2 * eeta + etasq * (1.5 - 0.5 * eeta)) + 0.75 * s.x1mth2 * (2 * etasq - eeta * (1 + etasq)) * Math.cos(2 * s.argpo)));
  s.cc5 = 2 * coef1 * ao * omeosq * (1 + 2.75 * (etasq + eeta) + eeta * etasq);
  const cosio4 = cosio2 * cosio2;
  const temp1 = 1.5 * J2 * pinvsq * s.no;
  const temp2 = 0.5 * temp1 * J2 * pinvsq;
  const temp3 = -0.46875 * J4 * pinvsq * pinvsq * s.no;
  s.mdot = s.no + 0.5 * temp1 * rteosq * s.con41 + 0.0625 * temp2 * rteosq * (13 - 78 * cosio2 + 137 * cosio4);
  s.argpdot = -0.5 * temp1 * con42 + 0.0625 * temp2 * (7 - 114 * cosio2 + 395 * cosio4) + temp3 * (3 - 36 * cosio2 + 49 * cosio4);
  const xhdot1 = -temp1 * cosio;
  s.nodedot = xhdot1 + (0.5 * temp2 * (4 - 19 * cosio2) + 2 * temp3 * (3 - 7 * cosio2)) * cosio;
  s.omgcof = s.bstar * cc3 * Math.cos(s.argpo);
  s.xmcof = 0;
  if (s.ecco > 1e-4) s.xmcof = (-X2O3 * coef * s.bstar) / eeta;
  s.nodecf = 3.5 * omeosq * xhdot1 * s.cc1;
  s.t2cof = 1.5 * s.cc1;
  // Guard against dividing by zero for an orbit inclined at exactly 180°.
  const onePlusCos = Math.abs(cosio + 1) > 1.5e-12 ? 1 + cosio : 1.5e-12;
  s.xlcof = (-0.25 * J3OJ2 * sinio * (3 + 5 * cosio)) / onePlusCos;
  s.aycof = -0.5 * J3OJ2 * sinio;
  s.delmo = (1 + s.eta * Math.cos(s.mo)) ** 3;
  s.sinmao = Math.sin(s.mo);
  s.x7thm1 = 7 * cosio2 - 1;

  if (!s.isimp) {
    const cc1sq = s.cc1 * s.cc1;
    s.d2 = 4 * ao * tsi * cc1sq;
    const temp = (s.d2 * tsi * s.cc1) / 3;
    s.d3 = (17 * ao + sfour) * temp;
    s.d4 = 0.5 * temp * ao * tsi * (221 * ao + 31 * sfour) * s.cc1;
    s.t3cof = s.d2 + 2 * cc1sq;
    s.t4cof = 0.25 * (3 * s.d3 + s.cc1 * (12 * s.d2 + 10 * cc1sq));
    s.t5cof = 0.2 * (3 * s.d4 + 12 * s.cc1 * s.d3 + 6 * s.d2 * s.d2 + 15 * cc1sq * (2 * s.d2 + cc1sq));
  }
  return s;
}

// Position and velocity `minutes` after the orbit data's own date.
// Returns { r: [x, y, z] km, v: [x, y, z] km/s }, or null if the model breaks
// down (the data is too old, or the satellite has come down).
export function propagateMinutes(s, minutes) {
  const t = minutes;
  const xmdf = s.mo + s.mdot * t;
  const argpdf = s.argpo + s.argpdot * t;
  const nodedf = s.nodeo + s.nodedot * t;
  let argpm = argpdf;
  let mm = xmdf;
  const t2 = t * t;
  let nodem = nodedf + s.nodecf * t2;
  let tempa = 1 - s.cc1 * t;
  let tempe = s.bstar * s.cc4 * t;
  let templ = s.t2cof * t2;

  if (!s.isimp) {
    const delomg = s.omgcof * t;
    const delmtemp = 1 + s.eta * Math.cos(xmdf);
    const delm = s.xmcof * (delmtemp * delmtemp * delmtemp - s.delmo);
    const temp = delomg + delm;
    mm = xmdf + temp;
    argpm = argpdf - temp;
    const t3 = t2 * t;
    const t4 = t3 * t;
    tempa = tempa - s.d2 * t2 - s.d3 * t3 - s.d4 * t4;
    tempe += s.bstar * s.cc5 * (Math.sin(mm) - s.sinmao);
    templ = templ + s.t3cof * t3 + t4 * (s.t4cof + t * s.t5cof);
  }

  let nm = s.no;
  let em = s.ecco;
  const am = (XKE / nm) ** X2O3 * tempa * tempa;
  nm = XKE / am ** 1.5;
  em -= tempe;
  if (em >= 1 || em < -0.001 || am < 0.95) return null;
  if (em < 1e-6) em = 1e-6;
  mm += s.no * templ;
  let xlm = mm + argpm + nodem;
  nodem = mod2pi(nodem);
  argpm = mod2pi(argpm);
  xlm = mod2pi(xlm);
  mm = mod2pi(xlm - argpm - nodem);

  const sinip = Math.sin(s.inclo);
  const cosip = Math.cos(s.inclo);

  // Long-period terms.
  const axnl = em * Math.cos(argpm);
  let temp = 1 / (am * (1 - em * em));
  const aynl = em * Math.sin(argpm) + temp * s.aycof;
  const xl = mm + argpm + nodem + temp * s.xlcof * axnl;

  // Kepler's equation.
  const u = mod2pi(xl - nodem);
  let eo1 = u;
  let tem5 = 9999.9;
  let sineo1 = 0;
  let coseo1 = 0;
  for (let k = 0; k < 10 && Math.abs(tem5) >= 1e-12; k++) {
    sineo1 = Math.sin(eo1);
    coseo1 = Math.cos(eo1);
    tem5 = 1 - coseo1 * axnl - sineo1 * aynl;
    tem5 = (u - aynl * coseo1 + axnl * sineo1 - eo1) / tem5;
    if (Math.abs(tem5) >= 0.95) tem5 = tem5 > 0 ? 0.95 : -0.95;
    eo1 += tem5;
  }

  // Short-period terms.
  const ecose = axnl * coseo1 + aynl * sineo1;
  const esine = axnl * sineo1 - aynl * coseo1;
  const el2 = axnl * axnl + aynl * aynl;
  const pl = am * (1 - el2);
  if (pl < 0) return null;
  const rl = am * (1 - ecose);
  const rdotl = (Math.sqrt(am) * esine) / rl;
  const rvdotl = Math.sqrt(pl) / rl;
  const betal = Math.sqrt(1 - el2);
  temp = esine / (1 + betal);
  const sinu = (am / rl) * (sineo1 - aynl - axnl * temp);
  const cosu = (am / rl) * (coseo1 - axnl + aynl * temp);
  let su = Math.atan2(sinu, cosu);
  const sin2u = (cosu + cosu) * sinu;
  const cos2u = 1 - 2 * sinu * sinu;
  temp = 1 / pl;
  const temp1 = 0.5 * J2 * temp;
  const temp2 = temp1 * temp;

  const mrt = rl * (1 - 1.5 * temp2 * betal * s.con41) + 0.5 * temp1 * s.x1mth2 * cos2u;
  if (mrt < 1) return null; // below the ground: decayed
  su -= 0.25 * temp2 * s.x7thm1 * sin2u;
  const xnode = nodem + 1.5 * temp2 * cosip * sin2u;
  const xinc = s.inclo + 1.5 * temp2 * cosip * sinip * cos2u;
  const mvt = rdotl - (nm * temp1 * s.x1mth2 * sin2u) / XKE;
  const rvdot = rvdotl + (nm * temp1 * (s.x1mth2 * cos2u + 1.5 * s.con41)) / XKE;

  // Orientation.
  const sinsu = Math.sin(su);
  const cossu = Math.cos(su);
  const snod = Math.sin(xnode);
  const cnod = Math.cos(xnode);
  const sini = Math.sin(xinc);
  const cosi = Math.cos(xinc);
  const xmx = -snod * cosi;
  const xmy = cnod * cosi;
  const ux = xmx * sinsu + cnod * cossu;
  const uy = xmy * sinsu + snod * cossu;
  const uz = sini * sinsu;
  const vx = xmx * cossu - cnod * sinsu;
  const vy = xmy * cossu - snod * sinsu;
  const vz = sini * cossu;

  return {
    r: [mrt * ux * EARTH_RADIUS, mrt * uy * EARTH_RADIUS, mrt * uz * EARTH_RADIUS],
    v: [(mvt * ux + rvdot * vx) * KM_PER_SEC, (mvt * uy + rvdot * vy) * KM_PER_SEC, (mvt * uz + rvdot * vz) * KM_PER_SEC],
  };
}

export function propagate(s, date) {
  return propagateMinutes(s, (date.getTime() - s.epoch.getTime()) / 60000);
}

// How far the Earth has turned: Greenwich mean sidereal time, in radians.
export function gmst(date) {
  const jd = date.getTime() / 86400000 + 2440587.5;
  const t = (jd - 2451545.0) / 36525;
  let seconds = 67310.54841 + (876600 * 3600 + 8640184.812866) * t + 0.093104 * t * t - 6.2e-6 * t * t * t;
  seconds %= 86400;
  if (seconds < 0) seconds += 86400;
  return (seconds / 240) * DEG;
}

// Unit vector from the Earth to the Sun, in the same frame as the satellite
// positions, good to about a hundredth of a degree.
function sunDirection(date) {
  const jd = date.getTime() / 86400000 + 2440587.5;
  const t = (jd - 2451545.0) / 36525;
  const meanLon = (280.46 + 36000.771 * t) * DEG;
  const meanAnomaly = (357.5291092 + 35999.05034 * t) * DEG;
  const eclLon = meanLon + (1.914666471 * Math.sin(meanAnomaly) + 0.019994643 * Math.sin(2 * meanAnomaly)) * DEG;
  const obliquity = (23.439291 - 0.0130042 * t) * DEG;
  return [Math.cos(eclLon), Math.cos(obliquity) * Math.sin(eclLon), Math.sin(obliquity) * Math.sin(eclLon)];
}

// observer: { lat, lon } in degrees (north and east positive), optional alt in km.
// Returns what someone standing there would need to know, or null.
//   az         compass bearing to the satellite, degrees from north
//   el         height above the horizon, degrees (negative: out of sight)
//   range      distance, km
//   rangeRate  km/s, negative while it is coming closer
//   sunlit     false when it is in the Earth's shadow
//   lat, lon   the point on the ground directly beneath it
export function look(s, observer, date) {
  const pv = propagate(s, date);
  if (!pv) return null;
  const theta = gmst(date);
  const cosT = Math.cos(theta);
  const sinT = Math.sin(theta);
  const [x, y, z] = pv.r;
  const [vx, vy, vz] = pv.v;

  // Into the frame that turns with the Earth.
  const sx = x * cosT + y * sinT;
  const sy = -x * sinT + y * cosT;
  const sz = z;
  const svx = vx * cosT + vy * sinT + EARTH_ROTATION * sy;
  const svy = -vx * sinT + vy * cosT - EARTH_ROTATION * sx;
  const svz = vz;

  const lat = observer.lat * DEG;
  const lon = observer.lon * DEG;
  const alt = observer.alt || 0;
  const e2 = WGS84_F * (2 - WGS84_F);
  const sinLat = Math.sin(lat);
  const cosLat = Math.cos(lat);
  const n = WGS84_A / Math.sqrt(1 - e2 * sinLat * sinLat);
  const ox = (n + alt) * cosLat * Math.cos(lon);
  const oy = (n + alt) * cosLat * Math.sin(lon);
  const oz = (n * (1 - e2) + alt) * sinLat;

  const rx = sx - ox;
  const ry = sy - oy;
  const rz = sz - oz;
  const range = Math.sqrt(rx * rx + ry * ry + rz * rz);

  // South, east and up at the observer.
  const south = sinLat * Math.cos(lon) * rx + sinLat * Math.sin(lon) * ry - cosLat * rz;
  const east = -Math.sin(lon) * rx + Math.cos(lon) * ry;
  const up = cosLat * Math.cos(lon) * rx + cosLat * Math.sin(lon) * ry + sinLat * rz;
  const el = Math.asin(up / range) / DEG;
  let az = Math.atan2(east, -south) / DEG;
  if (az < 0) az += 360;

  // The observer is fixed in this frame, so the satellite's velocity here is
  // the whole of the relative motion.
  const rangeRate = (rx * svx + ry * svy + rz * svz) / range;

  // In shadow if it is behind the Earth as seen from the Sun, and inside the
  // Earth's shadow cylinder.
  const sun = sunDirection(date);
  const along = x * sun[0] + y * sun[1] + z * sun[2];
  const across2 = x * x + y * y + z * z - along * along;
  const sunlit = along > 0 || across2 > WGS84_A * WGS84_A;

  // The ground point beneath (treating the Earth as round is close enough).
  const r = Math.sqrt(sx * sx + sy * sy + sz * sz);
  return {
    az,
    el,
    range,
    rangeRate,
    sunlit,
    lat: Math.asin(sz / r) / DEG,
    lon: Math.atan2(sy, sx) / DEG,
    height: r - WGS84_A,
  };
}

// The frequency to tune to for a signal that leaves the satellite on `hz`.
export function dopplerDown(hz, rangeRate) {
  return hz * (1 - rangeRate / LIGHT_SPEED);
}

// The frequency to transmit on for the satellite to hear `hz`.
export function dopplerUp(hz, rangeRate) {
  return hz / (1 - rangeRate / LIGHT_SPEED);
}

// One record of CelesTrak's CSV (or JSON) orbit data, as `createSatellite` wants it.
export function elementsFromOmm(record) {
  const num = (key) => Number(record[key]);
  const epoch = String(record.EPOCH || '');
  return {
    name: String(record.OBJECT_NAME || '').trim(),
    id: Number(record.NORAD_CAT_ID),
    // CelesTrak writes the date without a zone; it is UTC.
    epoch: new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(epoch) ? epoch : `${epoch}Z`),
    meanMotion: num('MEAN_MOTION'),
    eccentricity: num('ECCENTRICITY'),
    inclination: num('INCLINATION'),
    raan: num('RA_OF_ASC_NODE'),
    argPerigee: num('ARG_OF_PERICENTER'),
    meanAnomaly: num('MEAN_ANOMALY'),
    bstar: num('BSTAR'),
  };
}

// The classic two-line format, for testing against published examples.
export function elementsFromTle(name, line1, line2) {
  const exp = (text) => {
    // "28098-4" means 0.28098e-4
    const t = text.trim();
    if (!t) return 0;
    const m = t.match(/^([+-]?)(\d+)([+-]\d)$/);
    return m ? Number(`${m[1]}0.${m[2]}e${m[3]}`) : Number(t);
  };
  let year = Number(line1.slice(18, 20));
  year += year < 57 ? 2000 : 1900;
  const day = Number(line1.slice(20, 32));
  return {
    name,
    id: Number(line1.slice(2, 7)),
    epoch: new Date(Date.UTC(year, 0, 1) + (day - 1) * 86400000),
    bstar: exp(line1.slice(53, 61)),
    inclination: Number(line2.slice(8, 16)),
    raan: Number(line2.slice(17, 25)),
    eccentricity: Number(`0.${line2.slice(26, 33).trim()}`),
    argPerigee: Number(line2.slice(34, 42)),
    meanAnomaly: Number(line2.slice(43, 51)),
    meanMotion: Number(line2.slice(52, 63)),
  };
}
