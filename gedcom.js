// gedcom.js — GEDCOM (.ged) -> familytree state.people / state.relationships
// Output shapes match what persistState() in app.js already saves.

const MONTHS = { JAN:1, FEB:2, MAR:3, APR:4, MAY:5, JUN:6, JUL:7, AUG:8, SEP:9, OCT:10, NOV:11, DEC:12 };

/* 1) Raw parser: text -> tree of {tag, xref, value, children} */
export function parseGedcom(text) {
  const root = { children: [] };
  const stack = [{ level: -1, node: root }];
  for (const raw of text.replace(/^\uFEFF/, "").split(/\r?\n/)) {
    if (!raw.trim()) continue;
    const m = raw.match(/^\s*(\d+)\s+(?:(@[^@]+@)\s+)?(\S+)(?:\s(.*))?$/);
    if (!m) continue;
    const level = +m[1];
    const node = { tag: m[3].toUpperCase(), xref: m[2] || null, value: (m[4] || "").trim(), children: [] };
    while (stack.length > 1 && stack[stack.length - 1].level >= level) stack.pop();
    const parent = stack[stack.length - 1].node;
    if (node.tag === "CONC" || node.tag === "CONT") {           // continuation of parent's value
      parent.value += (node.tag === "CONT" ? "\n" : "") + node.value;
      continue;
    }
    parent.children.push(node);
    stack.push({ level, node });
  }
  return root.children;
}

const child = (n, tag) => n.children.find(c => c.tag === tag);
const val = (n, tag) => (child(n, tag)?.value || "").trim();

/* "26 Aug 1991" -> "1991-08-26". Built by hand (NOT new Date()) so IST/UTC never shifts the day.
   Partial dates ("1967", "Aug 1991", "ABT 1967") return null; caller keeps raw text. */
export function gedDateToISO(s) {
  const m = (s || "").trim().toUpperCase().match(/^(\d{1,2})\s+([A-Z]{3})[A-Z]*\s+(\d{4})$/);
  if (!m || !MONTHS[m[2]]) return null;
  const d = +m[1], mo = MONTHS[m[2]], y = +m[3];
  return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

const titleCase = s => s.toLowerCase().replace(/(^|[\s\-'])([a-z])/g, (_, a, b) => a + b.toUpperCase());

function personName(indi) {
  const n = child(indi, "NAME");
  if (!n) return "Unknown";
  const g = val(n, "GIVN"), s = val(n, "SURN");
  const full = [g, s].filter(Boolean).join(" ") || n.value.replace(/\//g, " ").replace(/\s+/g, " ").trim();
  return full === full.toUpperCase() ? titleCase(full) : full;
}

/* 2) Mapper: parsed records -> app state objects */
export function gedcomToTree(records, { createdBy = null, existingCodes = new Set(), existingGedIds = new Set() } = {}) {
  const codes = new Set(existingCodes);
  const newCode = () => { let c; do { c = "P-" + Math.floor(10000 + Math.random() * 89999); } while (codes.has(c)); codes.add(c); return c; };
  const report = { persons: 0, families: 0, spouseEdges: 0, parentEdges: 0, skippedDuplicates: 0, danglingRefs: 0, photos: 0, photosSkipped: 0 };

  const idMap = new Map();   // GEDCOM xref -> new person id
  const byId = new Map();    // new person id -> person (O(1) lookup)
  const people = [];
  for (const r of records.filter(x => x.tag === "INDI")) {
    if (existingGedIds.has(r.xref)) { report.skippedDuplicates++; continue; }   // re-import safe
    const birt = child(r, "BIRT"), deat = child(r, "DEAT");
    const rawDob = birt ? val(birt, "DATE") : "";
    const sex = val(r, "SEX").toUpperCase();
    const rawPhoto = child(r, "OBJE") ? val(child(r, "OBJE"), "FILE") : "";
    const photo = /^https?:\/\//i.test(rawPhoto) ? rawPhoto : "";            // local paths (C:\\x.jpg) can't load in a browser
    const photoSkipped = !!rawPhoto && !photo;
    const details = { gedcom_id: r.xref, source: "gedcom" };
    if (rawDob && !gedDateToISO(rawDob)) details.dob_text = rawDob;
    if (deat) { details.death_date = val(deat, "DATE") || null; details.death_place = val(deat, "PLAC") || null; }
    const p = {
      id: crypto.randomUUID(), personCode: newCode(), name: personName(r),
      dob: gedDateToISO(rawDob), gender: sex === "M" ? "Male" : sex === "F" ? "Female" : null,
      birthPlace: birt ? val(birt, "PLAC") || null : null,
      lifeStatus: deat ? "deceased" : "living",
      avatar_url: photo || null, status: "unclaimed", created_by: createdBy, details
    };
    if (photo) report.photos++;
    if (photoSkipped) { details.photo_file = rawPhoto; report.photosSkipped++; }
    idMap.set(r.xref, p.id); byId.set(p.id, p); people.push(p); report.persons++;
  }

  const relationships = [], seen = new Set();
  const link = (a, b, type) => {
    if (!idMap.has(a) || !idMap.has(b)) { report.danglingRefs++; return; }
    const from = idMap.get(a), to = idMap.get(b), k = `${type}|${from}|${to}`;
    if (seen.has(k)) return; seen.add(k);
    relationships.push({ id: crypto.randomUUID(), from, to, type, status: "confirmed" });
    type === "spouse" ? report.spouseEdges++ : report.parentEdges++;
  };
  for (const f of records.filter(x => x.tag === "FAM")) {
    report.families++;
    const h = val(f, "HUSB"), w = val(f, "WIFE");
    if (h && w) link(h, w, "spouse");
    for (const c of f.children.filter(x => x.tag === "CHIL")) {
      if (h) link(h, c.value, "parent");
      if (w) link(w, c.value, "parent");
    }
    const marr = child(f, "MARR");                                   // keep marriage date if present
    if (marr && val(marr, "DATE") && idMap.has(h)) {
      const p = byId.get(idMap.get(h)); if (p) (p.details.marriages ||= []).push({ spouse_gedcom_id: w, date: val(marr, "DATE") });
    }
  }
  return { people, relationships, report };
}

/* 3) One-call helper for the UI */
export async function importGedcomFile(file, ctx) {
  return gedcomToTree(parseGedcom(await file.text()), ctx);
}

/* ---------------------------------------------------------------------------
   4) EXPORT: familytree state.people / state.relationships -> GEDCOM 5.5.1 text
   Relationship model in the app: {type:"parent", from:<parent>, to:<child>} and {type:"spouse", from, to}.
   --------------------------------------------------------------------------- */
const MON = ["JAN","FEB","MAR","APR","MAY","JUN","JUL","AUG","SEP","OCT","NOV","DEC"];

/* "1991-08-26" or "14 Mar 1968" -> "26 AUG 1991". Anything else is kept as a GEDCOM date phrase "(text)". */
function toGedDate(s) {
  s = (s || "").toString().trim();
  if (!s) return "";
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m && +m[2] >= 1 && +m[2] <= 12) return `${+m[3]} ${MON[+m[2] - 1]} ${m[1]}`;
  m = s.match(/^(\d{1,2})\s+([A-Za-z]{3})[A-Za-z]*\.?\s+(\d{4})$/);
  if (m && MONTHS[m[2].toUpperCase()]) return `${+m[1]} ${m[2].toUpperCase()} ${m[3]}`;
  if (/^(ABT|BEF|AFT|EST|CAL)?\s*(\d{1,2}\s+[A-Z]{3}\s+)?\d{4}$/i.test(s)) return s.toUpperCase();
  return `(${s.replace(/[()]/g, "")})`;
}

/* Long / multi-line text -> GEDCOM lines with CONT (newline) and CONC (length) continuations. */
function gedText(level, tag, text) {
  const out = [];
  const lines = String(text).replace(/\r/g, "").split("\n");
  lines.forEach((ln, i) => {
    let chunk = ln, first = true;
    do {
      const piece = chunk.slice(0, 200); chunk = chunk.slice(200);
      if (i === 0 && first) out.push(`${level} ${tag} ${piece}`.trimEnd());
      else out.push(`${level + 1} ${first ? "CONT" : "CONC"} ${piece}`.trimEnd());
      first = false;
    } while (chunk.length);
  });
  return out;
}

const gedName = (full) => {
  const parts = String(full || "Unknown").replace(/\//g, " ").replace(/\s+/g, " ").trim().split(" ");
  if (parts.length < 2) return `${parts[0] || "Unknown"} //`;
  const surn = parts.pop();
  return `${parts.join(" ")} /${surn}/`;
};

export function treeToGedcom(people, relationships, { appName = "FamilyTree" } = {}) {
  const num = new Map(); people.forEach((p, i) => num.set(p.id, i + 1));
  const byId = new Map(people.map(p => [p.id, p]));
  const parentsOf = new Map();                      // child id -> [parent ids]
  const spouseEdges = [];
  for (const r of relationships || []) {
    if (!byId.has(r.from) || !byId.has(r.to)) continue;
    if (r.type === "parent") { if (!parentsOf.has(r.to)) parentsOf.set(r.to, []); if (!parentsOf.get(r.to).includes(r.from)) parentsOf.get(r.to).push(r.from); }
    else if (r.type === "spouse") spouseEdges.push([r.from, r.to]);
  }

  /* Build FAM records: every spouse pair, plus parent groups that are not spouses (and single parents). */
  const fams = [], famByKey = new Map();
  const ordered = (a, b) => {                       // HUSB first when genders say so
    const A = byId.get(a), B = byId.get(b);
    if (A.gender === "Female" && B.gender !== "Female") return [b, a];
    return [a, b];
  };
  const getFam = (ids) => {
    const key = [...ids].sort().join("|");
    if (famByKey.has(key)) return famByKey.get(key);
    let husb = null, wife = null;
    if (ids.length === 2) [husb, wife] = ordered(ids[0], ids[1]);
    else { const p = byId.get(ids[0]); if (p.gender === "Female") wife = ids[0]; else husb = ids[0]; }
    const f = { n: fams.length + 1, husb, wife, children: [] };
    fams.push(f); famByKey.set(key, f); return f;
  };
  spouseEdges.forEach(([a, b]) => getFam([a, b]));
  for (const [child, pars] of parentsOf) {
    let f = null;
    if (pars.length >= 2) {
      for (let i = 0; i < pars.length && !f; i++) for (let j = i + 1; j < pars.length && !f; j++) {
        const k = [pars[i], pars[j]].sort().join("|"); if (famByKey.has(k)) f = famByKey.get(k);
      }
      if (!f) f = getFam([pars[0], pars[1]]);
      f.children.push(child);
      pars.slice(2).forEach(extra => getFam([extra]).children.push(child));   // 3rd+ parent (step/adoptive): own FAM
    } else {
      getFam([pars[0]]).children.push(child);
    }
  }

  const famsOf = new Map(), famcOf = new Map();    // person -> FAM numbers (as spouse / as child)
  const add = (m, k, v) => { if (!m.has(k)) m.set(k, []); if (!m.get(k).includes(v)) m.get(k).push(v); };
  for (const f of fams) {
    if (f.husb) add(famsOf, f.husb, f.n);
    if (f.wife) add(famsOf, f.wife, f.n);
    f.children.forEach(c => add(famcOf, c, f.n));
  }

  const L = [];
  const now = new Date();
  L.push("0 HEAD", `1 SOUR ${appName}`, `2 NAME ${appName}`, "1 GEDC", "2 VERS 5.5.1", "2 FORM LINEAGE-LINKED",
    "1 CHAR UTF-8", `1 DATE ${now.getDate()} ${MON[now.getMonth()]} ${now.getFullYear()}`);

  for (const p of people) {
    const d = p.details || {};
    L.push(`0 @I${num.get(p.id)}@ INDI`, `1 NAME ${gedName(p.name)}`);
    if (p.nickname) L.push(`2 NICK ${p.nickname}`);
    if (p.gender === "Male") L.push("1 SEX M"); else if (p.gender === "Female") L.push("1 SEX F");
    const bd = toGedDate(p.dob || d.dob_text);
    if (bd || p.birthPlace) { L.push("1 BIRT"); if (bd) L.push(`2 DATE ${bd}`); if (p.birthPlace) L.push(`2 PLAC ${p.birthPlace}`); }
    if (p.lifeStatus === "deceased" || d.death_date) {
      const dd = toGedDate(d.death_date);
      if (dd || d.death_place) { L.push("1 DEAT"); if (dd) L.push(`2 DATE ${dd}`); if (d.death_place) L.push(`2 PLAC ${d.death_place}`); }
      else L.push("1 DEAT Y");
    }
    if (p.currentPlace) L.push("1 RESI", `2 PLAC ${p.currentPlace}`);
    if (/^https?:\/\//i.test(p.avatar_url || "")) {
      const ext = (p.avatar_url.split("?")[0].match(/\.(\w{3,4})$/) || [])[1] || "jpg";
      L.push("1 OBJE", `2 FILE ${p.avatar_url}`, `3 FORM ${ext.toLowerCase()}`);
    }
    if (p.about) L.push(...gedText(1, "NOTE", p.about));
    (famcOf.get(p.id) || []).forEach(n => L.push(`1 FAMC @F${n}@`));
    (famsOf.get(p.id) || []).forEach(n => L.push(`1 FAMS @F${n}@`));
  }

  for (const f of fams) {
    L.push(`0 @F${f.n}@ FAM`);
    if (f.husb) L.push(`1 HUSB @I${num.get(f.husb)}@`);
    if (f.wife) L.push(`1 WIFE @I${num.get(f.wife)}@`);
    f.children.forEach(c => L.push(`1 CHIL @I${num.get(c)}@`));
    if (f.husb && f.wife) {                         // marriage date saved at import time
      const h = byId.get(f.husb), w = byId.get(f.wife);
      const mm = ((h.details && h.details.marriages) || []).find(x => w.details && x.spouse_gedcom_id === w.details.gedcom_id);
      const md = mm && toGedDate(mm.date);
      if (md) L.push("1 MARR", `2 DATE ${md}`);
    }
  }
  L.push("0 TRLR");
  return L.join("\r\n") + "\r\n";
}
