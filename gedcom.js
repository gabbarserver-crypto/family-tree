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
  const report = { persons: 0, families: 0, spouseEdges: 0, parentEdges: 0, skippedDuplicates: 0, danglingRefs: 0, photos: 0 };

  const idMap = new Map();   // GEDCOM xref -> new person id
  const people = [];
  for (const r of records.filter(x => x.tag === "INDI")) {
    if (existingGedIds.has(r.xref)) { report.skippedDuplicates++; continue; }   // re-import safe
    const birt = child(r, "BIRT"), deat = child(r, "DEAT");
    const rawDob = birt ? val(birt, "DATE") : "";
    const sex = val(r, "SEX").toUpperCase();
    const photo = child(r, "OBJE") ? val(child(r, "OBJE"), "FILE") : "";
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
    idMap.set(r.xref, p.id); people.push(p); report.persons++;
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
      const p = people.find(x => x.id === idMap.get(h)); if (p) (p.details.marriages ||= []).push({ spouse_gedcom_id: w, date: val(marr, "DATE") });
    }
  }
  return { people, relationships, report };
}

/* 3) One-call helper for the UI */
export async function importGedcomFile(file, ctx) {
  return gedcomToTree(parseGedcom(await file.text()), ctx);
}
