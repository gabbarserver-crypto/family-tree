/* astro.js - Vedic (nirayana, Lahiri, whole-sign houses) helpers: Lagna, Mangal Dosh, Sade Sati / Dhaiya, Vimshottari Dasha.
   Pure functions, no DOM. The astronomy-engine module (MIT) is passed in as `A`, and the Moon's sidereal longitude as `moonFn(jd)`,
   so this file can be tested in Node and loaded lazily in the browser.
   Birth time is taken as IST (UTC+5:30), same as the rest of the app. Valid for birth years ~1800-2100. */

const RAD = Math.PI / 180;
export const mod360 = x => ((x % 360) + 360) % 360;
export const ayanamsaAt = jd => 23.85306 + 0.01396 * ((jd - 2451545.0) / 365.25);   // Lahiri (same as app.js)
export const jdFromDate = d => d.getTime() / 86400000 + 2440587.5;
export const dateFromJd = jd => new Date((jd - 2440587.5) * 86400000);

/* "1990-05-17" + "14:30" (IST) -> Julian day (UT), or null */
export function birthJd(dob, time) {
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(dob || "")), tm = /^(\d{1,2}):(\d{2})/.exec(String(time || ""));
  if (!iso || !tm) return null;
  const y = +iso[1];
  if (y < 1800 || y > 2100) return null;
  return (Date.UTC(y, +iso[2] - 1, +iso[3], +tm[1], +tm[2]) - 5.5 * 3600e3) / 86400000 + 2440587.5;
}

/* sidereal longitude (0..360) of a planet: A.Body.Mars / A.Body.Saturn ... */
export function planetSidereal(A, body, jd) {
  const t = A.MakeTime(dateFromJd(jd));
  const v = A.GeoVector(body, t, true);                       // J2000 equatorial, aberration-corrected
  const e = A.SphereFromVector(A.RotateVector(A.Rotation_EQJ_ECT(t), v));   // true ecliptic of date
  return mod360(e.lon - ayanamsaAt(jd));
}

/* sidereal Lagna (ascendant), lat/lng in degrees (east +) */
export function lagnaSidereal(jd, lat, lng) {
  const T = (jd - 2451545.0) / 36525;
  const gmst = mod360(280.46061837 + 360.98564736629 * (jd - 2451545.0) + 0.000387933 * T * T - T * T * T / 38710000);
  const ramc = mod360(gmst + lng) * RAD, eps = (23.439291 - 0.0130042 * T) * RAD, phi = lat * RAD;
  const asc = Math.atan2(Math.cos(ramc), -(Math.sin(ramc) * Math.cos(eps) + Math.tan(phi) * Math.sin(eps))) / RAD;
  return mod360(asc - ayanamsaAt(jd));
}

export const signOf = lon => Math.floor(mod360(lon) / 30);                  // 0 = Mesh ... 11 = Meen
export const houseFrom = (fromSign, sign) => ((sign - fromSign + 12) % 12) + 1;   // 1..12 (whole sign)

/* ---- Mangal Dosh ---- */
const DOSHA_HOUSES = [1, 2, 4, 7, 8, 12];
export function mangalDosh(marsLon, moonLon, lagnaLon /* may be null */) {
  const ms = signOf(marsLon);
  const hMoon = houseFrom(signOf(moonLon), ms);
  const hLagna = lagnaLon == null ? null : houseFrom(signOf(lagnaLon), ms);
  const fromMoon = DOSHA_HOUSES.includes(hMoon);
  const fromLagna = hLagna == null ? null : DOSHA_HOUSES.includes(hLagna);
  const strongSign = [0, 7, 9].includes(ms);                      // Mesh, Vrishchik (own), Makar (exalted)
  return { marsSign: ms, hMoon, hLagna, fromMoon, fromLagna, strongSign,
    present: fromMoon || fromLagna === true };
}

/* ---- Sade Sati / Dhaiya ---- */
export function saturnStatus(moonSign, satSign) {
  const h = houseFrom(moonSign, satSign);                        // Saturn's house counted from the natal Moon
  if (h === 12) return { kind: "sadesati", phase: 1, house: h };
  if (h === 1)  return { kind: "sadesati", phase: 2, house: h };
  if (h === 2)  return { kind: "sadesati", phase: 3, house: h };
  if (h === 4)  return { kind: "dhaiya", phase: 4, house: h };   // Kantak Shani
  if (h === 8)  return { kind: "dhaiya", phase: 8, house: h };   // Ashtam Shani
  return { kind: "none", phase: 0, house: h };
}

/* Find Sade Sati periods around "nowJd" (scan 9 years back .. 32 years ahead). Returns {now, current, next}
   where current/next = {startJd, endJd} ; boundaries refined to ~1 day. */
export function sadeSatiPeriods(A, moonSign, nowJd) {
  const sat = A.Body.Saturn;
  const inSS = jd => saturnStatus(moonSign, signOf(planetSidereal(A, sat, jd))).kind === "sadesati";
  const STEP = 10, from = nowJd - 9 * 365.25, to = nowJd + 32 * 365.25;
  const flags = [];
  for (let jd = from; jd <= to; jd += STEP) flags.push([jd, inSS(jd)]);
  const refine = (a, b) => { for (let i = 0; i < 5; i++) { const m = (a + b) / 2; if (inSS(m) === inSS(b)) b = m; else a = m; } return b; };
  const raw = [];
  for (let i = 0; i < flags.length; i++) {
    if (!flags[i][1]) continue;
    const startJd = (i > 0 && !flags[i - 1][1]) ? refine(flags[i - 1][0], flags[i][0]) : (i === 0 ? null : flags[i][0]);
    let j = i; while (j + 1 < flags.length && flags[j + 1][1]) j++;
    const endJd = (j + 1 < flags.length) ? refine(flags[j][0], flags[j + 1][0]) : null;
    raw.push({ startJd, endJd }); i = j;
  }
  // Saturn's retrograde can step out and back in: merge pieces closer than ~1.5 years
  const merged = [];
  for (const p of raw) {
    const last = merged[merged.length - 1];
    if (last && last.endJd != null && p.startJd != null && p.startJd - last.endJd < 550) last.endJd = p.endJd;
    else merged.push({ ...p });
  }
  const current = merged.find(p => (p.startJd == null || p.startJd <= nowJd) && (p.endJd == null || p.endJd >= nowJd)) || null;
  const next = current ? null : (merged.find(p => p.startJd != null && p.startJd > nowJd) || null);
  return { current, next };
}

/* ---- Vimshottari Dasha ---- */
export const DASHA_ORDER = [["Ketu", 7], ["Shukra", 20], ["Surya", 6], ["Chandra", 10], ["Mangal", 7], ["Rahu", 18], ["Guru", 16], ["Shani", 19], ["Budh", 17]];
const YEAR = 365.25;

/* moonLon = sidereal Moon longitude at birth; returns the full list of Mahadashas (120 years) with Antardashas */
export function vimshottari(moonLon, birthJdUt) {
  const nak = 360 / 27, idx = Math.floor(mod360(moonLon) / nak);
  const start = idx % 9;                                           // nakshatra lord index
  const frac = (mod360(moonLon) % nak) / nak;                      // how much of the nakshatra is already over
  let t = birthJdUt - frac * DASHA_ORDER[start][1] * YEAR;         // start of the (partly elapsed) first Mahadasha
  const out = [];
  for (let k = 0; k < 9; k++) {
    const [name, yrs] = DASHA_ORDER[(start + k) % 9];
    const mdStart = t, mdEnd = t + yrs * YEAR;
    const antar = []; let a = mdStart;
    for (let q = 0; q < 9; q++) {
      const [an, ay] = DASHA_ORDER[((start + k) % 9 + q) % 9];
      const len = yrs * ay / 120 * YEAR;
      antar.push({ lord: an, startJd: a, endJd: a + len }); a += len;
    }
    out.push({ lord: name, years: yrs, startJd: mdStart, endJd: mdEnd, antar });
    t = mdEnd;
  }
  return { list: out, balanceYears: (1 - frac) * DASHA_ORDER[start][1], firstLord: DASHA_ORDER[start][0] };
}
export function currentDasha(v, nowJd) {
  const md = v.list.find(m => m.startJd <= nowJd && nowJd < m.endJd) || null;
  const ad = md ? md.antar.find(a => a.startJd <= nowJd && nowJd < a.endJd) || null : null;
  return { md, ad };
}

/* One call: everything the card needs. moonFn(jd) -> sidereal Moon longitude. geo = {lat,lng} or null */
export function kundliSummary(A, moonFn, jd, geo, nowJd) {
  const moon = moonFn(jd);
  const mars = planetSidereal(A, A.Body.Mars, jd);
  const lagna = geo ? lagnaSidereal(jd, geo.lat, geo.lng) : null;
  const saturnNow = planetSidereal(A, A.Body.Saturn, nowJd);
  const moonSign = signOf(moon);
  return {
    moon, moonSign, lagna, mars,
    mangal: mangalDosh(mars, moon, lagna),
    saturnNowSign: signOf(saturnNow),
    saturn: saturnStatus(moonSign, signOf(saturnNow)),
    sade: sadeSatiPeriods(A, moonSign, nowJd),
    dasha: vimshottari(moon, jd)
  };
}
