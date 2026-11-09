import { supabase, supabaseConfigured, signInWithGoogle, sendPhoneOtp, verifyPhoneOtp } from "./supabase.js";
import { importGedcomFile } from "./gedcom.js";

/* ==========================================================================
   FamilyTree — integrated app (V1 core + V3 Tree, V4 Merge, V5 Profiles,
   V6 Wall/Events, V9 Sharing, V10 Admin, V11 Support/Production)
   Vanilla JS SPA, localStorage-backed demo state (swap for Supabase calls
   using supabase-client-example.js + the supabase-*.sql schemas).
   ========================================================================== */

const seed = {
  account: { name: "Saurabh Sharma", email: "saurabh@example.com", role: "member", personId: "P-10003" },
  people: [
    { id: "P-10000", name: "Ramesh Sharma", gender: "Male", status: "claimed" },
    { id: "P-10009", name: "Sunita Sharma", gender: "Female", status: "claimed" },
    { id: "P-10001", name: "Rakesh Sharma", gender: "Male", status: "claimed", dob: "14 Mar 1968", mobile: "98XXXXXX10" },
    { id: "P-10008", name: "Neha Sharma", gender: "Female", status: "claimed" },
    { id: "P-10002", name: "Sunita Devi", gender: "Female", status: "claimed" },
    { id: "P-10003", name: "Saurabh Sharma", gender: "Male", status: "claimed", me: true, privacy: "Family only", about: "Family profile information can be shown here." },
    { id: "P-10004", name: "Rahul Sharma", gender: "Male", status: "unclaimed", dob: "12 May 1995", mobile: "98XXXXXX21" },
    { id: "P-10006", name: "Rahul Kumar Sharma", gender: "Male", status: "unclaimed", dob: "12 May 1995", mobile: "98XXXXXX21" },
    { id: "P-10005", name: "Amit Sharma", gender: "Male", status: "claimed" }
  ],
  /* Real family graph: normalized relationship edges (see V3_IMPLEMENTATION.md).
     type "parent": `from` is parent of `to`.  type "spouse": undirected link. */
  relationships: [
    { id: "R1", from: "P-10000", to: "P-10001", type: "parent", status: "confirmed" },
    { id: "R2", from: "P-10000", to: "P-10008", type: "parent", status: "confirmed" },
    { id: "R3", from: "P-10009", to: "P-10001", type: "parent", status: "confirmed" },
    { id: "R4", from: "P-10009", to: "P-10008", type: "parent", status: "confirmed" },
    { id: "R5", from: "P-10000", to: "P-10009", type: "spouse", status: "confirmed" },
    { id: "R6", from: "P-10001", to: "P-10003", type: "parent", status: "confirmed" },
    { id: "R7", from: "P-10001", to: "P-10005", type: "parent", status: "confirmed" },
    { id: "R8", from: "P-10002", to: "P-10003", type: "parent", status: "confirmed" },
    { id: "R9", from: "P-10002", to: "P-10005", type: "parent", status: "confirmed" },
    { id: "R10", from: "P-10001", to: "P-10002", type: "spouse", status: "confirmed" },
    { id: "R11", from: "P-10008", to: "P-10004", type: "parent", status: "confirmed" },
    { id: "R12", from: "P-10008", to: "P-10006", type: "parent", status: "confirmed" }
  ],
  connections: [
    { id: "P-10004", name: "Rahul Sharma", relation: "Cousin", status: "pending" },
    { id: "P-10005", name: "Amit Sharma", relation: "Family member", status: "connected" }
  ],
  mergeRequests: [],
  events: [
    { emoji: "🎂", title: "Ramesh Sharma", sub: "Birthday · Tomorrow" },
    { emoji: "💍", title: "Amit & Neha", sub: "Engagement anniversary · 25 August" },
    { emoji: "💒", title: "Rahul & Priya", sub: "Marriage anniversary · 02 September" }
  ],
  posts: [
    { id: 1, author: "Priya Sharma", text: "🎉 Family dinner this Sunday!", likes: 12, comments: 3 },
    { id: 2, author: "Rahul Sharma", text: "📷 Sharing a family memory.", likes: 28, comments: 7 }
  ],
  tickets: [
    { id: "FT-10280", subject: "OTP not received", category: "Login / OTP", priority: "Urgent", status: "Open",
      messages: [{ from: "user", text: "I'm not getting the OTP on my phone." }] },
    { id: "FT-10283", subject: "Two profiles need merging", category: "Duplicate / Merge", priority: "Medium", status: "Open",
      messages: [{ from: "user", text: "There are two entries for my cousin Rahul." }] },
    { id: "FT-10284", subject: "OTP claim not working", category: "Profile Claim", priority: "High", status: "In Progress",
      messages: [
        { from: "user", text: "I created my profile but OTP claim is not working." },
        { from: "staff", text: "Hello! We are checking your claim request." },
        { from: "user", text: "Okay, thank you." }
      ] }
  ],
  audit: [
    { text: "Admin reviewed merge request", time: "2 min ago" },
    { text: "Admin suspended account", time: "1 hr ago" }
  ]
};

let state = { account: {}, people: [], relationships: [], connections: [], mergeRequests: [], events: [], posts: [], tickets: [], audit: [], treeId: null };
let loggedIn = false;
let currentUser = null;
let treeScale = 1;
const removedEdgeKeys = new Set(); // links the user removed on purpose (so auto-fixers never re-create them)
const edgeKey = (a, b, t) => t === "spouse" ? [a, b].sort().join("|") + "|spouse" : a + "|" + b + "|" + t;
let activeProfileId = null;
let activeTicketId = null;
let addRelativeTargetId = null;
let addRelativeTypeKey = null;
let addRelativeMode = "new";
let addRelativePhotoFile = null;
let addRelativePersonId = null;
const RELATION_TYPES = {
  wife: { label: "Wife", gender: "Female", edgeType: "spouse" },
  husband: { label: "Husband", gender: "Male", edgeType: "spouse" },
  son: { label: "Son", gender: "Male", edgeType: "child" },
  daughter: { label: "Daughter", gender: "Female", edgeType: "child" },
  father: { label: "Father", gender: "Male", edgeType: "parent" },
  mother: { label: "Mother", gender: "Female", edgeType: "parent" },
  brother: { label: "Brother", gender: "Male", edgeType: "sibling" },
  sister: { label: "Sister", gender: "Female", edgeType: "sibling" }
};

function save() { return persistState(); }

/* Joined tree: every write goes through the join_sync() database function, which decides per row what this
   member may do. We only send rows that are new, or that this member is allowed to edit. */
function personToRow(p) {
  return { id: p.id, person_code: p.personCode || p.id, full_name: p.name, dob: normalizeDate(p.dob), gender: p.gender || null, mobile: p.mobile || null, email: p.email || null, avatar_url: p.avatar_url || null, status: p.status || "unclaimed",
    nickname: p.nickname || null, show_nickname: !!p.showNickname, birth_place: p.birthPlace || null, current_place: p.currentPlace || null, life_status: p.lifeStatus || "living", details: p.details || {} };
}
let joinSyncChain = Promise.resolve();
function joinSyncState() {
  joinSyncChain = joinSyncChain.then(async () => {
    const j = state.joined; if (!j) return;
    const people = state.people.filter(p => !p.external && (!j.known.has(p.id) || canEditPerson(p))).map(personToRow);
    const rels = state.relationships.filter(r => !j.knownRels.has(r.id) || r.status === "removed").map(r => ({ id: isUuid(r.id) ? r.id : crypto.randomUUID(), person_a_id: r.from, person_b_id: r.to, relationship_type: r.type, status: r.status === "removed" ? "removed" : "active" }));
    if (!people.length && !rels.length) return;
    const { data, error } = await supabase.rpc("join_sync", { p_tree_id: j.treeId, p_people: people, p_rels: rels });
    if (error) { console.error("join_sync failed", error); toast("Server save failed: " + error.message); return; }
    state.people.forEach(p => j.known.add(p.id));
    state.relationships.forEach(r => { if (isUuid(r.id)) j.knownRels.add(r.id); });
    if (data && data.skipped) toast("Kuch changes allowed nahi the (approval ke baad purane profile edit ho sakte hain)");
  }).catch(e => { console.error(e); toast("Server save failed: " + (e.message || e)); });
  return joinSyncChain;
}

async function persistState() {
  if (treeViewing) return; // read-only while viewing another person's tree
  if (!supabase || !currentUser || !state.treeId) return;
  if (state.joined) return joinSyncState();
  try {
    // Only write persons this user owns/claims; rewriting other people's rows is what RLS rejects (403 / 42501) and it fails the whole batch.
    const peopleRows = state.people.filter(p => p.me || p.claimed_by === currentUser.id || p.created_by === currentUser.id).map(p => ({
      id: p.id, person_code: p.personCode || p.id, full_name: p.name, dob: normalizeDate(p.dob), gender: p.gender || null, mobile: p.mobile || null, email: p.email || null, avatar_url: p.avatar_url || null, status: p.status || 'unclaimed', claimed_by: p.claimed_by || (p.me ? currentUser.id : null), created_by: p.created_by || currentUser.id,
      nickname: p.nickname || null, show_nickname: !!p.showNickname, birth_place: p.birthPlace || null, current_place: p.currentPlace || null, life_status: p.lifeStatus || 'living', details: p.details || {}
    }));
    if (peopleRows.length) { const { error } = await supabase.from('persons').upsert(peopleRows, { onConflict: 'id' }); if (error) throw error; }
    const memberRows = state.people.filter(p => !p.external).map(p => ({ tree_id: state.treeId, person_id: p.id, added_by: currentUser.id, role: personTreeRole(p) }));
    // Insert only missing members (ON CONFLICT DO NOTHING) so existing rows never hit the UPDATE policy; role changes are updated explicitly below.
    if (memberRows.length) { const { error } = await supabase.from('tree_members').upsert(memberRows, { onConflict: 'tree_id,person_id', ignoreDuplicates: true }); if (error) throw error; }
    for (const p of state.people.filter(x => !x.external)) {
      const role = personTreeRole(p);
      if (p.savedRole && p.savedRole !== role) {
        const { error } = await supabase.from('tree_members').update({ role }).eq('tree_id', state.treeId).eq('person_id', p.id); if (error) throw error;
      }
      p.savedRole = role;
    }
    const relRows = state.relationships.filter(r => !r.tree_id || r.tree_id === state.treeId).map(r => ({ id: isUuid(r.id) ? r.id : crypto.randomUUID(), tree_id: state.treeId, person_a_id: r.from, person_b_id: r.to, relationship_type: r.type, created_by: currentUser.id, status: r.status === 'removed' ? 'removed' : 'active' }));
    if (relRows.length) { const { error } = await supabase.from('relationships').upsert(relRows, { onConflict: 'id' }); if (error) throw error; }
  } catch (e) { console.error('Supabase save failed', e); toast('Saved locally in this session; server save failed'); }
}
function isUuid(v) { return typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v); }
function normalizeDate(v) { if (!v) return null; const d = new Date(v); return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0,10); }
function initials(n) { return n.split(" ").map(x => x[0]).slice(0, 2).join("").toUpperCase(); }
function avatarHTML(p, cls) {
  cls = cls || "";
  const [bg, fg] = avatarPalette(p);
  // If the photo link is dead (404 / expired short link) the onerror handler swaps in the initials avatar.
  if (p.avatar_url) return `<div class="avatar ${cls}" style="padding:0;overflow:hidden"><img src="${esc(p.avatar_url)}" alt="" loading="lazy" referrerpolicy="no-referrer" data-ini="${esc(initials(p.name))}" data-bg="${bg}" data-fg="${fg}" onerror="avatarFallback(this)" style="width:100%;height:100%;object-fit:cover;border-radius:inherit"></div>`;
  return `<div class="avatar ${cls}" style="background:${bg};color:${fg}">${esc(initials(p.name))}</div>`;
}
/* Gender-based tint (blue/rose, the common family-tree convention), with a
   deterministic hash-based fallback palette when gender isn't set, so the
   same person always gets the same color without needing to store one. */
function avatarFallback(img) {
  const b = img.parentNode; if (!b) return;
  b.style.padding = ""; b.style.overflow = "";
  b.style.background = img.dataset.bg; b.style.color = img.dataset.fg;
  b.textContent = img.dataset.ini;
}
function avatarPalette(p) {
  if (p.gender === "Male") return ["#e6effb", "#2f6fb8"];
  if (p.gender === "Female") return ["#fbe4ec", "#c23572"];
  const palette = [
    ["#efe9f5", "#6b4a94"], // plum/lavender
    ["#e8f2ea", "#3f7a54"], // sage
    ["#fdf0dc", "#b8811f"], // gold
    ["#fde8df", "#c2612f"], // terracotta
  ];
  const seed = p.id || p.name || "";
  let h = 0;
  for (let i = 0; i < String(seed).length; i++) h = (h * 31 + String(seed).charCodeAt(i)) >>> 0;
  return palette[h % palette.length];
}
function toast(msg) { const x = document.createElement("div"); x.className = "toast"; x.textContent = msg; document.body.appendChild(x); setTimeout(() => x.remove(), 2200); }
function esc(s) { return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;"); }
/* "View another person's own tree" mode: state.people/relationships are temporarily swapped for that
   person's tree (read-only). treeViewing.backup holds MY tree so "Back to my tree" restores it instantly. */
let treeViewing = null; // { ownerId, ownerName, backup: { people, relationships, treeCenterId, treeExpanded, treeScale } }
function me() {
  if (treeViewing) return state.people.find(p => p.id === treeViewing.ownerId) || state.people[0];
  return state.people.find(p => p.me);
}
function myself() { return treeViewing ? treeViewing.backup.people.find(p => p.me) : me(); } // the signed-in user's own person card
function isStaff() { return state.account.role === "admin" || state.account.role === "support"; }
function isAdmin() { return state.account.role === "admin"; }
/* Per-tree admin role (distinct from the system-wide isStaff/isAdmin above).
   Owner = created the tree. Admin = promoted by the owner, can add/edit
   relatives in THIS tree only. Member = view-only for role management. */
function personTreeRole(p) { return (p && p.treeRole) || (p && p.me ? "owner" : "member"); }
function myTreeRole() { return personTreeRole(me()); }
function isTreeOwner() { return myTreeRole() === "owner"; }
function canEditTree() { if (treeViewing) return false; return myTreeRole() === "owner" || myTreeRole() === "admin"; }
/* Any tree admin (or the owner) can add or remove other admins. The owner itself can never be removed. */
function canManageAdmins() { return canEditTree(); }
/* Anyone can add relatives directly onto their own card, even if they're
   not a tree owner/admin. Everyone else's card still needs edit rights. */
function canAddRelativeTo(targetId) { if (treeViewing) return false; if (state.joined) return true; return canEditTree() || targetId === me().id; }
/* Joined-tree mode: a new member who asked to join someone else's tree.
   pending  = may ADD new profiles/links only (cannot edit or delete anything that existed before)
   approved = may also edit old unclaimed profiles. The server (join_sync) enforces the same rules. */
function isPendingJoiner() { return !!state.joined && state.joined.status === "pending"; }
function treeRoleLabel(r) { return r === "owner" ? "Owner" : r === "admin" ? "Admin" : "Member"; }
function treeRoleBadgeClass(r) { return r === "owner" ? "sage" : r === "admin" ? "plum" : ""; }

/* ==========================================================================
   Real Family Graph engine
   Relationships are stored as edges (see state.relationships), not as
   hard-coded text. Everything below derives labels/paths/layout from those
   edges — satisfies V3_IMPLEMENTATION.md acceptance tests 4–8.
   ========================================================================== */
function personById(id) { return state.people.find(p => p.id === id); }
function nextRelId() { return crypto.randomUUID(); }

function edgeExists(from, to, type) {
  return state.relationships.some(r =>
    r.type === type && ((r.from === from && r.to === to) || (type === "spouse" && r.from === to && r.to === from))
  );
}
function addEdge(from, to, type) {
  if (from === to) return null;
  if (edgeExists(from, to, type)) return null; // acceptance test 7: no duplicate edges
  const e = { id: nextRelId(), from, to, type, status: "confirmed" };
  removedEdgeKeys.delete(edgeKey(from, to, type));
  state.relationships.push(e);
  return e;
}
/* "Father: X · Husband: Y" — a short who-is-this line, so people with the same name can be told apart. */
function kinLine(p) {
  if (!p) return "";
  const pars = parentsOf(p.id).map(personById).filter(Boolean);
  const father = pars.find(x => x.gender === "Male"), mother = pars.find(x => x.gender === "Female");
  const sps = spousesOf(p.id).map(personById).filter(Boolean).map(x => x.name);
  const spLabel = p.gender === "Female" ? "Husband" : p.gender === "Male" ? "Wife" : "Spouse";
  const bits = [];
  if (father) bits.push("Father: " + father.name); else if (mother) bits.push("Mother: " + mother.name); else if (pars[0]) bits.push("Parent: " + pars[0].name);
  if (sps.length) bits.push(spLabel + ": " + sps.join(", ")); else if (p.details?.marriage?.spouse) bits.push(spLabel + ": " + p.details.marriage.spouse);
  return bits.join(" · ");
}
/* Marriage date belongs to the COUPLE: use my own date, otherwise my spouse's. */
function marriageDateOf(p) {
  if (!p) return "";
  if (p.details?.marriage?.date) return p.details.marriage.date;
  for (const sid of spousesOf(p.id)) { const d = personById(sid)?.details?.marriage?.date; if (d) return d; }
  return "";
}
/* Short "who is the husband / wife" text for tree cards. Empty when the person is not married. */
function spouseCardLine(p) {
  if (!p) return "";
  const names = spousesOf(p.id).map(personById).filter(Boolean).map(x => x.name);
  if (!names.length && p.details?.married === "yes" && p.details?.marriage?.spouse) names.push(p.details.marriage.spouse);
  return names.length ? names[0] + (names.length > 1 ? " +" + (names.length - 1) : "") : "";
}
/* Setting the marriage date on the wife also sets it on the husband (and the other way round). */
function syncMarriageDate(id) {
  const p = personById(id); if (!p) return;
  const date = marriageDateOf(p); if (!date) return;
  [p, ...spousesOf(id).map(personById)].filter(Boolean).forEach(x => {
    if (x.details?.marriage?.date === date) return;
    if (x !== p && !canEditPerson(x)) return;   // someone else's own profile: it still shows the shared date (marriageDateOf)
    x.details = { ...(x.details || {}), married: "yes", marriage: { ...(x.details?.marriage || {}), date } };
  });
}
function clearSpouseMarriageDate(id) {
  spousesOf(id).map(personById).filter(x => x && x.details?.marriage?.date && canEditPerson(x))
    .forEach(x => { x.details = { ...x.details, marriage: { ...x.details.marriage, date: "" } }; });
}
function parentsOf(id) { return state.relationships.filter(r => r.type === "parent" && r.to === id).map(r => r.from); }
function childrenOf(id) { return state.relationships.filter(r => r.type === "parent" && r.from === id).map(r => r.to); }
function spousesOf(id) { return state.relationships.filter(r => r.type === "spouse" && (r.from === id || r.to === id)).map(r => r.from === id ? r.to : r.from); }
function siblingsOf(id) {
  const ps = parentsOf(id);
  const set = new Set();
  ps.forEach(p => childrenOf(p).forEach(c => { if (c !== id) set.add(c); }));
  return [...set];
}

/* Redirect/merge all edges from a removed person onto a kept person (acceptance test 8) */
function reassignEdges(removedId, keptId) {
  state.relationships = state.relationships
    .map(r => ({ ...r, from: r.from === removedId ? keptId : r.from, to: r.to === removedId ? keptId : r.to }))
    .filter(r => r.from !== r.to); // drop self-edges created by the merge
  // de-duplicate
  const seen = new Set(); const out = [];
  for (const r of state.relationships) {
    const key = r.type + ":" + (r.type === "spouse" ? [r.from, r.to].sort().join("-") : r.from + "-" + r.to);
    if (seen.has(key)) continue;
    seen.add(key); out.push(r);
  }
  state.relationships = out;
}

/* BFS shortest path between two people, returning a list of steps:
   { dir: 'up'|'down'|'spouse', personId } — 'up' = moved to a parent,
   'down' = moved to a child, 'spouse' = moved to a spouse. */
function findRelationshipPath(fromId, toId) {
  if (fromId === toId) return [];
  const visited = new Set([fromId]);
  const queue = [[fromId, []]];
  while (queue.length) {
    const [cur, path] = queue.shift();
    const neighbors = [
      ...parentsOf(cur).map(id => ({ id, dir: "up" })),
      ...childrenOf(cur).map(id => ({ id, dir: "down" })),
      ...spousesOf(cur).map(id => ({ id, dir: "spouse" }))
    ];
    for (const n of neighbors) {
      if (visited.has(n.id)) continue;
      const newPath = [...path, { dir: n.dir, personId: n.id }];
      if (n.id === toId) return newPath;
      visited.add(n.id);
      queue.push([n.id, newPath]);
    }
  }
  return null; // not connected
}

function ordinal(n) {
  const s = ["th", "st", "nd", "rd"], v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}
function repeat(str, n) { return n > 0 ? str.repeat(n) : ""; }

/* Turn an ups/downs generational distance into a relationship label. */
function labelFromUpsDowns(ups, downs, gender) {
  const pick = (m, f, n) => gender === "Male" ? m : gender === "Female" ? f : n;
  if (ups === 0 && downs === 0) return "Self";
  if (downs === 0) {
    if (ups === 1) return pick("Father", "Mother", "Parent");
    return repeat("Great-", ups - 2) + pick("Grandfather", "Grandmother", "Grandparent");
  }
  if (ups === 0) {
    if (downs === 1) return pick("Son", "Daughter", "Child");
    return repeat("Great-", downs - 2) + pick("Grandson", "Granddaughter", "Grandchild");
  }
  if (ups === 1 && downs === 1) return pick("Brother", "Sister", "Sibling");
  if (downs === 1) return repeat("Great-", ups - 2) + pick("Uncle", "Aunt", "Aunt/Uncle");
  if (ups === 1) {
    if (downs === 2) return pick("Nephew", "Niece", "Niece/Nephew");
    return repeat("Great-", downs - 3) + "Grand-" + pick("Nephew", "Niece", "Niece/Nephew");
  }
  const degree = Math.min(ups, downs) - 1, removed = Math.abs(ups - downs);
  return `${ordinal(degree)} cousin` + (removed ? `, ${removed}x removed` : "");
}

/* Full derivation: path -> { label, chainNames, hasInLaw } */
function deriveRelationship(fromId, toId) {
  const path = findRelationshipPath(fromId, toId);
  if (path === null) return { label: "Not connected", chain: [], path: null };
  if (path.length === 0) return { label: "Same person", chain: [personById(fromId)?.name], path: [] };
  const spouseHops = path.filter(s => s.dir === "spouse").length;
  const blood = path.filter(s => s.dir !== "spouse");
  const ups = blood.filter(s => s.dir === "up").length;
  const downs = blood.filter(s => s.dir === "down").length;
  const targetGender = personById(toId)?.gender;
  let label;
  if (blood.length === 0 && spouseHops === 1) {
    label = targetGender === "Male" ? "Husband" : targetGender === "Female" ? "Wife" : "Spouse";
  } else {
    label = labelFromUpsDowns(ups, downs, targetGender);
    if (spouseHops > 0) label += "-in-law";
  }
  const chain = [personById(fromId)?.name, ...path.map(s => personById(s.personId)?.name)];
  return { label, chain, path };
}

/* Generation index of every person reachable from `rootId` (0 = root,
   negative = ancestors, positive = descendants; spouses share their
   partner's generation). Used to lay the tree out in rows. */
/* A married woman's OWN parents/siblings are hidden in the default tree. They show only when
   her tree icon is clicked ("branch view"). */
function hidesParents(id) {
  const p = personById(id);
  return !!p && !p.me && p.gender === "Female" && spousesOf(id).length > 0 && parentsOf(id).length > 0;
}
let branchView = null; // { id, prevCenter } while a married woman's own family branch is open

function computeBranchGenerations(xId) {
  // Branch view of X: X + husband/wife; X's parents (and the other parent); X's brothers & sisters with their spouses and ALL their
  // descendants; and X's OWN children, their spouses, grandchildren... (X's in-laws' parents/siblings stay out).
  const gen = { [xId]: 0 };
  const place = (id, g) => { if (id && !(id in gen)) { gen[id] = g; return true; } return false; };
  const addSpouses = (id, g) => spousesOf(id).forEach(sp => place(sp, g));
  const down = (id, g) => childrenOf(id).forEach(c => { if (place(c, g + 1)) { addSpouses(c, g + 1); down(c, g + 1); } });
  addSpouses(xId, 0);
  const parents = parentsOf(xId);
  parents.forEach(pa => place(pa, -1));
  parents.forEach(pa => addSpouses(pa, -1));
  parents.forEach(pa => down(pa, -1));
  down(xId, 0);
  return gen;
}
function openBranch(id) {
  if (!personById(id)) return;
  if (!parentsOf(id).length) { toast("Is ke parents ki details abhi add nahi hain"); return; }
  if (!branchView) branchView = { prevCenter: treeCenterId };
  branchView.id = id;
  treeExpanded = new Set();
  // nobody of their own recorded yet (no wife/husband, no children): open with the "+ Add wife / son / daughter" boxes already showing
  if (!spousesOf(id).length && !childrenOf(id).length && canAddRelativeTo(id)) treeExpanded.add(id);
  treeCenterId = id; treeScale = 1;
  go("tree"); requestAnimationFrame(drawTreeConnectors);
}
function exitBranch() {
  if (!branchView) return;
  treeCenterId = branchView.prevCenter; branchView = null; treeExpanded = new Set(); treeScale = 1;
  go("tree"); requestAnimationFrame(drawTreeConnectors);
}

/* Default tree: me + my siblings (+ spouses, + all our children); my parents (+ their siblings, spouses and the
   uncles' children - a bua's husband shows but NOT her children); grandparents and higher ancestors with the
   BROTHERS of each ancestor and their wives (no children). A married woman's own parents/siblings stay hidden
   (they open from her tree icon). */
function computeDefaultGenerations(rootId) {
  const gen = {};
  const place = (id, g) => { if (id && !(id in gen)) { gen[id] = g; return true; } return false; };
  const addSpouses = (id, g) => spousesOf(id).forEach(sp => place(sp, g));
  const addDesc = (id, g) => childrenOf(id).forEach(c => { if (place(c, g + 1)) { addSpouses(c, g + 1); addDesc(c, g + 1); } });
  const sibs = id => { const out = new Set(); parentsOf(id).forEach(p => { if (p in gen) childrenOf(p).forEach(c => { if (c !== id) out.add(c); }); }); return [...out]; };
  const isFemale = id => (personById(id) || {}).gender === "Female";
  place(rootId, 0); addSpouses(rootId, 0);
  // ancestors, level by level (a married woman's own parents are not walked)
  const levels = [];
  let frontier = [rootId], g = 0;
  while (frontier.length) {
    const next = [];
    frontier.forEach(id => {
      if (id !== rootId && hidesParents(id)) return;
      parentsOf(id).forEach(p => { place(p, g - 1); if (!next.includes(p)) next.push(p); });
    });
    g--;
    next.forEach(p => addSpouses(p, g));
    if (next.length) levels.push(next);
    frontier = next;
  }
  // my own generation: siblings + spouses + everybody's children
  sibs(rootId).forEach(sb => { if (place(sb, 0)) addSpouses(sb, 0); });
  addDesc(rootId, 0);
  sibs(rootId).forEach(sb => addDesc(sb, 0));
  // siblings of my ancestors
  levels.forEach((lvl, i) => {
    const k = i + 1, lg = -k;
    lvl.forEach(a => sibs(a).forEach(sb => {
      if (isFemale(sb) && k > 1) return;               // dada's sisters etc: not shown
      if (place(sb, lg)) {
        addSpouses(sb, lg);                              // uncle's wife / bua's husband
        if (k === 1 && !isFemale(sb)) childrenOf(sb).forEach(c => place(c, lg + 1)); // cousins only via uncles, not via bua
      }
    }));
  });
  return gen;
}

function computeGenerations(rootId) {
  if (branchView) return computeBranchGenerations(branchView.id);
  if (!treeViewing) return computeDefaultGenerations(rootId);
  const gen = { [rootId]: 0 };
  const queue = [rootId];
  while (queue.length) {
    const cur = queue.shift();
    const g = gen[cur];
    // Married-in women (and relatives with their OWN account/tree) are shown as a card, but THEIR parents/siblings
    // are not pulled into this tree; they open via the top-right tree icon on that card.
    const cp = personById(cur) || {};
    const ownAcct = !treeViewing && !!cp.claimed_by && !cp.me && cp.claimed_by !== (currentUser && currentUser.id);
    const boundary = cur !== rootId && (ownAcct || (!treeViewing && hidesParents(cur)));
    if (!boundary) parentsOf(cur).forEach(id => { if (!(id in gen)) { gen[id] = g - 1; queue.push(id); } });
    childrenOf(cur).forEach(id => { if (!(id in gen)) { gen[id] = g + 1; queue.push(id); } });
    spousesOf(cur).forEach(id => { if (!(id in gen)) { gen[id] = g; queue.push(id); } });
  }
  return gen;
}

/* ---------------- nav config ---------------- */
const INDIAN_STATES = ["Andaman and Nicobar Islands", "Andhra Pradesh", "Arunachal Pradesh", "Assam", "Bihar", "Chandigarh", "Chhattisgarh", "Dadra and Nagar Haveli and Daman and Diu", "Delhi", "Goa", "Gujarat", "Haryana", "Himachal Pradesh", "Jammu and Kashmir", "Jharkhand", "Karnataka", "Kerala", "Ladakh", "Lakshadweep", "Madhya Pradesh", "Maharashtra", "Manipur", "Meghalaya", "Mizoram", "Nagaland", "Odisha", "Puducherry", "Punjab", "Rajasthan", "Sikkim", "Tamil Nadu", "Telangana", "Tripura", "Uttar Pradesh", "Uttarakhand", "West Bengal"];
/* State dropdown. A saved value that is not in the list (older free-text entry, or another country) stays selectable so nothing is lost. */
function stateSelectHTML(id, current, cityPrefix) {
  const cur = String(current || "").trim();
  const extra = cur && !INDIAN_STATES.some(s => s.toLowerCase() === cur.toLowerCase()) ? [cur] : [];
  const match = s => cur && s.toLowerCase() === cur.toLowerCase();
  return `<select id="${id}" ${cityPrefix ? `onchange="cityStateChanged('${cityPrefix}')"` : ""}><option value="">— Select state —</option>${[...INDIAN_STATES, ...extra].map(s => `<option value="${esc(s)}" ${match(s) || (extra.length && s === cur) ? "selected" : ""}>${esc(s)}</option>`).join("")}</select>`;
}
/* ---------------- City dropdown that follows the State ----------------
   Cities come from /data/india-cities.json (loaded once, ~19 KB gzipped). The real value always lives in the text input
   #<prefix>City (so every existing save/read keeps working); the <select> is just a picker on top of it. Villages / places that are
   not in the list: choose "Other" and type them. If the file cannot load, the field simply stays a normal text box. */
let CITY_DATA = null, cityLoading = null;
function loadCities() {
  if (CITY_DATA) return Promise.resolve(CITY_DATA);
  if (!cityLoading) cityLoading = fetch("/data/india-cities.json").then(r => r.ok ? r.json() : null).then(j => (CITY_DATA = j)).catch(() => null);
  return cityLoading;
}
function cityFieldHTML(prefix, current) {
  return `<select id="${prefix}CitySel" data-city-prefix="${prefix}" onchange="cityPicked('${prefix}')" style="display:none"></select>
    <input id="${prefix}City" value="${esc(current || "")}" placeholder="Pehle state chunein, ya yahin shehar likhein" style="margin-top:6px">`;
}
function syncCityWidget(prefix) {
  const sel = document.getElementById(prefix + "CitySel"), inp = document.getElementById(prefix + "City"), st = document.getElementById(prefix + "State");
  if (!sel || !inp) return;
  const list = CITY_DATA && st && CITY_DATA[st.value];
  if (!list || !list.length) { sel.style.display = "none"; inp.style.display = ""; inp.placeholder = "Shehar / gaon likhein"; sel.dataset.state = st ? st.value : ""; return; }
  const cur = inp.value.trim();
  const inList = list.find(c => c.toLowerCase() === cur.toLowerCase());
  sel.innerHTML = `<option value="">— Select city —</option>` + list.map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join("") + `<option value="__other__">Other (type manually)…</option>`;
  sel.style.display = "";
  if (inList) { sel.value = inList; inp.value = inList; inp.style.display = "none"; }
  else if (cur) { sel.value = "__other__"; inp.style.display = ""; inp.placeholder = "Shehar / gaon likhein"; }
  else { sel.value = ""; inp.style.display = "none"; }
  sel.dataset.state = st.value;
}
function cityPicked(prefix) {
  const sel = document.getElementById(prefix + "CitySel"), inp = document.getElementById(prefix + "City"); if (!sel || !inp) return;
  if (sel.value === "__other__") { inp.value = ""; inp.style.display = ""; inp.placeholder = "Shehar / gaon likhein"; inp.focus(); }
  else { inp.value = sel.value; inp.style.display = "none"; }
}
async function cityStateChanged(prefix) {
  const sel = document.getElementById(prefix + "CitySel"), inp = document.getElementById(prefix + "City"); if (!sel || !inp) return;
  await loadCities();
  const prevList = (CITY_DATA && CITY_DATA[sel.dataset.state]) || [];
  // a city that was PICKED from the old state's list no longer applies; something the user typed is kept
  if (prevList.some(c => c.toLowerCase() === inp.value.trim().toLowerCase())) inp.value = "";
  syncCityWidget(prefix);
}
/* Fill every city picker that appears on screen (profile edit, add relative…), whichever way it was rendered. */
function initCityPickers() {
  document.querySelectorAll("select[data-city-prefix]:not([data-ready])").forEach(sel => {
    sel.dataset.ready = "1";
    const p = sel.dataset.cityPrefix;
    loadCities().then(() => syncCityWidget(p));
  });
}
let cityObserverQueued = false;
new MutationObserver(() => { if (cityObserverQueued) return; cityObserverQueued = true; requestAnimationFrame(() => { cityObserverQueued = false; initCityPickers(); }); })
  .observe(document.body, { childList: true, subtree: true });
/* Dashboard "Poora horoscope dekhein": paste a full https:// address here to open that site in a new tab; leave "" to open the in-app Horoscope page. */
const HOROSCOPE_URL = "";
const GAMES_URL = "https://games.1infinity.online/games/auth.html?redirect=index.html";
const NAV = [
  { group: "Family", items: [
    ["home", "Home", "🏠"], ["tree", "My Tree", "img:/assets/tree-logo-icon.png"], ["people", "People", "👨‍👩‍👧"],
    ["add", "Add Person", "➕"], ["merge", "Merge", "🔀"], ["importGed", "Import GEDCOM", "📥"], ["relationship", "Relationship", "🔗"], ["horoscope", "Horoscope", "img:/assets/horoscope-icon.png"],
    ["treeAdmins", "Tree Admins", "👑"]
  ]},
  { group: "Social", items: [
    ["wall", "Family Wall", "📝"], ["events", "Events", "📅"], ["sharing", "Connections", "🔗🤝"], ["games", "Games", "🎮"]
  ]},
  { group: "Account", items: [
    ["profile", "My Profile", "👤"], ["support", "Support", "🎧"]
  ]}
];
const ADMIN_NAV = { group: "Admin", items: [ ["admin", "Admin & Safety", "🛡️"], ["production", "Production", "🚀"] ] };

function navHTML(page, withLogout = true) {
  const groups = NAV.map(g => ({ group: g.group, items: g.items.filter(([id]) => (id !== "add" || canEditTree()) && true) }));
  if (isStaff()) groups.push(ADMIN_NAV);
  return groups.map(g => `<div class="navgroup"><div class="navgroup-label">${g.group}</div>${
    g.items.map(([id, label, icon]) => navItem(id, label, icon, page)).join("")
  }</div>`).join("") + (withLogout ? `<button class="nav logout" onclick="logout()"><span class="ic">🚪</span><span>Logout</span></button>` : "");
}
function navItem(id, label, icon, page) {
  const ic = String(icon).startsWith("img:") ? `<img class="nav-img" src="${esc(String(icon).slice(4))}" alt="" width="22" height="22">` : icon;   // "img:/path.png" = picture icon
  return `<button class="nav ${page === id ? "active" : ""}" onclick="go('${id}')"><span class="ic">${ic}</span><span>${label}</span></button>`;
}
/* Phones: the sidebar is hidden, so every page that is not a bottom tab lives in this "More" sheet. */
const BOTTOM_TABS = ["home", "tree", "people", "wall", "horoscope"];   // Chat is inside the Wall feed now
const BOTTOM_LABELS = { tree: "Tree", wall: "Wall" };
function openMoreMenu() {
  closeMoreMenu();
  const page = (location.hash || "#home").slice(1);
  const el = document.createElement("div");
  el.id = "moreSheet"; el.className = "modal-overlay";
  el.setAttribute("role", "dialog"); el.setAttribute("aria-label", "Menu");
  el.addEventListener("click", e => { if (e.target === el || (e.target.closest && e.target.closest(".nav, .more-close"))) closeMoreMenu(); });
  el.innerHTML = `<div class="modal-card more-sheet"><div class="modal-head"><h3>Menu</h3><button type="button" class="iconbtn more-close" aria-label="Close menu">✕</button></div><div class="modal-body more-body">${navHTML(page, false)}</div></div>`;
  document.body.appendChild(el);
}
function closeMoreMenu() { const el = document.getElementById("moreSheet"); if (el) el.remove(); }
document.addEventListener("keydown", e => { if (e.key === "Escape") closeMoreMenu(); });
function go(id) {
  if (id === "games") { window.open(GAMES_URL, "_blank", "noopener"); return; } // external site: open in a new tab, stay on the dashboard
  location.hash = id; window.scrollTo(0, 0); render();
}
function gamesPage() { // only reached by typing #games in the address bar
  return `<div class="page-head"><h2>🎮 Games</h2><p class="muted">Games alag site par khulte hain.</p></div><div class="card"><a class="primary" style="display:inline-block;padding:10px 18px;border-radius:12px;text-decoration:none" href="${GAMES_URL}" target="_blank" rel="noopener">🎮 Open Games ↗</a></div>`;
}

/* ---------------- login ---------------- */
function renderLogin() {
  document.getElementById("app").innerHTML = `<main class="login"><section class="login-card">
  <div class="eyebrow">Welcome to</div>
  <div class="brand"><img src="/assets/logo.png" alt="FamilyTree" style="height:64px;width:64px;object-fit:contain;vertical-align:middle;margin-right:8px"><span>Family<em>Tree</em></span></div>
  <h1>Roots, remembered.</h1>
  <p class="muted">Build your family tree, connect with relatives, and keep memories in one place.</p>
  ${localStorage.getItem(INVITE_KEY) ? `<div class="card" style="margin:14px 0;border-left:4px solid var(--gold,#e0a526)"><b>🔗 Aapko family tree ka invite mila hai.</b><br><span class="muted" style="font-size:13px">Neeche login karo — uske baad aap invite accept kar paoge.</span></div>` : ''}
  ${!supabaseConfigured ? `<div class="card" style="margin:14px 0"><strong>Supabase is not configured.</strong><p class="muted">Add VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY in Vercel/local environment variables.</p></div>` : ''}
  <div class="login-actions">
    <button class="primary full" onclick="googleLogin()">Continue with Google</button>
    <button class="ghost full" onclick="phoneLogin()">📱 Continue with Mobile OTP</button>
  </div>
  <p class="muted" style="font-size:12px;margin-top:18px">Production authentication is powered by Supabase Auth.</p>
  </section></main>`;
}
async function googleLogin() { try { await signInWithGoogle(); } catch(e) { toast(e.message); } }
async function phoneLogin() {
  if (!supabase) return toast('Supabase is not configured');
  const phone = prompt('Enter mobile number with country code, e.g. +9198XXXXXXXX'); if (!phone) return;
  try { await sendPhoneOtp(phone); const otp = prompt('Enter the OTP you received'); if (!otp) return; await verifyPhoneOtp(phone, otp); await bootAuthenticatedApp(); } catch(e) { toast(e.message); }
}
async function logout() { skipClaimSearch = false; if (supabase) await supabase.auth.signOut(); loggedIn = false; currentUser = null; state = { account: {}, people: [], relationships: [], connections: [], mergeRequests: [], events: [], posts: [], tickets: [], audit: [], treeId: null, joined: null }; location.hash = 'home'; render(); }

/* ---------------- shell ---------------- */
function topCenterHTML(page) {
  if (page !== "tree" && page !== "wall" && page !== "events") return "";
  const search = page === "tree" ? `<div class="top-search-wrap"><input id="treeSearch" class="top-search" placeholder="Search name, nickname or Person ID…" autocomplete="off" oninput="treeSearchInput(this.value)" onfocus="treeSearchInput(this.value)" onkeydown="treeSearchKey(event)"><div id="treeSearchResults" class="search-results" hidden></div></div>` : "";
  return `<div class="topbar-center"><span class="top-title">${treeViewing ? esc(treeViewing.ownerName) + "'s Family Tree" : "My Family Tree"}</span>${search}${page === "tree" ? treeStyleSwitchHTML() : `<div class="view-switch"><button class="${page === "wall" ? "active" : ""}" onclick="go('wall')">Family Wall</button><button class="${page === "events" ? "active" : ""}" onclick="go('events')">📅 Events</button></div>`}</div>`;
}
function render() {
  if (!loggedIn) { renderLogin(); return; }
  let page = (location.hash || "#home").slice(1);
  if (page === "chat") { history.replaceState(null, "", "#wall"); page = "wall"; setTimeout(openChatSheet, 0); }   // old #chat links: Wall + chat sheet
  if (treeViewing && page !== "tree" && page !== "profile") exitTreeView(false);
  if (!document.getElementById("chatSheet")) teardownChat();
  const app = document.getElementById("app");
  const navPage = page === "events" ? "wall" : page;   // Events is inside the Wall tab
  const flatNav = NAV.flatMap(g => g.items).filter(([id]) => id !== "add" || canEditTree()).concat(isStaff() ? ADMIN_NAV.items : []);
  app.innerHTML = `<div class="shell">
    <header class="topbar">
      <div class="brand"><img src="/assets/logo.png" alt="FamilyTree" style="height:32px;width:32px;object-fit:contain;vertical-align:middle;margin-right:6px"><span>Family<em>Tree</em></span><small>V11</small></div>
      ${topCenterHTML(page)}
      <div class="top-actions">
        
        <span class="muted top-name" style="font-size:13px;cursor:pointer" title="My Profile" onclick="openMyProfile()">${esc(state.account.name)}</span>
        <div style="cursor:pointer" title="My Profile" onclick="openMyProfile()">${myself() ? avatarHTML(myself()) : `<div class="avatar">${esc(initials(state.account.name))}</div>`}</div>
        ${page === "home" ? `<button type="button" class="top-logout" title="Logout" onclick="logout()">🚪 Logout</button>` : ""}
      </div>
    </header>
    <div class="layout">
      <aside class="sidebar">${navHTML(page)}</aside>
      <main class="content${page === "tree" ? " content-wide" : ""}">${joinBannerHTML()}${pageView(page)}</main>
    </div>
    <nav class="bottomnav">${BOTTOM_TABS.map(id => flatNav.find(x => x[0] === id)).filter(Boolean).map(([id, label, icon]) => navItem(id, BOTTOM_LABELS[id] || label, icon, navPage).replace("</button>", id === "wall" ? '<i class="dm-badge dm-dot" hidden></i></button>' : "</button>")).join("")}<button class="nav ${BOTTOM_TABS.includes(navPage) ? "" : "active"}" onclick="openMoreMenu()" aria-label="More pages"><span class="ic">☰</span><span>More</span></button></nav>
  </div>`;
  if (page === "tree") requestAnimationFrame(treeStyle === "chart" ? chartAfterRender : drawTreeConnectors);
  if (page === "home") requestAnimationFrame(dailyQuoteInit);
  if (page === "wall") requestAnimationFrame(loadWallFeed);
  if (page === "horoscope") requestAnimationFrame(loadHoroscope);
  if (page === "merge") mergeInitSelects();
  if (page === "profile") requestAnimationFrame(() => loadMemories(activeProfileId || me()?.id));
  refreshDmBadge();
}
function switchRole() {}

function pageView(p) {
  const map = {
    home, tree, add, addRelative, people, merge, relationship, profile: () => profile(activeProfileId || me().id),
    wall, events: eventsPage, sharing, support, admin, production, treeAdmins, importGed, horoscope: horoscopePage, games: gamesPage
  };
  if ((p === "admin" || p === "production") && !isStaff()) return accessDenied();
  if (p === "add" && !canEditTree()) return accessDenied("Tree admin access required", "Only this tree's owner or admins can add relatives. Ask the owner to promote you from the Tree Admins page.");
  if (p === "addRelative" && !canAddRelativeTo(addRelativeTargetId)) return accessDenied("Tree admin access required", "Only this tree's owner or admins can add relatives to other people. Ask the owner to promote you from the Tree Admins page.");
  return (map[p] || home)();
}
function accessDenied(title, msg) {
  return `<div class="empty card"><span class="big">🔒</span><h3>${esc(title || "Staff access required")}</h3><p class="muted">${esc(msg || "Switch the demo role selector above to Admin or Support to view this area.")}</p></div>`;
}

/* ---------------- Horoscope (FreeHoroscopeAPI — https://freehoroscopeapi.com) ---------------- */
const HORO_API = "https://freehoroscopeapi.com/api/v1/get-horoscope";
const HORO_SIGNS = [
  ["capricorn", "♑", 1, 19], ["aquarius", "♒", 2, 18], ["pisces", "♓", 3, 20], ["aries", "♈", 4, 19],
  ["taurus", "♉", 5, 20], ["gemini", "♊", 6, 20], ["cancer", "♋", 7, 22], ["leo", "♌", 8, 22],
  ["virgo", "♍", 9, 22], ["libra", "♎", 10, 22], ["scorpio", "♏", 11, 21], ["sagittarius", "♐", 12, 21], ["capricorn", "♑", 12, 31]
]; // [sign, symbol, month, last day (inclusive) of that sign in that month]
const horoCache = new Map();   // "sign|period|YYYY-MM-DD" -> data
let horoState = { personId: null, sign: null, period: "daily" };
function signFromDob(dob) {
  if (!dob) return null;
  let m, d;
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(dob));
  if (iso) { m = +iso[2]; d = +iso[3]; }
  else { const x = new Date(dob); if (Number.isNaN(x.getTime())) return null; m = x.getMonth() + 1; d = x.getDate(); }
  const hit = HORO_SIGNS.find(([, , mm, last]) => m < mm || (m === mm && d <= last));
  return hit ? hit[0] : null;
}
function horoSymbol(sign) { return (HORO_SIGNS.find(x => x[0] === sign) || [])[1] || "✨"; }
/* Vedic rashi (sidereal Moon sign) computed locally from DOB + birth time.
   Moon longitude: Meeus ch.47 (main terms, ~0.05-0.1 deg), minus Lahiri ayanamsa. Birth time is taken as IST (UTC+5:30). */
const MOON_TERMS = [[0,0,1,0,6288774],[2,0,-1,0,1274027],[2,0,0,0,658314],[0,0,2,0,213618],[0,1,0,0,-185116],[0,0,0,2,-114332],[2,0,-2,0,58793],[2,-1,-1,0,57066],[2,0,1,0,53322],[2,-1,0,0,45758],[0,1,-1,0,-40923],[1,0,0,0,-34720],[0,1,1,0,-30383],[2,0,0,-2,15327],[0,0,1,2,-12528],[0,0,1,-2,10980],[4,0,-1,0,10675],[0,0,3,0,10034],[4,0,-2,0,8548],[2,1,-1,0,-7888],[2,1,0,0,-6766],[1,0,-1,0,-5163],[1,1,0,0,4987],[2,-1,1,0,4036],[2,0,2,0,3994],[4,0,0,0,3861],[2,0,-3,0,3665]];
const RASHI = [["aries","Mesh"],["taurus","Vrishabh"],["gemini","Mithun"],["cancer","Kark"],["leo","Singh"],["virgo","Kanya"],["libra","Tula"],["scorpio","Vrishchik"],["sagittarius","Dhanu"],["capricorn","Makar"],["aquarius","Kumbh"],["pisces","Meen"]];
const NAKSHATRAS = ["Ashwini","Bharani","Krittika","Rohini","Mrigashira","Ardra","Punarvasu","Pushya","Ashlesha","Magha","Purva Phalguni","Uttara Phalguni","Hasta","Chitra","Swati","Vishakha","Anuradha","Jyeshtha","Mula","Purva Ashadha","Uttara Ashadha","Shravana","Dhanishta","Shatabhisha","Purva Bhadrapada","Uttara Bhadrapada","Revati"];
function moonSiderealLongitude(jd) {
  const T = (jd - 2451545.0) / 36525, rad = Math.PI / 180, mod = x => ((x % 360) + 360) % 360;
  const L = mod(218.3164477 + 481267.88123421 * T), D = mod(297.8501921 + 445267.1114034 * T),
    M = mod(357.5291092 + 35999.0502909 * T), Mp = mod(134.9633964 + 477198.8675055 * T), F = mod(93.272095 + 483202.0175233 * T);
  const E = 1 - 0.002516 * T;
  let sum = 0;
  for (const [d, m, mp, f, c] of MOON_TERMS) sum += c * Math.pow(E, Math.abs(m)) * Math.sin((d * D + m * M + mp * Mp + f * F) * rad);
  const A1 = mod(119.75 + 131.849 * T), A2 = mod(53.09 + 479264.29 * T);
  sum += 3958 * Math.sin(A1 * rad) + 1962 * Math.sin((L - F) * rad) + 318 * Math.sin(A2 * rad);
  const tropical = mod(L + sum / 1e6);
  const ayanamsa = 23.85306 + 0.01396 * ((jd - 2451545.0) / 365.25); // Lahiri
  return mod(tropical - ayanamsa);
}
function rashiFromBirth(dob, time) {
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(dob || "")), tm = /^(\d{1,2}):(\d{2})/.exec(String(time || ""));
  if (!iso || !tm) return null;
  const utc = Date.UTC(+iso[1], +iso[2] - 1, +iso[3], +tm[1], +tm[2]) - 5.5 * 3600e3; // IST -> UTC
  const lon = moonSiderealLongitude(utc / 86400000 + 2440587.5);
  const r = RASHI[Math.floor(lon / 30)];
  return { sign: r[0], hindi: r[1], nakshatra: NAKSHATRAS[Math.floor(lon / (360 / 27))], pada: Math.floor((lon % (360 / 27)) / (360 / 108)) + 1 };
}
function horoCardHTML() {
  // Based ONLY on the logged-in user's own profile: DOB + birth time -> Vedic rashi (Moon sign).
  const m = myself();
  const r = m ? rashiFromBirth(normalizeDate(m.dob) || m.dob, m.details?.birth_time) : null;
  horoState.sign = r ? r.sign : null; horoState.rashi = r;
  if (!r) {
    const missing = !m?.dob ? "Date of Birth aur Birth time" : "Birth time";
    return `<div class="card" id="horoCard"><h3>🔮 Aapka Horoscope</h3>
      <p class="muted">Apni <b>rashi</b> ka horoscope dekhne ke liye profile complete karein — ${missing} bharna zaroori hai (rashi Moon se nikalti hai, jo time par depend karta hai).</p>
      ${m ? `<button type="button" class="primary" onclick="openEditProfile('${esc(m.id)}', false)">✏️ Profile complete karein</button>` : ""}
    </div>`;
  }
  const tabs = ["daily", "weekly", "monthly"].map(pr => `<button type="button" class="${pr === horoState.period ? "primary" : "secondary"}" onclick="setHoroscope({period:'${pr}'})">${pr[0].toUpperCase() + pr.slice(1)}</button>`).join("");
  return `<div class="card" id="horoCard"><h3>🔮 Aapka Horoscope</h3>
    <div class="muted" style="margin-bottom:8px;font-size:13px">${horoSymbol(r.sign)} Rashi: <b>${r.hindi} (${r.sign[0].toUpperCase() + r.sign.slice(1)})</b> · Nakshatra: ${r.nakshatra} (pada ${r.pada})</div>
    <div class="actions" style="margin-bottom:10px">${tabs}</div>
    <div id="horoBody" class="muted">Loading…</div>
    <div class="muted" style="font-size:11.5px;margin-top:10px">Powered by <a href="https://freehoroscopeapi.com" target="_blank" rel="noopener">FreeHoroscopeAPI</a> · Vedic rashi (Moon sign, Lahiri), birth time IST maana gaya. Entertainment only.</div>
  </div>`;
}
function setHoroscope(patch) {
  if (patch.period) horoState.period = patch.period;
  const card = document.getElementById("horoCard");
  if (card) { card.outerHTML = horoCardHTML(); loadHoroscope(); }
}
async function loadHoroscope() {
  const body = document.getElementById("horoBody");
  if (!body || !horoState.sign) return;
  const { sign, period } = horoState;
  const key = `${sign}|${period}|${new Date().toISOString().slice(0, 10)}`;
  const show = d => {
    const el = document.getElementById("horoBody");
    if (!el || horoState.sign !== sign || horoState.period !== period) return; // user moved on
    el.className = "";
    el.innerHTML = `<div style="font-weight:600;margin-bottom:2px">${horoSymbol(sign)} ${esc(d.sign || sign)} · ${esc(d.period || period)} · <span class="muted" style="font-weight:400">${esc(d.date || "")}</span></div><p style="margin:0;line-height:1.55">${esc(d.horoscope)}</p>`;
  };
  if (horoCache.has(key)) return show(horoCache.get(key));
  body.className = "muted"; body.textContent = "Loading…";
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 12000);
    const r = await fetch(`${HORO_API}/${period}?sign=${encodeURIComponent(sign)}`, { signal: ctrl.signal });
    clearTimeout(t);
    const j = await r.json();
    if (!r.ok || !j?.data?.horoscope) throw new Error(j?.error || `HTTP ${r.status}`);
    horoCache.set(key, j.data);
    show(j.data);
  } catch (e) {
    const el = document.getElementById("horoBody");
    if (el && horoState.sign === sign && horoState.period === period) {
      el.className = "muted";
      el.innerHTML = `Horoscope abhi load nahi ho paya. <button type="button" class="ghost" onclick="loadHoroscope()">Retry</button>`;
    }
  }
}

/* ---------------- import (moved from dashboard; lives under More) ---------------- */
function importGed() {
  return `<div class="page-head"><h2>Import GEDCOM</h2><p class="muted">Dusre apps se family tree laayein.</p></div>
  <div class="card"><h3>Import from GEDCOM</h3>
    <p class="muted">Upload a .ged file (from iMeUsWe, Ancestry, MyHeritage, etc.) to add all its people and relationships to your tree.</p>
    <div class="actions">
      <button class="primary" onclick="document.getElementById('gedFile').click()">📥 Import .ged file</button>
      <input type="file" id="gedFile" accept=".ged,.gedcom" hidden onchange="importGedcomPicked(this)">
    </div>
  </div>`;
}

/* ---------------- Horoscope tab: Panchang, Rahu Kaal, Tarot, Family Rashi (all computed locally, IST) ---------------- */
const TITHIS = ["Pratipada","Dwitiya","Tritiya","Chaturthi","Panchami","Shashthi","Saptami","Ashtami","Navami","Dashami","Ekadashi","Dwadashi","Trayodashi","Chaturdashi"];
const YOGAS = ["Vishkambha","Priti","Ayushman","Saubhagya","Shobhana","Atiganda","Sukarma","Dhriti","Shula","Ganda","Vriddhi","Dhruva","Vyaghata","Harshana","Vajra","Siddhi","Vyatipata","Variyana","Parigha","Shiva","Siddha","Sadhya","Shubha","Shukla","Brahma","Indra","Vaidhriti"];
const KARANAS_MOVABLE = ["Bava","Balava","Kaulava","Taitila","Gara","Vanija","Vishti (Bhadra)"];
const WEEKDAYS = ["Ravivar (Sunday)","Somvar (Monday)","Mangalvar (Tuesday)","Budhvar (Wednesday)","Guruvar (Thursday)","Shukravar (Friday)","Shanivar (Saturday)"];
const RAHU_SEGMENT = [8, 2, 7, 5, 6, 4, 3]; // Sun..Sat -> which 1/8th of the day (from sunrise) is Rahu Kaal
const HORO_CITIES = [["Delhi",28.6139,77.209],["Gurugram",28.4595,77.0266],["Mumbai",19.076,72.8777],["Pune",18.5204,73.8567],["Kolkata",22.5726,88.3639],["Chennai",13.0827,80.2707],["Bengaluru",12.9716,77.5946],["Hyderabad",17.385,78.4867],["Ahmedabad",23.0225,72.5714],["Jaipur",26.9124,75.7873],["Lucknow",26.8467,80.9462],["Varanasi",25.3176,82.9739],["Patna",25.5941,85.1376],["Bhopal",23.2599,77.4126],["Indore",22.7196,75.8577],["Chandigarh",30.7333,76.7794]];
function mod360(x) { return ((x % 360) + 360) % 360; }
function ayanamsaAt(jd) { return 23.85306 + 0.01396 * ((jd - 2451545.0) / 365.25); } // Lahiri
function sunSiderealLongitude(jd) {
  const T = (jd - 2451545.0) / 36525, rad = Math.PI / 180;
  const L0 = mod360(280.46646 + 36000.76983 * T), M = mod360(357.52911 + 35999.05029 * T - 0.0001537 * T * T);
  const C = (1.914602 - 0.004817 * T) * Math.sin(M * rad) + 0.019993 * Math.sin(2 * M * rad) + 0.000289 * Math.sin(3 * M * rad);
  const om = 125.04 - 1934.136 * T;
  return mod360(L0 + C - 0.00569 - 0.00478 * Math.sin(om * rad) - ayanamsaAt(jd));
}
function panchangAt(jd) {
  const ms = moonSiderealLongitude(jd), ss = sunSiderealLongitude(jd), el = mod360(ms - ss);
  const tn = Math.floor(el / 12) + 1;                         // 1..30
  const tithi = tn === 15 ? "Purnima" : tn === 30 ? "Amavasya" : TITHIS[(tn - 1) % 15];
  const k = Math.floor(el / 6);                               // 0..59 half-tithis
  const karana = k === 0 ? "Kimstughna" : k === 57 ? "Shakuni" : k === 58 ? "Chatushpada" : k === 59 ? "Naga" : KARANAS_MOVABLE[(k - 1) % 7];
  return { tithi, tn, paksha: tn <= 15 ? "Shukla" : "Krishna", yoga: YOGAS[Math.floor(mod360(ms + ss) / (360 / 27))], karana,
    nakshatra: NAKSHATRAS[Math.floor(ms / (360 / 27))], moonRashi: RASHI[Math.floor(ms / 30)][1], sunRashi: RASHI[Math.floor(ss / 30)][1] };
}
function sunTimesIST(y, m, d, lat, lng) { // minutes after local (IST) midnight; NOAA algorithm, ~1-2 min accuracy
  const rad = Math.PI / 180, jd = Date.UTC(y, m - 1, d, 6, 30) / 86400000 + 2440587.5, T = (jd - 2451545.0) / 36525;
  const L0 = mod360(280.46646 + T * (36000.76983 + T * 0.0003032)), M = 357.52911 + T * (35999.05029 - 0.0001537 * T);
  const e = 0.016708634 - T * (0.000042037 + 0.0000001267 * T);
  const C = Math.sin(M * rad) * (1.914602 - T * (0.004817 + 0.000014 * T)) + Math.sin(2 * M * rad) * (0.019993 - 0.000101 * T) + Math.sin(3 * M * rad) * 0.000289;
  const om = 125.04 - 1934.136 * T, app = L0 + C - 0.00569 - 0.00478 * Math.sin(om * rad);
  const ob = 23 + (26 + (21.448 - T * (46.815 + T * (0.00059 - T * 0.001813))) / 60) / 60 + 0.00256 * Math.cos(om * rad);
  const decl = Math.asin(Math.sin(ob * rad) * Math.sin(app * rad)), vy = Math.tan(ob * rad / 2) ** 2;
  const eqT = 4 * (vy * Math.sin(2 * L0 * rad) - 2 * e * Math.sin(M * rad) + 4 * e * vy * Math.sin(M * rad) * Math.cos(2 * L0 * rad) - 0.5 * vy * vy * Math.sin(4 * L0 * rad) - 1.25 * e * e * Math.sin(2 * M * rad)) / rad;
  const ha = Math.acos(Math.cos(90.833 * rad) / (Math.cos(lat * rad) * Math.cos(decl)) - Math.tan(lat * rad) * Math.tan(decl)) / rad;
  const noon = 720 - 4 * lng - eqT;
  return { rise: noon - 4 * ha + 330, set: noon + 4 * ha + 330 };
}
function istNowParts() { const t = new Date(Date.now() + 5.5 * 3600e3); return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate(), wd: t.getUTCDay() }; }
function fmtMin(x) { let t = Math.round(x), h = Math.floor(t / 60) % 24, mm = t % 60; return `${h % 12 || 12}:${String(mm).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`; }
function horoCity() {
  if (!horoState.city) {
    const c = String(myself()?.details?.city || "").trim().toLowerCase();
    horoState.city = (HORO_CITIES.find(x => c && x[0].toLowerCase() === c) || HORO_CITIES[0])[0];
  }
  return HORO_CITIES.find(x => x[0] === horoState.city) || HORO_CITIES[0];
}
function setHoroCity(name) { horoState.city = name; const el = document.getElementById("horoPlaceCards"); if (el) el.innerHTML = horoPlaceCardsHTML(); }
function horoPlaceCardsHTML() {
  const [name, lat, lng] = horoCity(), t = istNowParts(), st = sunTimesIST(t.y, t.m, t.d, lat, lng);
  const pj = panchangAt(Date.UTC(t.y, t.m - 1, t.d) / 86400000 + 2440587.5 + (st.rise - 330) / 1440);
  const seg = (st.set - st.rise) / 8, rs = st.rise + (RAHU_SEGMENT[t.wd] - 1) * seg;
  const row = (a, b) => `<div class="row"><span class="muted">${a}</span><span>${esc(b)}</span></div>`;
  return `<div class="card"><h3>🪔 Aaj ka Panchang</h3>
      ${row("Din", WEEKDAYS[t.wd])}${row("Tithi", `${pj.paksha} ${pj.tithi}`)}${row("Nakshatra", pj.nakshatra)}${row("Yoga", pj.yoga)}${row("Karana", pj.karana)}${row("Chandra rashi", pj.moonRashi)}${row("Surya rashi (nirayana)", pj.sunRashi)}
      <div class="muted" style="font-size:11.5px;margin-top:8px">Sooryoday ke samay ka panchang · ${esc(name)} · tithi/nakshatra din mein badalte hain.</div></div>
    <div class="card"><h3>🌅 Rahu Kaal aur Sun timing</h3>
      ${row("Sunrise", fmtMin(st.rise))}${row("Sunset", fmtMin(st.set))}${row("Rahu Kaal", `${fmtMin(rs)} – ${fmtMin(rs + seg)}`)}
      <div class="muted" style="font-size:11.5px;margin-top:8px">Rahu Kaal mein naya shubh kaam shuru karne se parhez kiya jata hai (parampara). Approx. ±2 min.</div></div>`;
}
/* ---- Tarot ---- */
const TAROT_MAJOR = [["The Fool","naya shuruaat, bharosa, risk lena"],["The Magician","ichchashakti aur kaushal"],["The High Priestess","intuition, gehri samajh"],["The Empress","samriddhi, palan-poshan"],["The Emperor","anushasan, neturitv"],["The Hierophant","parampara, guru ki seekh"],["The Lovers","rishte aur sahi chunav"],["The Chariot","jeet, drudh sankalp"],["Strength","dhairya, aatmavishwas"],["The Hermit","ekant aur aatm-chintan"],["Wheel of Fortune","badalta samay, kismat"],["Justice","nyay, sachchai"],["The Hanged Man","nazariya badalna, ruk kar sochna"],["Death","ek daur ka ant, parivartan"],["Temperance","santulan, sabr"],["The Devil","bandhan, lalach"],["The Tower","achanak badlav"],["The Star","asha, shanti"],["The Moon","bhram, andeshe"],["The Sun","khushi, safalta"],["Judgement","jaagruti, naya nirnay"],["The World","poorti, safal samapti"]];
const TAROT_RANKS = [["Ace","naya mauka"],["Two","faisla aur santulan"],["Three","vistar aur sahyog"],["Four","sthirta, thehrav"],["Five","takraav, chunauti"],["Six","sudhar, aage badhna"],["Seven","parakh aur dhairya"],["Eight","mehnat aur gati"],["Nine","manzil ke kareeb"],["Ten","poornata ya bojh"],["Page","seekhna, sandesh"],["Knight","josh aur gati"],["Queen","samajh aur dekhbhal"],["King","niyantran, paripakvata"]];
const TAROT_SUITS = [["Wands","🔥","kaam aur jazbe"],["Cups","💧","bhavnaon aur rishton"],["Swords","🌬️","vichar aur nirnay"],["Pentacles","🪙","paise aur kaam"]];
function tarotCard(i) { // 0..77
  if (i < 22) return { name: TAROT_MAJOR[i][0], icon: "🃏", text: TAROT_MAJOR[i][1][0].toUpperCase() + TAROT_MAJOR[i][1].slice(1) };
  const j = i - 22, suit = TAROT_SUITS[Math.floor(j / 14)], rank = TAROT_RANKS[j % 14];
  return { name: `${rank[0]} of ${suit[0]}`, icon: suit[1], text: `${rank[1][0].toUpperCase() + rank[1].slice(1)} — ${suit[2]} ke kshetra mein` };
}
function tarotDailyIndex() { const t = istNowParts(); let h = 0; for (const ch of `${t.y}-${t.m}-${t.d}|${myself()?.id || ""}`) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return h % 78; }
function tarotCardHTML() {
  const i = horoState.tarot ?? tarotDailyIndex(), c = tarotCard(i);
  return `<div class="card" id="tarotCard"><h3>🃏 Tarot — ${horoState.tarot == null ? "aaj ka card" : "aapka naya card"}</h3>
    <div style="font-size:42px;line-height:1">${c.icon}</div><div style="font-weight:700;margin:6px 0 2px">${esc(c.name)}</div><p style="margin:0 0 10px">${esc(c.text)}.</p>
    <button type="button" class="secondary" onclick="tarotDraw()">🔄 Ek aur card</button>
    <div class="muted" style="font-size:11.5px;margin-top:8px">Sirf manoranjan ke liye.</div></div>`;
}
function tarotDraw() { horoState.tarot = Math.floor(Math.random() * 78); const el = document.getElementById("tarotCard"); if (el) el.outerHTML = tarotCardHTML(); }
/* ---- Family rashi ---- */
function familyRashiHTML() {
  const rows = [], missing = [];
  state.people.forEach(p => { const r = rashiFromBirth(normalizeDate(p.dob) || p.dob, p.details?.birth_time); (r ? rows : missing).push({ p, r }); });
  const list = rows.map(({ p, r }) => `<div class="row"><span>${esc(p.name)}${p.me ? " (aap)" : ""}</span><span>${horoSymbol(r.sign)} ${r.hindi} · ${r.nakshatra}</span></div>`).join("");
  return `<div class="card"><h3>👨‍👩‍👧 Family ki Rashi</h3>${list || `<p class="muted">Abhi kisi ki DOB aur Birth time nahi bhari.</p>`}
    ${missing.length ? `<div class="muted" style="font-size:12.5px;margin-top:8px">${missing.length} logon ki DOB ya Birth time baaki hai.</div>` : ""}</div>`;
}
function horoscopePage() {
  const cityOpts = HORO_CITIES.map(c => `<option ${c[0] === horoCity()[0] ? "selected" : ""}>${c[0]}</option>`).join("");
  return `<div class="page-head"><h2>🔮 Horoscope</h2><p class="muted">Rashi, panchang, rahu kaal aur tarot.</p></div>
    ${horoCardHTML()}
    <div class="card"><div class="field" style="margin:0"><label>Shehar (panchang aur sunrise ke liye)</label><select onchange="setHoroCity(this.value)">${cityOpts}</select></div></div>
    <div id="horoPlaceCards">${horoPlaceCardsHTML()}</div>
    ${tarotCardHTML()}
    ${familyRashiHTML()}`;
}
function openHoroscope() {
  if (/^https:\/\//i.test(HOROSCOPE_URL)) window.open(HOROSCOPE_URL, "_blank", "noopener");
  else go("horoscope");
}
function horoMiniHTML() {
  const m = myself(), r = m ? rashiFromBirth(normalizeDate(m.dob) || m.dob, m.details?.birth_time) : null;
  return `<div class="card"><h3 style="display:flex;align-items:center;gap:8px"><img src="/assets/horoscope-icon.png" alt="" width="26" height="26" style="border-radius:6px;object-fit:contain"> Horoscope</h3>
    <p class="muted" style="margin-top:0">${r ? `${horoSymbol(r.sign)} Aapki rashi: <b>${r.hindi} (${r.sign[0].toUpperCase() + r.sign.slice(1)})</b> · ${r.nakshatra}` : "Rashi dekhne ke liye profile mein DOB aur Birth time bharein."}</p>
    <button type="button" class="primary" onclick="openHoroscope()">Poora horoscope dekhein →</button></div>`;
}

/* ---------------- Daily quote image (dashboard) ----------------
   One quote a day, drawn as a picture. The pick depends on the signed-in person + the date, so every admin / member sees a different one,
   and it changes by itself every day. To add your own lines, just add them to DAILY_QUOTES. */
const DAILY_QUOTES = [
  "Parivaar wo jagah hai jahan har kahani ki shuruaat aur har dil ka sukoon milta hai.",
  "Jadein jitni gehri hongi, ped utna hi unchaa uthega.",
  "Rishte nibhane ke liye waqt nikalna padta hai, bahane nahi.",
  "Ghar deewaron se nahi, apno ki hansi se banta hai.",
  "Bade-buzurgon ka saath ho to har musibat chhoti lagti hai.",
  "Family: where life begins and love never ends.",
  "Jo parivaar saath baithkar khaata hai, wo saath mein hi muskurata hai.",
  "Apno ke liye nikala gaya ek pal, poori zindagi ki yaad ban jaata hai.",
  "Ek chhota sa phone call, kisi ka poora din roshan kar sakta hai.",
  "Rishton ki khoobsurti unme hai jo bina kahe samajh liye jaate hain.",
  "Roots give us strength; branches give us reach.",
  "Dadi-Nani ki kahaniyan, sabse keemti virasat hain.",
  "Jahan pyaar hai, wahan ghar hai.",
  "Parivaar ka matlab: har haal me, har kisi ke saath.",
  "Khoon ke rishte ho ya dil ke, nibhane se hi gehre hote hain.",
  "Aaj kisi apne ko yaad karo, unhe bahut accha lagega.",
  "A family tree is a story that keeps growing.",
  "Maa ki duaon me wo taqat hai jo taqdeer badal deti hai.",
  "Pita ka saath wo chhaaon hai jo dhoop me bhi thandak deti hai.",
  "Bhai-behen: bachpan ke sabse pyaare saathi.",
  "Jo apni jadon ko yaad rakhta hai, wo kabhi bhatakta nahi.",
  "Choti-choti khushiyan milke bante hain bade tyohaar.",
  "Rishte paison se nahi, bharose se chalte hain.",
  "Ek-dusre ka haath thaame rakho, raaste khud aasaan ho jaate hain.",
  "Purane photos dekhna, apno ko dobara jeena hai.",
  "Our ancestors planted the seeds; we grow in their shade.",
  "Kabhi kisi apne se naraaz ho to pehle baat kar lo, ho sakta hai wo intezaar kar raha ho.",
  "Parivaar ke saath bitaya hua har din ek tyohaar hai.",
  "Dua, pyaar aur saath, isse badi koi daulat nahi.",
  "Har pidhi ek nayi kahani likhti hai, par jadein wahi rehti hain.",
  "Jahan buzurgon ka samman hai, wahan barkat hai.",
  "Love makes a house a home.",
  "Sabse sundar tasveer wo hai jisme saara parivaar saath ho.",
  "Rishton me meethaas ghulne me waqt lagta hai, par rang gehra chadhta hai.",
  "Apno ki kami tab samajh aati hai jab wo paas nahi hote, isliye abhi mil lo.",
  "Ek parivaar, anginat yaadein.",
  "Sabr, samman aur sneh: parivaar ki teen neev.",
  "Jin gharon me hansi goonjti hai, wahan bhagwan khud baste hain.",
  "Be the reason your family smiles today.",
  "Chhote ko pyaar, bade ko samman, yehi hai sanskaar.",
  "Aaj ka din apno ke naam, ek message to banta hai."
];
const DQ_THEMES = [["#4a2c6e", "#b07d1e"], ["#14532d", "#d4a017"], ["#7c2d12", "#f59e0b"], ["#1e3a5f", "#e0a526"], ["#831843", "#f4b942"], ["#134e4a", "#e6c97a"]];
let dqShift = 0, dqUrl = "";
function dqHash(str) { let h = 2166136261; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
function dqPick() {
  const d = new Date(), day = `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
  const who = currentUser?.id || state.account?.email || state.account?.name || "guest";
  const h = dqHash(who + "|" + day);
  return { quote: DAILY_QUOTES[(h + dqShift) % DAILY_QUOTES.length], theme: DQ_THEMES[(h + dqShift * 7) % DQ_THEMES.length], day: d };
}
function dqWrap(ctx, text, maxW) {
  const words = text.split(" "), lines = []; let line = "";
  words.forEach(w => { const t = line ? line + " " + w : w; if (ctx.measureText(t).width > maxW && line) { lines.push(line); line = w; } else line = t; });
  if (line) lines.push(line); return lines;
}
async function dqDraw() {
  const { quote, theme, day } = dqPick(), W = 1080, H = 1080, c = document.createElement("canvas"); c.width = W; c.height = H;
  const ctx = c.getContext("2d");
  try { await document.fonts.ready; } catch (e) {}
  const g = ctx.createLinearGradient(0, 0, W, H); g.addColorStop(0, theme[0]); g.addColorStop(1, "#0f0a1a"); ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  ctx.globalAlpha = .08; ctx.fillStyle = theme[1]; ctx.beginPath(); ctx.arc(W - 120, 140, 330, 0, 7); ctx.fill(); ctx.beginPath(); ctx.arc(80, H - 60, 260, 0, 7); ctx.fill(); ctx.globalAlpha = 1;
  ctx.strokeStyle = theme[1]; ctx.lineWidth = 4; ctx.globalAlpha = .7; ctx.strokeRect(44, 44, W - 88, H - 88); ctx.globalAlpha = 1;
  ctx.fillStyle = theme[1]; ctx.font = "700 220px Georgia, serif"; ctx.textAlign = "left"; ctx.fillText("\u201C", 90, 290);
  ctx.fillStyle = "#fff"; ctx.textAlign = "center";
  let size = 64, lines;
  for (; size >= 40; size -= 4) { ctx.font = `600 ${size}px Fraunces, Georgia, serif`; lines = dqWrap(ctx, quote, W - 240); if (lines.length * size * 1.35 < 560) break; }
  const top = 330 + (560 - lines.length * size * 1.35) / 2;
  lines.forEach((l, i) => ctx.fillText(l, W / 2, top + size + i * size * 1.35));
  ctx.fillStyle = theme[1]; ctx.fillRect(W / 2 - 60, 905, 120, 4);
  ctx.fillStyle = "#f3e9d2"; ctx.font = "600 30px Inter, Arial, sans-serif";
  ctx.fillText(day.toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long", year: "numeric" }), W / 2, 960);
  ctx.font = "700 34px Fraunces, Georgia, serif"; ctx.fillStyle = "#fff"; ctx.fillText("FamilyTree", W / 2, 1010);
  try { const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = "/assets/tree-logo-icon.png"; }); ctx.drawImage(img, W - 190, 70, 110, 110); } catch (e) {}
  return c.toDataURL("image/png");
}
async function dailyQuoteInit() {
  const el = document.getElementById("dqImg"); if (!el) return;
  try { dqUrl = await dqDraw(); const now = document.getElementById("dqImg"); if (now) { now.src = dqUrl; now.hidden = false; } } catch (e) { console.warn("daily quote failed", e); }
}
function dailyQuoteCardHTML() {
  return `<div class="card dq-card"><div class="dq-head"><h3>✨ Aaj ka vichar</h3><button type="button" class="ghost" onclick="dqAnother()">🔄 Doosra</button></div>
    <img id="dqImg" class="dq-img" alt="Aaj ka quote" hidden>
    <div class="actions" style="margin-top:10px"><button type="button" class="secondary" onclick="dqShare()">📤 Share</button><button type="button" class="secondary" onclick="dqDownload()">⬇ Download</button></div></div>`;
}
function dqAnother() { dqShift++; dailyQuoteInit(); }
function dqDownload() { if (!dqUrl) return; const a = document.createElement("a"); a.href = dqUrl; a.download = "familytree-quote.png"; document.body.appendChild(a); a.click(); a.remove(); }
async function dqShare() {
  if (!dqUrl) return;
  try {
    const blob = await (await fetch(dqUrl)).blob(), file = new File([blob], "familytree-quote.png", { type: "image/png" });
    if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], title: "FamilyTree" }); return; }
  } catch (e) { if (e && e.name === "AbortError") return; }
  dqDownload();
}

/* ---------------- home ---------------- */
function home() {
  const upcoming = state.events.slice(0, 2);
  return `<div class="page-head"><h2>Family Dashboard</h2><p class="muted">Your family network, based on the logged-in account.</p></div>
  ${dailyQuoteCardHTML()}
  <div class="grid g4">
    <div class="card stat-card"><div class="muted">People in tree</div><div class="stat">${state.people.length}</div></div>
    <div class="card stat-card"><div class="muted">Unclaimed profiles</div><div class="stat">${state.people.filter(p => p.status === "unclaimed").length}</div></div>
    <div class="card stat-card"><div class="muted">Merge requests</div><div class="stat">${state.mergeRequests.length}</div></div>
    <div class="card stat-card"><div class="muted">Connections</div><div class="stat">${state.connections.filter(c => c.status === "connected").length}</div></div>
  </div>
  <div class="card"><h3>Quick actions</h3><div class="actions">
    <button class="primary" onclick="go('tree')">🌳 Open Family Tree</button>
    <button class="secondary" onclick="go('add')">➕ Add Relative</button>
    <button class="secondary" onclick="go('relationship')">🔗 Find Relationship</button>
    <button class="secondary" onclick="go('wall')">📝 Family Wall</button>
    <button class="secondary" onclick="go('games')">🎮 Games ↗</button>
  </div></div>
  ${horoMiniHTML()}
  <div class="card"><h3>Upcoming</h3>${upcoming.map(e => `<div class="event-chip"><span class="em">${e.emoji}</span><div><strong>${esc(e.title)}</strong><div class="muted" style="font-size:12.5px">${e.sub}</div></div></div>`).join("")}
  <button class="ghost" style="margin-top:8px" onclick="go('wall')">See all events →</button></div>`;
}

/* ---------------- V3: tree — rendered live from the relationship graph ---------------- */
let treeCenterId = null; // person the tree is currently focused/centered on
let treeExpanded = new Set(); // person ids currently showing their "add relative" placeholders
function nodeElId(id) { return "node-" + String(id).replace(/[^a-zA-Z0-9_-]/g, "_"); }
function placeholderId(typeKey, targetId) { return "add-" + typeKey + "-" + targetId; }

/* Order people inside each generation row so that (1) spouses are adjacent and
   (2) every child sits roughly under its own parent(s). Without this the rows were
   in arbitrary order and connector lines crossed each other. */
function orderGenerations(byGen, levels) {
  const idx = {}; // personId -> position inside its (already ordered) row
  levels.forEach(g => {
    const row = (byGen[g] || []).slice();
    const info = {};
    row.forEach((id, i) => {
      const ps = parentsOf(id).filter(x => x in idx);
      info[id] = { i, pos: ps.length ? ps.reduce((sum, x) => sum + idx[x], 0) / ps.length : null };
    });
    row.forEach(id => {
      if (info[id].pos !== null) return;
      const sp = spousesOf(id).find(x => info[x] && info[x].pos !== null);
      if (sp) info[id].pos = info[sp].pos + 0.001;
    });
    row.sort((a, b) => {
      const pa = info[a].pos, pb = info[b].pos;
      if (pa === null && pb === null) return info[a].i - info[b].i;
      if (pa === null) return 1;
      if (pb === null) return -1;
      return (pa - pb) || (info[a].i - info[b].i);
    });
    const out = [], used = new Set();
    row.forEach(id => {
      if (used.has(id)) return;
      out.push(id); used.add(id);
      spousesOf(id).forEach(sp => { if (row.includes(sp) && !used.has(sp)) { out.push(sp); used.add(sp); } });
    });
    byGen[g] = out;
    out.forEach((id, i) => { idx[id] = i; });
  });
}
/* ==========================================================================
   Chart view — classic top-down descendant chart (iMeUsWe-style):
   white portrait cards, coloured initials / photo, spouse line with a small hollow circle,
   a bus line that drops from that circle to each child. Built from the same relationship graph.
   ========================================================================== */
let treeStyle = (() => { try { return localStorage.getItem("ft_tree_style") === "chart" ? "chart" : "branch"; } catch (e) { return "branch"; } })();
let chartRootId = null, chartScale = null, chartDragMoved = false;
const CHD = { cw: 112, ch: 150, gapS: 48, gap: 22, vgap: 64, pad: 40, avY: 44 };
let chartHistory = [], chartFocusId = null;
function setTreeStyle(s) { treeStyle = s === "chart" ? "chart" : "branch"; try { localStorage.setItem("ft_tree_style", treeStyle); } catch (e) {} chartScale = null; render(); }
function treeStyleSwitchHTML() {
  return `<div class="view-switch style-switch"><button class="${treeStyle === "branch" ? "active" : ""}" onclick="setTreeStyle('branch')">🌿 Branch</button><button class="${treeStyle === "chart" ? "active" : ""}" onclick="setTreeStyle('chart')">🧬 Chart</button></div>`;
}
/* climb to the top of the family line (father's side first; a married-in person with no parents climbs via the spouse) */
function chartTopAncestor(id) {
  const seen = new Set(); let cur = id;
  while (cur && !seen.has(cur)) {
    seen.add(cur);
    const ps = parentsOf(cur).filter(x => personById(x));
    if (!ps.length) {
      // only a married-in person who is the START of the climb (no parents of their own) follows the spouse's line
      const sp = cur === id && spousesOf(cur).find(s => !seen.has(s) && parentsOf(s).some(x => personById(x)));
      if (sp) { cur = sp; continue; }
      break;
    }
    cur = ps.find(x => personById(x).gender === "Male") || ps[0];
  }
  return cur;
}
function chartRoots() {
  const seen = new Set(), out = [];
  state.people.forEach(p => { const r = chartTopAncestor(p.id); if (r && !seen.has(r)) { seen.add(r); out.push(r); } });
  return out;
}
function chartLayout(rootId) {
  const placed = new Set();
  const dobKey = id => String(personById(id)?.dob || "9999");
  const byBirth = (a, b) => dobKey(a).localeCompare(dobKey(b));
  const kidsOf = x => childrenOf(x).filter(c => personById(c) && !placed.has(c));
  function unit(pid) {
    placed.add(pid);
    const sps = spousesOf(pid).filter(s => personById(s) && !placed.has(s));
    sps.forEach(s => placed.add(s));
    const left = [], right = [];
    sps.forEach((s, i) => (i % 2 === 0 ? right : left).push(s));
    const cards = [...left.reverse(), pid, ...right];
    const map = new Map();
    new Set([...kidsOf(pid), ...sps.flatMap(kidsOf)]).forEach(c => {
      const ps = parentsOf(c); const key = sps.find(s => ps.includes(s)) || pid;
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(c);
    });
    const groups = [];
    cards.forEach(cid => { if (map.has(cid)) groups.push({ key: cid, kids: map.get(cid).sort(byBirth) }); });
    groups.forEach(g => { g.nodes = g.kids.filter(k => !placed.has(k)).map(k => unit(k)); });
    const kids = groups.flatMap(g => g.nodes);
    const uw = cards.length * CHD.cw + (cards.length - 1) * CHD.gapS;
    const kw = kids.reduce((s, n) => s + n.w, 0) + Math.max(0, kids.length - 1) * CHD.gap;
    return { pid, cards, groups, kids, uw, kw, w: Math.max(uw, kw) };
  }
  const root = unit(rootId);
  const cardsOut = [], lines = []; let maxY = 0;
  const X = (x, i) => x + i * (CHD.cw + CHD.gapS);
  function place(n, x0, y) {
    const ux = x0 + (n.w - n.uw) / 2;
    n.cards.forEach((id, i) => cardsOut.push({ id, x: X(ux, i), y, spouse: id !== n.pid }));
    maxY = Math.max(maxY, y + CHD.ch);
    const midY = y + CHD.avY, bottom = y + CHD.ch, busY = bottom + CHD.vgap / 2, topY = bottom + CHD.vgap;
    const hasKids = key => n.groups.some(g => g.key === key && g.nodes.length);
    const pi = n.cards.indexOf(n.pid);
    // spouse lines (+ circle when that couple has children)
    n.cards.forEach((id, i) => {
      if (i === pi) return;
      const near = i > pi ? i - 1 : i + 1;                       // the neighbour on the side facing the main person
      const a = Math.min(i, near), b = Math.max(i, near);
      const xa = X(ux, a) + CHD.cw, xb = X(ux, b);
      lines.push(`M${xa} ${midY}H${xb}`);
      if (hasKids(id)) lines.push({ circle: [(xa + xb) / 2, midY] });
    });
    // children
    let cx = x0 + (n.w - n.kw) / 2;
    n.groups.forEach(g => {
      if (!g.nodes.length) return;
      const i = n.cards.indexOf(g.key);
      let dx, dy;
      if (g.key === n.pid && n.cards.length === 1) { dx = X(ux, i) + CHD.cw / 2; dy = bottom; }
      else if (g.key === n.pid) { dx = X(ux, i) + CHD.cw / 2; dy = bottom; }
      else { const near = i > pi ? i - 1 : i + 1; dx = (X(ux, Math.min(i, near)) + CHD.cw + X(ux, Math.max(i, near))) / 2; dy = midY; }
      g.nodes.forEach(k => {
        const kux = cx + (k.w - k.uw) / 2, kpi = k.cards.indexOf(k.pid);
        const ax = X(kux, kpi) + CHD.cw / 2, r = 7;
        if (Math.abs(ax - dx) < 2 * r) lines.push(`M${dx} ${dy}V${topY}`);
        else { const s = ax > dx ? 1 : -1; lines.push(`M${dx} ${dy}V${busY - r}Q${dx} ${busY} ${dx + s * r} ${busY}H${ax - s * r}Q${ax} ${busY} ${ax} ${busY + r}V${topY}`); }
        place(k, cx, topY);
        cx += k.w + CHD.gap;
      });
    });
  }
  place(root, CHD.pad, CHD.pad);
  return { cards: cardsOut, lines, W: root.w + CHD.pad * 2, H: maxY + CHD.pad };
}
function chartCardHTML(c) {
  const p = personById(c.id); if (!p) return "";
  const [bg, fg] = avatarPalette(p);
  const yearOf = v => { const m = String(v || "").match(/\b(1[0-9]{3}|20[0-9]{2})\b/); return m ? m[1] : ""; };
  const by = yearOf(p.dob), dod = yearOf(p.details?.dod || p.details?.death_date);
  const yrs = by ? `${by} -${dod ? " " + dod : ""}` : (dod ? `- ${dod}` : "-");
  const reg = p.claimed_by || p.status === "claimed" || p.me;
  const av = p.avatar_url
    ? `<span class="ch-av${reg ? " reg" : ""}"><img src="${esc(p.avatar_url)}" alt="" loading="lazy" referrerpolicy="no-referrer" data-ini="${esc(initials(p.name))}" data-bg="${bg}" data-fg="${fg}" onerror="avatarFallback(this)"></span>`
    : `<span class="ch-av${reg ? " reg" : ""}" style="background:${bg};color:${fg}">${esc(initials(p.name))}</span>`;
  const badge = c.spouse && parentsOf(p.id).some(x => personById(x))
    ? `<span class="ch-badge" role="button" title="Inke parivaar ka tree dekhein" onclick="event.stopPropagation();chartGoFamily('${esc(p.id)}')"><svg viewBox="0 0 24 24" width="15" height="15"><circle cx="12" cy="7" r="4.2" fill="#b3b3b3"/><circle cx="7" cy="14.5" r="4.2" fill="#b3b3b3"/><circle cx="17" cy="14.5" r="4.2" fill="#b3b3b3"/></svg></span>` : "";
  const add = canAddRelativeTo(p.id)
    ? `<span class="ch-add" role="button" title="Relative add karein" onclick="event.stopPropagation();chartAddMenu(event,'${esc(p.id)}')"><svg viewBox="0 0 24 24" width="19" height="19"><circle cx="10" cy="7" r="4" fill="#f07d3c"/><path d="M2 20c0-4 3.5-6.5 8-6.5s8 2.5 8 6.5z" fill="#f07d3c"/><circle cx="19" cy="17" r="4.4" fill="#f07d3c" stroke="#fff" stroke-width="1.2"/><path d="M19 15v4M17 17h4" stroke="#fff" stroke-width="1.5" stroke-linecap="round"/></svg></span>` : "";
  return `<button type="button" class="ch-card${p.me ? " me" : ""}${p.lifeStatus === "deceased" ? " gone" : ""}" data-id="${esc(p.id)}" style="left:${c.x}px;top:${c.y}px" title="${esc(p.name)}" onclick="chartOpen('${esc(p.id)}')">${add}${badge}${av}<b>${esc(p.name)}</b>${spouseCardLine(p) ? `<span class="ch-sp" title="${esc(spouseCardLine(p))}">💍 ${esc(spouseCardLine(p))}</span>` : ""}<span class="ch-yrs">${esc(yrs)}</span></button>`;
}
function treeChart() {
  const roots = chartRoots();
  if (!chartRootId || !personById(chartRootId) || !roots.includes(chartRootId)) {
    const startFrom = treeCenterId && personById(treeCenterId) ? treeCenterId : (me() && me().id);
    chartRootId = chartTopAncestor(startFrom) || roots[0];
  }
  if (!chartRootId) return `<div class="empty card"><span class="big">🌳</span><h3>Tree khali hai</h3><p class="muted">Pehle kuch family members add karein.</p></div>`;
  const L = chartLayout(chartRootId);
  const rp = personById(chartRootId), last = rp ? nameParts(rp).last : "";
  const title = treeViewing ? `${treeViewing.ownerName}'s Family Tree` : `${last ? last + " " : ""}Family Tree`;
  const sc = chartScale || 1;
  const svg = `<svg class="ch-lines" width="${L.W}" height="${L.H}" viewBox="0 0 ${L.W} ${L.H}">${L.lines.map(l => typeof l === "string" ? `<path d="${l}"/>` : `<circle cx="${l.circle[0]}" cy="${l.circle[1]}" r="4"/>`).join("")}</svg>`;
  return `<div class="ch-wrap">
    <div class="ch-bar"><b>${chartHistory.length ? `<button class="ghost" style="padding:3px 10px;margin-right:8px" onclick="chartBack()">← Wapas</button>` : ""}${esc(title)}</b>
      <span class="ch-tools">
        ${roots.length > 1 ? `<select onchange="chartSetRoot(this.value)" title="Chart kahan se shuru ho">${roots.map(r => `<option value="${esc(r)}" ${r === chartRootId ? "selected" : ""}>${esc(personById(r)?.name || "?")}</option>`).join("")}</select>` : ""}
        <button class="ghost" onclick="chartZoom(1/1.2)" title="Zoom out">－</button><span id="chartPct" class="muted">${Math.round(sc * 100)}%</span><button class="ghost" onclick="chartZoom(1.2)" title="Zoom in">＋</button><button class="ghost" onclick="chartFit()">Fit</button>
      </span></div>
    <div class="ch-canvas" id="chartCanvas" data-w="${L.W}" data-h="${L.H}" onpointerdown="chartPanStart(event)" onwheel="chartWheel(event)">
      <div id="chartSizer" style="width:${L.W * sc}px;height:${L.H * sc}px"><div id="chartInner" style="width:${L.W}px;height:${L.H}px;transform:scale(${sc})">${svg}${L.cards.map(chartCardHTML).join("")}</div></div>
    </div>
    <p class="muted" style="font-size:12.5px;margin:8px 2px 0">Kisi bhi card par tap karein — profile khulega. Drag karke ghumayein, ＋/－ se zoom karein.</p>
  </div>`;
}
function chartApplyScale(s, keepCenter) {
  const cv = document.getElementById("chartCanvas"), inner = document.getElementById("chartInner"), sizer = document.getElementById("chartSizer");
  if (!cv || !inner) return;
  const W = +cv.dataset.w, H = +cv.dataset.h, old = chartScale || 1;
  const cxr = (cv.scrollLeft + cv.clientWidth / 2) / old, cyr = (cv.scrollTop + cv.clientHeight / 2) / old;
  chartScale = Math.max(0.15, Math.min(2.5, s));
  inner.style.transform = `scale(${chartScale})`;
  sizer.style.width = W * chartScale + "px"; sizer.style.height = H * chartScale + "px";
  if (keepCenter) { cv.scrollLeft = cxr * chartScale - cv.clientWidth / 2; cv.scrollTop = cyr * chartScale - cv.clientHeight / 2; }
  const pct = document.getElementById("chartPct"); if (pct) pct.textContent = Math.round(chartScale * 100) + "%";
}
function chartZoom(f) { chartApplyScale((chartScale || 1) * f, true); }
function chartFit() {
  const cv = document.getElementById("chartCanvas"); if (!cv) return;
  const s = Math.min(1, (cv.clientWidth - 8) / +cv.dataset.w, (cv.clientHeight - 8) / +cv.dataset.h);
  chartApplyScale(Math.max(0.15, s), false); cv.scrollLeft = 0; cv.scrollTop = 0;
}
function chartAfterRender() { // first draw: fit the whole chart on screen, then centre on "me"
  const cv = document.getElementById("chartCanvas"); if (!cv) return;
  if (chartScale === null) {
    const w = +cv.dataset.w; chartApplyScale(Math.max(0.3, Math.min(1, (cv.clientWidth - 8) / w)), false);
  }
  const m = (chartFocusId && [...document.querySelectorAll(".ch-card")].find(x => x.dataset.id === chartFocusId)) || document.querySelector(".ch-card.me");
  chartFocusId = null;
  if (m) { cv.scrollLeft = Math.max(0, (m.offsetLeft + CHD.cw / 2) * chartScale - cv.clientWidth / 2); cv.scrollTop = 0; }
}
function chartSetRoot(id) { chartRootId = id; chartHistory = []; chartScale = null; render(); }
function chartGoFamily(personId) { // open the family line this married-in person comes from
  const top = chartTopAncestor(personId); if (!top) return;
  chartHistory.push({ root: chartRootId, focus: personId });
  chartRootId = top; chartFocusId = personId; chartScale = null; render();
}
function chartBack() {
  const h = chartHistory.pop(); if (!h) return;
  chartRootId = h.root; chartFocusId = h.focus; chartScale = null; render();
}
function chartAddMenu(e, id) {
  document.getElementById("chartMenu")?.remove();
  const np = parentsOf(id).length;
  const items = Object.entries(RELATION_TYPES).filter(([k, t]) => !(t.edgeType === "parent" && np >= 2));
  const m = document.createElement("div"); m.id = "chartMenu"; m.className = "ch-menu";
  m.innerHTML = `<div class="ch-menu-h">${esc(personById(id)?.name || "")} ka…</div>` + items.map(([k, t]) => `<button type="button" data-k="${k}">${esc(t.label)} add karein</button>`).join("");
  document.body.appendChild(m);
  const r = e.currentTarget.getBoundingClientRect();
  m.style.left = Math.max(8, Math.min(r.left, window.innerWidth - m.offsetWidth - 8)) + "px";
  m.style.top = Math.max(8, Math.min(r.bottom + 4, window.innerHeight - m.offsetHeight - 8)) + "px";
  m.onclick = ev => { const k = ev.target.dataset && ev.target.dataset.k; m.remove(); if (k) openAddRelative(id, k); };
  setTimeout(() => document.addEventListener("click", function once() { document.getElementById("chartMenu")?.remove(); document.removeEventListener("click", once); }), 0);
}
function chartOpen(id) { if (chartDragMoved) return; openProfilePopup(id); }
function chartWheel(e) { if (!(e.ctrlKey || e.metaKey)) return; e.preventDefault(); chartZoom(e.deltaY < 0 ? 1.1 : 1 / 1.1); }
let chartPan = null;
function chartPanStart(e) {
  if (e.pointerType !== "mouse" || e.button !== 0) return; // touch keeps native scrolling
  const cv = document.getElementById("chartCanvas"); if (!cv) return;
  chartPan = { x: e.clientX, y: e.clientY, l: cv.scrollLeft, t: cv.scrollTop }; chartDragMoved = false; cv.classList.add("grab");
  const mv = ev => { if (!chartPan) return; const dx = ev.clientX - chartPan.x, dy = ev.clientY - chartPan.y; if (Math.abs(dx) + Math.abs(dy) > 5) chartDragMoved = true; cv.scrollLeft = chartPan.l - dx; cv.scrollTop = chartPan.t - dy; };
  const up = () => { chartPan = null; cv.classList.remove("grab"); window.removeEventListener("pointermove", mv); window.removeEventListener("pointerup", up); setTimeout(() => { chartDragMoved = false; }, 0); };
  window.addEventListener("pointermove", mv); window.addEventListener("pointerup", up);
}

function tree() { return treeStyle === "chart" ? treeChart() : treeBranch(); }
function treeBranch() {
  const centerId = treeCenterId || me().id;
  const gens = computeGenerations(centerId); // {personId: genIndex}
  const byGen = {};
  Object.entries(gens).forEach(([id, g]) => { (byGen[g] = byGen[g] || []).push(id); });

  // Which "+ Add ..." placeholder groups to show, based on which cards are expanded.
  const groups = [];
  const lvl = new Set(Object.keys(byGen).map(Number));
  const seenChildFamilies = new Set();
  treeExpanded.forEach(id => {
    if (!(id in gens)) return; // not part of the currently visible tree
    const p = personById(id);
    if (!p) return;
    const g = gens[id];
    if (spousesOf(id).length === 0) {
      groups.push({ kind: "spouse", gen: g, targetId: id, typeKey: p.gender === "Female" ? "husband" : "wife" });
    }
    // missing parent(s): both if none, or only the missing one if one parent already exists
    const ps = parentsOf(id).map(personById).filter(Boolean);
    if (ps.length < 2) {
      const hasF = ps.some(x => x.gender === "Male"), hasM = ps.some(x => x.gender === "Female");
      const keys = [];
      if (!hasF) keys.push("father");
      if (!hasM) keys.push("mother");
      const use = keys.slice(0, 2 - ps.length);
      if (use.length) { groups.push({ kind: "parents", gen: g - 1, targetId: id, keys: use }); lvl.add(g - 1); }
    }
    groups.push({ kind: "siblings", gen: g, targetId: id });
    const spouse = spousesOf(id)[0];
    const familyKey = spouse ? [id, spouse].sort().join("|") : id;
    if (!seenChildFamilies.has(familyKey)) {
      seenChildFamilies.add(familyKey);
      groups.push({ kind: "kids", gen: g + 1, targetId: id, parentIds: spouse ? [id, spouse] : [id] });
      lvl.add(g + 1);
    }
  });

  const levels = Array.from(lvl).sort((a, b) => a - b);
  // order each row so children sit under their own parents and spouses stay adjacent
  orderGenerations(byGen, levels);

  // Row items: real people first, then placeholders are slotted in NEXT TO the people they belong to
  // (instead of being dumped at the end of the row, which made lines cross whole rows).
  const rowItems = {};
  levels.forEach(g => { rowItems[g] = (byGen[g] || []).map(id => ({ pid: id })); });
  const idxIn = (g, id) => (rowItems[g] || []).findIndex(it => it.pid === id);
  const mean = a => a.reduce((s, v) => s + v, 0) / a.length;
  const isSpousePh = it => it && it.ph && (it.ph === "husband" || it.ph === "wife");
  // never drop a placeholder between two spouses (or between a person and their "Add spouse" box)
  const skipCouple = (row, at) => {
    while (at > 0 && at < row.length) {
      const a = row[at - 1], b = row[at];
      const couple = (a.pid && b.pid && spousesOf(a.pid).includes(b.pid)) || (a.pid && isSpousePh(b) && b.target === a.pid);
      if (!couple) break;
      at++;
    }
    return at;
  };

  // 1) "Add Husband/Wife" right beside the person
  groups.filter(x => x.kind === "spouse").forEach(gr => {
    const row = rowItems[gr.gen]; const i = idxIn(gr.gen, gr.targetId);
    row.splice(i < 0 ? row.length : i + 1, 0, { ph: gr.typeKey, target: gr.targetId });
  });

  // 1b) "Add Brother/Sister" next to the person's existing siblings (never between a couple)
  groups.filter(x => x.kind === "siblings").forEach(gr => {
    const row = rowItems[gr.gen];
    const fam = [gr.targetId, ...siblingsOf(gr.targetId)].map(id => idxIn(gr.gen, id)).filter(i => i >= 0);
    if (!fam.length) return;
    const at = skipCouple(row, Math.max(...fam) + 1);
    const pIdx = parentsOf(gr.targetId).map(pid => idxIn(gr.gen - 1, pid)).filter(i => i >= 0);
    const ref = pIdx.length ? mean(pIdx) : undefined;
    row.splice(at, 0, { ph: "brother", target: gr.targetId, pos: ref }, { ph: "sister", target: gr.targetId, pos: ref });
  });

  // 2) "Add Father/Mother" above the person (top rows first)
  groups.filter(x => x.kind === "parents").sort((a, b) => a.gen - b.gen).forEach(gr => {
    const P = gr.gen, g = P + 1;
    const row = rowItems[P];
    const items = gr.keys.map(k => ({ ph: k, target: gr.targetId }));
    const realIdx = parentsOf(gr.targetId).map(pid => idxIn(P, pid)).filter(i => i >= 0);
    let at;
    if (realIdx.length) {
      // one parent already shown -> put the missing one right beside it
      at = gr.keys.includes("father") ? Math.min(...realIdx) : Math.max(...realIdx) + 1;
    } else {
      const xi = idxIn(g, gr.targetId);
      let found = false; at = 0;
      row.forEach((it, i) => {
        if (!it.pid) return;
        const ks = childrenOf(it.pid).map(c => idxIn(g, c)).filter(v => v >= 0);
        if (!ks.length) return;
        found = true;
        if (mean(ks) < xi) at = i + 1;
      });
      if (!found) at = row.length;
      at = skipCouple(row, at);
    }
    row.splice(at, 0, ...items);
  });

  // 3) "Add Son/Daughter" below their parents (top rows first)
  groups.filter(x => x.kind === "kids").sort((a, b) => a.gen - b.gen).forEach(gr => {
    const g = gr.gen - 1, C = gr.gen;
    const row = rowItems[C];
    const pi = gr.parentIds.map(id => idxIn(g, id)).filter(v => v >= 0);
    const ref = pi.length ? mean(pi) : 0;
    let at = 0, found = false;
    row.forEach((it, i) => {
      let pos = null;
      if (it.pid) { const pp = parentsOf(it.pid).map(x => idxIn(g, x)).filter(v => v >= 0); if (pp.length) pos = mean(pp); }
      else if (typeof it.pos === "number") pos = it.pos;
      if (pos === null) return;
      found = true;
      if (pos <= ref + 1e-9) at = i + 1;
    });
    if (!found) at = row.length;
    at = skipCouple(row, at);
    row.splice(at, 0, { ph: "son", target: gr.targetId, pos: ref }, { ph: "daughter", target: gr.targetId, pos: ref });
  });

  const rows = levels.map(g => {
    const html = (rowItems[g] || []).map(it => it.pid
      ? branchNode(personById(it.pid), it.pid === centerId)
      : addRelativeNode(it.ph, it.target)).join("");
    return `<div class="gen" data-gen="${g}">${html}</div>`;
  }).join("");
  const banner = treeViewing ? `<div class="tree-view-banner"><img src="/assets/tree-icon.png" alt=""><span>Aap <b>${esc(treeViewing.ownerName)}</b> ki tree dekh rahe hain (sirf dekhne ke liye). Aapki apni tree chhupi hui hai.</span><button type="button" class="primary" onclick="exitTreeView()">← Meri tree par wapas</button></div>` : "";
  const bp = branchView && personById(branchView.id);
  const banner2 = bp ? `<div class="tree-view-banner"><span><b>${esc(bp.name)}</b> ki family tree (unke parents, bhai-behen, unke bachhe aur sab ke bachhe)</span><button type="button" class="primary" onclick="exitBranch()">← Meri tree par wapas</button></div>` : "";
  return `${banner}${banner2}<div class="tree-canvas" id="treeCanvas">
    <div class="tree-sizer" id="treeSizer"><div class="tree-stage" id="treeStage">
      <svg id="treeLines" style="position:absolute;top:0;left:0;pointer-events:none;overflow:visible"></svg>
      ${rows || "<p class='muted'>No relationships recorded yet — tap the ＋ badge on your card to start the graph.</p>"}
    </div></div>
  </div>
  <div class="tree-controls">
    <button class="secondary" onclick="treeZoom(1.15)">＋ Zoom</button>
    <button class="secondary" onclick="treeZoom(0.87)">－ Zoom</button>
    <button class="ghost" onclick="treeFit()">⤢ Fit</button>
    <button class="ghost" onclick="treeReset()">Reset</button>
    <button class="ghost" onclick="treeFocusMe()">🎯 Focus Me</button>
  </div>`;
}

function addRelativeNode(typeKey, targetId) {
  const t = RELATION_TYPES[typeKey];
  return `<div class="branch-node add-node" id="${nodeElId(placeholderId(typeKey, targetId))}" data-ph="${typeKey}" data-target="${esc(targetId)}" onclick="openAddRelative('${targetId}','${typeKey}')">+ Add ${t.label}</div>`;
}

function kidsCaption(id) {
  const kids = childrenOf(id).map(personById).filter(Boolean);
  if (!kids.length) return "";
  const names = kids.map(k => (k.nickname && k.showNickname ? k.nickname : (k.name || "").split(" ")[0])).join(", ");
  return `<div class="mini of" title="Parent of ${esc(kids.map(k => k.name).join(", "))}">Parent of ${esc(names)}</div>`;
}
function branchNode(p, isCenter) {
  if (!p) return "";
  const expanded = treeExpanded.has(p.id);
  const addBadge = canAddRelativeTo(p.id) ? `<button type="button" class="tree-badge left${expanded ? " open" : ""}" title="${expanded ? "Close" : "Add relative"}" onclick="event.stopPropagation();toggleTreeExpand('${p.id}')">${expanded ? "✕" : "＋"}</button>` : "";
  // Top-right badge is ALWAYS the tree logo. If the person has their OWN account/tree, clicking opens (and shows) their tree
  // instead of mine; otherwise it just centres the tree on that person.
  const ownTree = !!supabase && !!currentUser && !!p.claimed_by && (treeViewing ? true : p.claimed_by !== currentUser.id);
  const backToMine = ownTree && treeViewing && p.claimed_by === currentUser.id;
  const branchable = !ownTree && !treeViewing && hidesParents(p.id);
  const isBranchRoot = !!branchView && branchView.id === p.id;
  const badgeTitle = ownTree ? (backToMine ? "Back to my tree" : "Open " + esc(p.name) + "'s own tree")
    : isBranchRoot ? "Back to my tree" : (branchable || branchView) ? "Open " + esc(p.name) + "'s family tree" : "Center tree on " + esc(p.name);
  const badgeClick = ownTree ? `openPersonTree('${p.id}')`
    : isBranchRoot ? `exitBranch()` : (branchable || branchView) ? `openBranch('${p.id}')` : `centerTree('${p.id}')`;
  // The tree icon only shows when this person really HAS a tree of their own: an account/tree of their own, or their own parents
  // recorded (e.g. a wife whose mother/father are added). Otherwise there is nothing to open, so no icon.
  const hasOwnTree = ownTree || isBranchRoot || parentsOf(p.id).some(x => personById(x));
  const centerBadge = hasOwnTree ? `<button type="button" class="tree-badge right own-tree" title="${badgeTitle}" onclick="event.stopPropagation();${badgeClick}"><img src="/assets/tree-icon-grey.png" alt="Tree"></button>` : "";
  const dodYear = p.details?.dod ? new Date(p.details.dod).getFullYear() : "";
  const years = p.dob ? `${new Date(p.dob).getFullYear()} –${dodYear ? " " + dodYear : ""}` : (dodYear ? `– ${dodYear}` : "–");
  return `<div class="branch-node ${p.me ? "me" : ""} ${isCenter && !p.me ? "me" : ""}" id="${nodeElId(p.id)}" style="position:relative;cursor:pointer" title="View profile" onclick="openProfilePopup('${p.id}')">
    ${addBadge}${centerBadge}
    ${avatarHTML(p, "photo" + (p.status !== "unclaimed" ? " claimed" : ""))}
    <strong>${esc(p.name)}</strong>
    <div class="mini">${years}${p.status === "unclaimed" ? " · Unclaimed" : ""}</div>
    <div class="mini rel">${deriveRelationship(me().id, p.id).label}</div>
    ${spouseCardLine(p) ? `<div class="mini sp">💍 ${esc(spouseCardLine(p))}</div>` : ""}
    ${kidsCaption(p.id)}
  </div>`;
}

/* Open the OWN tree of a person who has an account (e.g. my wife), hiding mine until I go back. */
async function fetchPersonTree(person) {
  const r = await supabase.rpc("get_person_tree", { p_person_id: person.id });
  if (!r.error && r.data) return r.data;
  if (r.error && !/get_person_tree|function|schema cache/i.test(r.error.message)) throw r.error; // installed, but refused
  // Fallback when the SQL helper isn't installed: plain queries (only works if RLS lets you read that tree)
  const { data: ft } = await supabase.from("family_trees").select("id").eq("owner_id", person.claimed_by).order("created_at").limit(1).maybeSingle();
  if (!ft) throw new Error("Is person ki apni tree nahi mili. Run supabase-view-other-tree.sql in Supabase.");
  const { data: members } = await supabase.from("tree_members").select("person_id, role").eq("tree_id", ft.id);
  const ids = (members || []).map(m => m.person_id);
  const { data: persons } = ids.length ? await supabase.from("persons").select("*").in("id", ids) : { data: [] };
  const { data: relationships } = await supabase.from("relationships").select("*").eq("tree_id", ft.id);
  return { tree_id: ft.id, members: members || [], persons: persons || [], relationships: relationships || [] };
}
async function openPersonTree(id) {
  const p = personById(id);
  if (!p || !supabase || !currentUser) return;
  if (p.claimed_by === currentUser.id) { exitTreeView(); return; } // that's me -> back to my own tree
  if (!p.claimed_by) { toast("Is person ki apni tree nahi hai"); return; }
  toast("Opening " + p.name + "'s tree…");
  let data;
  try { data = await fetchPersonTree(p); } catch (e) { toast(e.message || "Couldn't open this tree"); return; }
  const roleById = Object.fromEntries((data.members || []).map(m => [m.person_id, m.role]));
  const people = (data.persons || []).filter(x => !(x.details && x.details.deleted)).map(x => ({
    id: x.id, personCode: x.person_code, name: x.full_name, gender: x.gender, status: x.status, dob: x.dob, mobile: x.mobile, email: x.email,
    avatar_url: x.avatar_url, me: false, claimed_by: x.claimed_by, created_by: x.created_by, privacy: "Family only", nickname: x.nickname,
    showNickname: x.show_nickname, birthPlace: x.birth_place, currentPlace: x.current_place, lifeStatus: x.life_status, details: x.details || {},
    treeRole: roleById[x.id] || "member", external: true
  }));
  if (people.length <= 1) { toast(p.name + " ne abhi apni tree mein koi family member add nahi kiya"); return; }
  const ids = new Set(people.map(x => x.id));
  const rels = (data.relationships || []).filter(r => r.status !== "removed" && ids.has(r.person_a_id) && ids.has(r.person_b_id))
    .map(r => ({ id: r.id, from: r.person_a_id, to: r.person_b_id, type: r.relationship_type, status: r.status, tree_id: r.tree_id }));
  if (!treeViewing) treeViewing = { backup: { people: state.people, relationships: state.relationships, treeCenterId, treeExpanded, treeScale } };
  treeViewing.ownerId = p.id;
  treeViewing.ownerName = p.name;
  state.people = people;
  state.relationships = rels;
  treeExpanded = new Set();
  treeCenterId = p.id;
  treeScale = 1;
  go("tree");
}
function exitTreeView(rerender = true) {
  if (!treeViewing) return;
  const b = treeViewing.backup;
  state.people = b.people; state.relationships = b.relationships;
  treeCenterId = b.treeCenterId; treeExpanded = b.treeExpanded; treeScale = b.treeScale;
  treeViewing = null;
  if (rerender) { go("tree"); requestAnimationFrame(drawTreeConnectors); }
}

/* Re-draw ONLY the tree (not the whole app) and keep the view steady:
   - scroll position + zoom are preserved (a full render() rebuilt the canvas, reset scroll and re-centred on "me",
     which is what made the layout "jump" on every ＋ tap)
   - the card you tapped is anchored: it stays under your finger even if the layout re-flows around it. */
function refreshTreeInPlace(anchorKey, r0) {
  const main = document.querySelector("main.content"), oldCv = document.getElementById("treeCanvas");
  if (!main || !oldCv || (location.hash || "").slice(1) !== "tree") { render(); requestAnimationFrame(drawTreeConnectors); return; }
  const sl = oldCv.scrollLeft, st = oldCv.scrollTop;
  main.style.minHeight = main.offsetHeight + "px"; // page must not collapse (and scroll-jump) while we swap the markup
  main.innerHTML = pageView("tree");
  const cv = document.getElementById("treeCanvas");
  if (cv) cv.dataset.centered = "1"; // do NOT re-centre on "me"
  drawTreeConnectors();               // synchronous: sizes the canvas, so scroll can be restored below
  if (cv) {
    cv.scrollLeft = sl; cv.scrollTop = st;
    const el = anchorKey && document.getElementById(anchorKey);
    if (el && r0) {
      const r1 = el.getBoundingClientRect();
      cv.scrollLeft += r1.left - r0.left;
      window.scrollBy(0, r1.top - r0.top);
    }
  }
  main.style.minHeight = "";
}
function toggleTreeExpand(id) {
  const key = nodeElId(id), el = document.getElementById(key), r0 = el ? el.getBoundingClientRect() : null;
  if (treeExpanded.has(id)) treeExpanded.delete(id); else treeExpanded.add(id);
  refreshTreeInPlace(key, r0);
}

function centerTree(id) { branchView = null; treeCenterId = id; treeScale = 1; go("tree"); requestAnimationFrame(drawTreeConnectors); }
/* Live tree search: type part of a name, nickname or Person ID; pick a result to jump to that person
   (Branch view re-centres on them, Chart view opens their family line) and flash their card. */
function treeSearchMatches(val) {
  const q = String(val || "").trim().toLowerCase(); if (!q) return [];
  const tokens = q.split(/\s+/);
  const hay = p => [p.name, p.nickname, p.personCode, p.id].filter(Boolean).join(" ").toLowerCase();
  const startsAt = p => (p.name || "").toLowerCase().startsWith(q) ? 0 : (p.personCode || p.id || "").toLowerCase() === q ? 0 : 1;
  return state.people.filter(p => !(p.details && p.details.deleted) && tokens.every(t => hay(p).includes(t)))
    .sort((a, b) => startsAt(a) - startsAt(b) || String(a.name).localeCompare(String(b.name))).slice(0, 8);
}
function treeSearchInput(val) {
  const box = document.getElementById("treeSearchResults"); if (!box) return;
  if (!String(val || "").trim()) { box.hidden = true; box.innerHTML = ""; return; }
  const list = treeSearchMatches(val);
  const meId = (myself() || me() || {}).id;
  box.innerHTML = list.length ? list.map(p => {
    let rel = ""; try { if (meId) rel = deriveRelationship(meId, p.id).label; } catch (e) {}
    const yr = p.dob ? String(p.dob).slice(0, 4) : "";
    return `<button type="button" class="sr-item" onmousedown="event.preventDefault();treeSearchPick('${esc(p.id)}')">${avatarHTML(p, "sr-av")}<span class="sr-txt"><b>${esc(p.name)}</b><span class="muted">${esc([rel && rel !== "Not connected" ? rel : "", yr, p.personCode || p.id].filter(Boolean).join(" · "))}${p.status === "unclaimed" ? " · Unclaimed" : ""}${kinLine(p) ? `<br>${esc(kinLine(p))}` : ""}</span></span></button>`;
  }).join("") : `<div class="sr-empty muted">Koi match nahi mila</div>`;
  box.hidden = false;
}
function treeSearchKey(e) {
  if (e.key === "Escape") { const b = document.getElementById("treeSearchResults"); if (b) b.hidden = true; e.target.blur(); return; }
  if (e.key === "Enter") { e.preventDefault(); const first = treeSearchMatches(e.target.value)[0]; if (first) treeSearchPick(first.id); else toast("Person not found"); }
}
function treeSearchPick(id) {
  const box = document.getElementById("treeSearchResults"); if (box) box.hidden = true;
  if (!personById(id)) { toast("Person not found"); return; }
  if (treeStyle === "chart") chartGoFamily(id); else centerTree(id);
  flashFoundCard(id);
}
function flashFoundCard(id, tries) {
  tries = tries || 0;
  const el = document.getElementById(nodeElId(id)) || [...document.querySelectorAll(".ch-card")].find(x => x.dataset.id === id);
  if (!el) { if (tries < 12) setTimeout(() => flashFoundCard(id, tries + 1), 100); return; }
  try { el.scrollIntoView({ block: "center", inline: "center", behavior: "smooth" }); } catch (e) {}
  el.classList.add("search-hit"); setTimeout(() => el.classList.remove("search-hit"), 2600);
}
document.addEventListener("click", e => { if (!e.target.closest || !e.target.closest(".top-search-wrap")) { const b = document.getElementById("treeSearchResults"); if (b) b.hidden = true; } });
function treeSearch(val) { const m = treeSearchMatches(val)[0]; if (m) treeSearchPick(m.id); else toast("Person not found"); }
/* ---- Zoom: buttons, two-finger pinch (mobile) and Ctrl+wheel / trackpad pinch (desktop) ----
   The stage is scaled with a transform, and #treeSizer is given the SCALED size, so the canvas always
   scrolls over exactly what is visible (zoomed-in tree is never cut off on the left/top). The point
   between your two fingers stays fixed while zooming. */
const TREE_MIN_SCALE = 0.35, TREE_MAX_SCALE = 2.5;
function syncTreeSize() {
  const stage = document.getElementById("treeStage"), sizer = document.getElementById("treeSizer");
  if (!stage || !sizer) return;
  stage.style.transform = `scale(${treeScale})`;
  sizer.style.width = Math.ceil(stage.offsetWidth * treeScale) + "px";
  sizer.style.height = Math.ceil(stage.offsetHeight * treeScale) + "px";
}
function setTreeScale(next, fx, fy) {
  next = Math.max(TREE_MIN_SCALE, Math.min(TREE_MAX_SCALE, next));
  const canvas = document.getElementById("treeCanvas"), sizer = document.getElementById("treeSizer");
  if (!canvas || !sizer) { treeScale = next; return; }
  if (fx === undefined) { // buttons: zoom around the middle of the visible canvas
    const r = canvas.getBoundingClientRect();
    fx = r.left + r.width / 2; fy = Math.min(Math.max(window.innerHeight / 2, r.top), r.bottom);
  }
  const before = sizer.getBoundingClientRect();
  const px = (fx - before.left) / treeScale, py = (fy - before.top) / treeScale; // point under the fingers, in unscaled tree px
  treeScale = next;
  syncTreeSize();
  const after = sizer.getBoundingClientRect();
  canvas.scrollLeft += (after.left + px * next) - fx;
  window.scrollBy(0, (after.top + py * next) - fy);
}
function treeZoom(n) { setTreeScale(treeScale * n); }
function treeFit() { // whole tree visible on screen
  const canvas = document.getElementById("treeCanvas"), stage = document.getElementById("treeStage");
  if (!canvas || !stage) return;
  treeScale = Math.max(TREE_MIN_SCALE, Math.min(1, (canvas.clientWidth - 48) / Math.max(stage.offsetWidth, 1)));
  syncTreeSize(); canvas.scrollLeft = 0;
}
function treeReset() { treeScale = 1; syncTreeSize(); centerTreeOnMe(); }
function centerTreeOnMe() {
  const canvas = document.getElementById("treeCanvas"), sizer = document.getElementById("treeSizer"), stage = document.getElementById("treeStage");
  if (!canvas || !sizer || !stage) return;
  const node = stage.querySelector(".branch-node.me"); if (!node) return;
  let x = 0, n = node; while (n && n !== stage) { x += n.offsetLeft; n = n.offsetParent; }
  canvas.scrollLeft = Math.max(0, sizer.offsetLeft + (x + node.offsetWidth / 2) * treeScale - canvas.clientWidth / 2);
  /* Vertical too: the tree is tall, and at 100% on a phone the top-left of the canvas is empty (the oldest
     ancestors sit at the far right), so without this the user lands on a blank area and must zoom out to see it. */
  const r = node.getBoundingClientRect();
  const dy = r.top + r.height / 2 - window.innerHeight / 2;
  if (Math.abs(dy) > 40) window.scrollBy(0, dy);
}
/* Mouse drag-to-pan for the Branch tree (touch keeps native scrolling). A drag never counts as a click on a card/button. */
(function initTreeMousePan() {
  let pan = null, moved = false;
  document.addEventListener("pointerdown", e => {
    if (e.pointerType !== "mouse" || e.button !== 0) return;
    const cv = e.target.closest && e.target.closest("#treeCanvas"); if (!cv) return;
    if (e.target.closest("input,textarea,select,a")) return;
    pan = { x: e.clientX, y: e.clientY, l: cv.scrollLeft, t: cv.scrollTop, cv }; moved = false;
  });
  window.addEventListener("pointermove", e => {
    if (!pan) return;
    const dx = e.clientX - pan.x, dy = e.clientY - pan.y;
    if (!moved && Math.abs(dx) + Math.abs(dy) > 5) { moved = true; pan.cv.classList.add("grab"); }
    if (moved) { pan.cv.scrollLeft = pan.l - dx; pan.cv.scrollTop = pan.t - dy; e.preventDefault(); }
  });
  const end = () => { if (!pan) return; pan.cv.classList.remove("grab"); pan = null; setTimeout(() => { moved = false; }, 0); };
  window.addEventListener("pointerup", end); window.addEventListener("pointercancel", end);
  document.addEventListener("click", e => { if (moved) { e.stopPropagation(); e.preventDefault(); } }, true);
  document.addEventListener("dragstart", e => { if (e.target.closest && e.target.closest("#treeCanvas")) e.preventDefault(); });
})();
(function initTreePinch() {
  let pinch = null;
  const dist = t => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
  const inCanvas = e => !!(e.target && e.target.closest && e.target.closest("#treeCanvas"));
  document.addEventListener("touchstart", e => {
    if (e.touches.length === 2 && inCanvas(e)) { pinch = { d0: Math.max(dist(e.touches), 1), s0: treeScale }; e.preventDefault(); }
  }, { passive: false });
  document.addEventListener("touchmove", e => {
    if (!pinch) return;
    if (e.touches.length !== 2) return;
    e.preventDefault();
    const fx = (e.touches[0].clientX + e.touches[1].clientX) / 2, fy = (e.touches[0].clientY + e.touches[1].clientY) / 2;
    setTreeScale(pinch.s0 * dist(e.touches) / pinch.d0, fx, fy);
  }, { passive: false });
  const end = e => { if (pinch && e.touches.length < 2) pinch = null; };
  document.addEventListener("touchend", end);
  document.addEventListener("touchcancel", end);
  // iOS Safari would otherwise zoom the whole page on pinch
  document.addEventListener("gesturestart", e => { if (inCanvas(e)) e.preventDefault(); });
  document.addEventListener("gesturechange", e => { if (inCanvas(e)) e.preventDefault(); });
  document.addEventListener("wheel", e => {
    if (!(e.ctrlKey || e.metaKey) || !inCanvas(e)) return;
    e.preventDefault();
    setTreeScale(treeScale * Math.exp(-e.deltaY * 0.0025), e.clientX, e.clientY);
  }, { passive: false });
})();
function treeFocusMe() { branchView = null; treeCenterId = me().id; treeReset(); go("tree"); requestAnimationFrame(drawTreeConnectors); }

/* Draw the org-chart style connector lines (branch lines + junction dots)
   between rendered tree nodes, using their actual DOM positions so the
   layout always matches whatever the browser/flexbox produced. */
/* ---- Tree row layout: every family's children sit directly UNDER their own parents ----
   (instead of every generation row being centred as one block). Pure function: takes the measured
   cards of each generation row (top to bottom) and returns an x position for every card.
   Classic "tidy tree": a unit (person + partner) owns a slot as wide as its children need, sits
   centred over them, and sibling families never overlap. */
function computeTreeRowLayout(rows, opts) {
  const GAP = (opts && opts.gap) || 30, UNIT_GAP = (opts && opts.unitGap) || 38;
  const inTree = new Set();
  rows.forEach(r => r.forEach(c => { if (c.pid) inTree.add(c.pid); }));
  const present = id => inTree.has(id);
  const famParents = childId => {
    let ps = parentsOf(childId).filter(present);
    if (ps.length === 1) {
      const sp = spousesOf(ps[0]).find(x => present(x) && !ps.includes(x) && childrenOf(ps[0]).some(c => c !== childId && parentsOf(c).includes(x)));
      if (sp) ps = [ps[0], sp];
    }
    return ps;
  };
  const parentsFor = c => {
    if (c.pid) return famParents(c.pid);
    if (c.ph === "brother" || c.ph === "sister") return famParents(c.target);
    if (c.ph === "son" || c.ph === "daughter") {
      const firstKid = childrenOf(c.target).find(k => present(k));
      if (firstKid) return famParents(firstKid);
      return [c.target, spousesOf(c.target).find(present)].filter(x => x && present(x));
    }
    return [];
  };
  const isParentPh = c => c.ph === "father" || c.ph === "mother";
  const partner1 = (a, b) => // is b the partner of a?
    (a.pid && b.pid && (spousesOf(a.pid).includes(b.pid) || spousesOf(b.pid).includes(a.pid))) ||
    ((b.ph === "husband" || b.ph === "wife") && b.target === a.pid) ||
    (isParentPh(b) && a.pid && parentsOf(b.target).includes(a.pid)) ||
    (isParentPh(a) && b.pid && parentsOf(a.target).includes(b.pid)) ||
    (isParentPh(a) && isParentPh(b) && a.target === b.target);
  const partner = (a, b) => !!a && !!b && (partner1(a, b) || partner1(b, a));

  // 1) units per row (a person + their partner / "Add partner" box)
  const unitsByRow = rows.map(cards => {
    const us = [];
    cards.forEach((c, i) => { const u = us[us.length - 1]; if (u && partner(cards[i - 1], c)) u.cards.push(c); else us.push({ cards: [c], kids: [], parent: null }); });
    us.forEach(u => { u.w = u.cards.reduce((t, c) => t + c.w, 0) + GAP * (u.cards.length - 1); u.pids = u.cards.map(c => c.pid).filter(Boolean); });
    return us;
  });
  // 2) link every unit to the unit of its parents in the row above
  unitsByRow.forEach((us, r) => {
    const next = unitsByRow[r + 1] || [];
    us.forEach(u => next.forEach(k => {
      if (k.parent) return;
      const hit = k.cards.some(c => parentsFor(c).some(p => u.pids.includes(p))) ||
        u.cards.some(c => isParentPh(c) && k.pids.includes(c.target));
      if (hit) { k.parent = u; u.kids.push(k); }
    }));
  });
  // 3) slot width = widest of (the unit itself, all its children side by side)
  const slot = u => {
    if (u.slot !== undefined) return u.slot;
    u.kidsW = u.kids.length ? u.kids.reduce((t, k) => t + slot(k), 0) + UNIT_GAP * (u.kids.length - 1) : 0;
    return (u.slot = Math.max(u.w, u.kidsW));
  };
  const left = new Map();
  const place = (u, edge) => {
    let x = edge + (slot(u) - u.w) / 2;
    u.cards.forEach(c => { left.set(c.key, x); x += c.w + GAP; });
    let kx = edge + (u.slot - u.kidsW) / 2;
    u.kids.forEach(k => { place(k, kx); kx += k.slot + UNIT_GAP; });
  };
  // 4) place every family tree that starts at a unit without parents, left to right
  unitsByRow.forEach((us, r) => us.forEach(u => {
    if (u.parent) return;
    let edge = 0;
    rows.forEach((cards, rr) => cards.forEach(c => { if (left.has(c.key)) edge = Math.max(edge, left.get(c.key) + c.w + UNIT_GAP); }));
    place(u, edge);
  }));
  const all = rows.flat();
  const minX = Math.min(...all.map(c => left.get(c.key)));
  const maxX = Math.max(...all.map(c => left.get(c.key) + c.w));
  return { positions: all.map(c => ({ key: c.key, x: left.get(c.key) - minX })), width: maxX - minX };
}
function layoutTreeRows(stage) {
  const rowEls = [...stage.querySelectorAll(":scope > .gen")];
  if (!rowEls.length) return;
  const elToPid = new Map(state.people.map(p => [nodeElId(p.id), p.id]));
  rowEls.forEach(row => {
    row.style.cssText = "";
    [...row.children].forEach(el => {
      if (el.dataset.basePos === undefined) el.dataset.basePos = el.style.position || "";
      el.style.position = el.dataset.basePos; el.style.left = ""; el.style.top = ""; el.style.flex = "";
    });
  });
  const rows = rowEls.map(row => [...row.children].map(el => ({ el, key: el.id, pid: elToPid.get(el.id) || null, ph: el.dataset.ph || null, target: el.dataset.target || null, w: el.offsetWidth, h: el.offsetHeight })));
  const res = computeTreeRowLayout(rows);
  const posOf = new Map(res.positions.map(p => [p.key, p.x]));
  rowEls.forEach((row, i) => {
    const cs = getComputedStyle(row), pad = parseFloat(cs.paddingBottom) || 0;
    const maxH = Math.max(...rows[i].map(c => c.h));
    row.style.display = "block"; row.style.position = "relative"; row.style.width = res.width + "px";
    row.style.height = (cs.boxSizing === "border-box" ? maxH + pad : maxH) + "px";
    rows[i].forEach(c => { c.el.style.position = "absolute"; c.el.style.top = "0"; c.el.style.left = posOf.get(c.key) + "px"; c.el.style.flex = "none"; });
  });
}
function drawTreeConnectors() {
  const stage = document.getElementById("treeStage");
  const svg = document.getElementById("treeLines");
  if (!stage || !svg) return;
  layoutTreeRows(stage);
  const LINE = "#c9bfa8", DOT = "#4a2e6b";
  const get = key => document.getElementById(nodeElId(key));
  // IMPORTANT: .gen rows are position:relative, so offsetLeft/offsetTop are relative to the ROW,
  // not the stage. Walk the offsetParent chain so every coordinate is relative to the stage.
  const rect = el => {
    let x = 0, y = 0, n = el;
    while (n && n !== stage) { x += n.offsetLeft; y += n.offsetTop; n = n.offsetParent; }
    return { x, y, w: el.offsetWidth, h: el.offsetHeight };
  };
  const mean = arr => arr.reduce((s, v) => s + v, 0) / arr.length;
  const parts = [];
  const dot = (x, y) => parts.push(`<circle cx="${x}" cy="${y}" r="4" fill="${DOT}"/>`);
  const line = (x1, y1, x2, y2) => parts.push(`<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${LINE}" stroke-width="2"/>`);

  // 1) spouse links (real + "Add Husband/Wife" placeholder), dot in the middle of the link
  const pairs = [];
  state.people.forEach(p => {
    if (!get(p.id)) return;
    spousesOf(p.id).forEach(s => { if (get(s)) pairs.push([p.id, s]); });
    if (treeExpanded.has(p.id) && !spousesOf(p.id).length) {
      const ph = placeholderId(p.gender === "Female" ? "husband" : "wife", p.id);
      if (get(ph)) pairs.push([p.id, ph]);
    }
  });
  const seenPairs = new Set();
  const gapOf = (a, b) => { // couple gap geometry, or null if the two cards are not side by side
    const ra = rect(a), rb = rect(b);
    const L = ra.x < rb.x ? ra : rb, R = ra.x < rb.x ? rb : ra;
    if (Math.abs(L.y - R.y) > 6) return null;
    const x1 = L.x + L.w, x2 = R.x;
    if (x2 - x1 > 90) return null;
    return { x1, x2, mid: (x1 + x2) / 2, y: L.y + L.h / 2 };
  };
  pairs.forEach(([a, b]) => {
    const k = [a, b].sort().join("|");
    if (seenPairs.has(k)) return;
    seenPairs.add(k);
    const g = gapOf(get(a), get(b));
    if (!g) return;
    line(g.x1, g.y, g.x2, g.y);
    dot(g.mid, g.y);
  });

  // 2) parent(s) -> child units. Every child's OWN parents connect to THAT child's top-centre
  //    (never to the middle of the husband+wife couple).
  const units = new Map();
  const addUnit = (parentKeys, kidKey) => {
    const keys = [...new Set(parentKeys)].filter(get);
    if (!keys.length || !get(kidKey)) return;
    const k = [...keys].sort().join("|");
    if (!units.has(k)) units.set(k, { parents: keys, kids: new Set() });
    units.get(k).kids.add(kidKey);
  };
  // Siblings must share ONE bus line. If only one parent is recorded for this child but that parent's
  // spouse is also on screen and they share another child, treat the couple as the parent unit.
  const familyKeys = (childId, keys) => {
    keys = keys.filter(get);
    if (keys.length === 1) {
      const sp = spousesOf(keys[0]).find(s => get(s) && !keys.includes(s) &&
        childrenOf(keys[0]).some(c => c !== childId && parentsOf(c).includes(s)));
      if (sp) keys = [keys[0], sp];
    }
    return keys;
  };
  state.people.forEach(p => {
    if (!get(p.id)) return;
    let keys = familyKeys(p.id, parentsOf(p.id));
    if (treeExpanded.has(p.id)) ["father", "mother"].forEach(t => { const ph = placeholderId(t, p.id); if (get(ph)) keys.push(ph); });
    addUnit(keys, p.id);
  });
  treeExpanded.forEach(id => {
    if (!get(id)) return;
    // "Add Brother/Sister" boxes hang off the SAME parent bus as the person's real siblings
    const sibPhs = ["brother", "sister"].map(t => placeholderId(t, id)).filter(get);
    if (sibPhs.length) { const fk = familyKeys(id, parentsOf(id)); sibPhs.forEach(k => addUnit(fk, k)); }
    const kidPhs = ["son", "daughter"].map(t => placeholderId(t, id)).filter(get);
    if (!kidPhs.length) return;
    const firstKid = childrenOf(id).find(c => get(c));
    let parentKeys;
    if (firstKid) parentKeys = parentsOf(firstKid); // join the existing family bus instead of drawing a second one
    else { const sp = spousesOf(id).find(s => get(s)); parentKeys = sp ? [id, sp] : [id]; }
    kidPhs.forEach(k => addUnit(parentKeys, k));
  });

  const info = [];
  units.forEach(u => {
    const pr = u.parents.map(k => rect(get(k)));
    const kr = [...u.kids].map(k => ({ r: rect(get(k)) }));
    const pBottom = Math.max(...pr.map(r => r.y + r.h));
    const kTop = Math.min(...kr.map(o => o.r.y));
    if (kTop <= pBottom) return;
    let dropX, startY, bottomStart = false;
    if (u.parents.length === 2 && gapOf(get(u.parents[0]), get(u.parents[1]))) {
      const g = gapOf(get(u.parents[0]), get(u.parents[1]));
      dropX = g.mid; startY = g.y; // from the dot between the two parents
      const pk = [u.parents[0], u.parents[1]].sort().join("|");
      if (!seenPairs.has(pk)) { seenPairs.add(pk); line(g.x1, g.y, g.x2, g.y); dot(g.mid, g.y); } // two parents shown side by side but not linked as spouses: still draw the couple link so the line doesn't start from thin air
    } else if (u.parents.length === 1) {
      const pk = u.parents[0];
      const pair = pairs.find(([a, b]) => a === pk || b === pk);
      const g = pair ? gapOf(get(pair[0]), get(pair[1])) : null;
      if (g) { dropX = g.mid; startY = g.y; }
      else { dropX = pr[0].x + pr[0].w / 2; startY = pBottom; bottomStart = true; }
    } else {
      dropX = mean(pr.map(r => r.x + r.w / 2)); startY = pBottom; bottomStart = true;
    }
    const kx = kr.map(o => o.r.x + o.r.w / 2);
    info.push({ dropX, startY, bottomStart, kids: kr, pBottom, kTop, minX: Math.min(dropX, ...kx), maxX: Math.max(dropX, ...kx) });
  });
  // ---- Every family unit (a couple + THEIR children) gets its own bus line ("lane"). ----
  // Lanes are ordered so that as few lines as possible cross each other, and any crossing that is
  // still unavoidable is drawn as a small "hop" so it never looks like two families are joined.
  info.forEach((u, i) => { u.uid = i; u.straight = u.kids.length === 1 && Math.abs(u.maxX - u.minX) < 1.5; });
  const laneGroups = {};
  info.filter(u => !u.straight).forEach(u => { const k = u.pBottom + "|" + u.kTop; (laneGroups[k] = laneGroups[k] || []).push(u); });
  Object.values(laneGroups).forEach(assignConnectorLanes);

  const H = [], V = [], dots = [];
  info.forEach(u => {
    if (u.bottomStart) dots.push([u.dropX, u.startY]);
    if (u.straight) { // one child straight below its parents: no bus needed
      const o = u.kids[0], cx = o.r.x + o.r.w / 2;
      V.push({ x: cx, y1: u.startY, y2: o.r.y, uid: u.uid }); dots.push([cx, o.r.y]);
      return;
    }
    const busY = u.pBottom + (u.kTop - u.pBottom) * (u.lane + 1) / (u.laneCount + 1);
    V.push({ x: u.dropX, y1: u.startY, y2: busY, uid: u.uid });
    if (u.minX < u.maxX) H.push({ y: busY, x1: u.minX, x2: u.maxX, uid: u.uid });
    u.kids.forEach(o => { const cx = o.r.x + o.r.w / 2; V.push({ x: cx, y1: busY, y2: o.r.y, uid: u.uid }); dots.push([cx, o.r.y]); });
  });
  H.forEach(h => line(h.x1, h.y, h.x2, h.y));
  const HOP = 5;
  V.forEach(v => {
    const cuts = H.filter(h => h.uid !== v.uid && h.y > v.y1 + HOP + 2 && h.y < v.y2 - HOP - 2 && v.x > h.x1 + 3 && v.x < h.x2 - 3).map(h => h.y).sort((a, b) => a - b);
    let d = `M ${v.x} ${v.y1}`;
    cuts.forEach(y => { d += ` V ${y - HOP} A ${HOP} ${HOP} 0 0 1 ${v.x} ${y + HOP}`; });
    d += ` V ${v.y2}`;
    parts.push(`<path d="${d}" fill="none" stroke="${LINE}" stroke-width="2"/>`);
  });
  dots.forEach(([x, y]) => dot(x, y));

  svg.setAttribute("width", stage.scrollWidth);
  svg.setAttribute("height", stage.scrollHeight);
  svg.innerHTML = parts.join("");
  syncTreeSize();
  const cv = document.getElementById("treeCanvas");
  if (cv && cv.dataset.centered !== "1") { cv.dataset.centered = "1"; centerTreeOnMe(); } // first draw: bring "me" into view (matters on phones)
}
/* Choose the vertical order (lane) of the family bus lines inside one parent-row/child-row gap.
   Tries every order (up to 7 families) and keeps the one with the fewest line crossings. */
function assignConnectorLanes(list) {
  list.sort((a, b) => a.minX - b.minX);
  const EPS = 0.5;
  const overlap = (a, b) => !(a.maxX + 14 < b.minX || a.minX - 14 > b.maxX);
  const inside = (x, u) => x > u.minX + EPS && x < u.maxX - EPS;
  const crossCost = (a, b) => { // a's bus is ABOVE b's bus
    let c = 0;
    a.kids.forEach(o => { if (inside(o.r.x + o.r.w / 2, b)) c++; }); // a child drop of a passes b's bus
    if (inside(b.dropX, a)) c++;                                     // b's parent drop passes a's bus
    return c;
  };
  const layout = order => {
    const lane = new Map(); let cost = 0, maxLane = 0;
    order.forEach((u, i) => {
      let l = 0;
      for (let j = 0; j < i; j++) { const v = order[j]; if (overlap(u, v)) { l = Math.max(l, lane.get(v) + 1); cost += crossCost(v, u); } }
      lane.set(u, l); if (l > maxLane) maxLane = l;
    });
    return { lane, maxLane, cost: cost * 100 + maxLane };
  };
  let best = layout(list);
  if (list.length > 1 && list.length <= 7) {
    const perm = (arr, k) => {
      if (k === arr.length) { const r = layout(arr); if (r.cost < best.cost) best = r; return; }
      for (let i = k; i < arr.length; i++) { [arr[k], arr[i]] = [arr[i], arr[k]]; perm(arr, k + 1); [arr[k], arr[i]] = [arr[i], arr[k]]; }
    };
    perm(list.slice(), 0);
  }
  list.forEach(u => { u.lane = best.lane.get(u); u.laneCount = best.maxLane + 1; });
}
window.addEventListener("resize", () => { if ((location.hash || "").slice(1) === "tree") drawTreeConnectors(); });
// web fonts (Fraunces/Inter) load late and change text metrics -> re-measure so cards and connector lines stay aligned
if (document.fonts && document.fonts.addEventListener) document.fonts.addEventListener("loadingdone", () => { if ((location.hash || "").slice(1) === "tree") drawTreeConnectors(); });
// phone rotation / address-bar show-hide
window.addEventListener("orientationchange", () => setTimeout(() => { if ((location.hash || "").slice(1) === "tree") drawTreeConnectors(); }, 250));

/* ---------------- add person — creates real graph edges ---------------- */
function add() {
  const opts = state.people.map(p => `<option value="${p.id}" ${p.id === me().id ? "selected" : ""}>${esc(p.name)} — ${esc(p.personCode || p.id)}</option>`).join("");
  return `<div class="page-head"><h2>Add Family Member</h2><p class="muted">Connect an existing person by Unique ID, or create a new profile and link it into the family graph with a real relationship edge.</p></div>
  <div class="card form">
    <div class="field"><label>Unique Person ID</label><input id="pid" placeholder="e.g. P-10004"></div>
    <button class="secondary" style="justify-self:start" onclick="findPerson()">Search Existing Person</button>
  </div>
  <div class="card form">
    <h3>Create New Person</h3>
    <div class="field"><label>Name</label><input id="pname" placeholder="Full name"></div>
    <div class="field"><label>Gender</label><select id="pgender"><option>Male</option><option>Female</option><option>Other</option></select></div>
    <div class="field"><label>Mobile</label><input id="pmobile" placeholder="Optional"></div>
    <hr class="divider">
    <div class="field"><label>Add as</label><select id="prel">
      <option value="parent">Parent of…</option><option value="child">Child of…</option>
      <option value="spouse">Spouse of…</option><option value="sibling">Sibling of…</option>
    </select></div>
    <div class="field"><label>Relative to</label><select id="prelto">${opts}</select></div>
    <button class="primary" style="justify-self:start" onclick="createPerson()">Create Person &amp; Link</button>
  </div>`;
}
async function findPerson() {
  const id = document.getElementById("pid").value.trim();
  const p = state.people.find(x => x.id === id) || (supabase ? (await supabase.from('persons').select('*').eq('person_code',id).maybeSingle()).data : null);
  if (p) { const personId=p.id; if(supabase) { const {error}=await supabase.from('connection_requests').insert({tree_id:state.treeId,requested_by:currentUser.id,person_id:personId}); if(error) return toast(error.message); } toast(`${p.name || p.full_name} found — connection request created`); await loadProductionState(currentUser); render(); }
  else toast("Person not found");
}
function createPerson() {
  if (!canEditTree()) { toast("Only this tree's owner or admins can add people"); return; }
  const name = document.getElementById("pname").value.trim();
  if (!name) { toast("Enter a name"); return; }
  const id = crypto.randomUUID();
  const gender = document.getElementById("pgender").value;
  const mode = document.getElementById("prel").value;
  const relTo = document.getElementById("prelto").value;
  state.people.push({ id, personCode: "P-" + Math.floor(10000 + Math.random() * 89999), name, gender, status: "unclaimed", mobile: document.getElementById("pmobile").value || undefined, created_by: currentUser?.id });

  // acceptance tests 4/5: adding a parent/spouse/child updates the graph on both sides
  if (mode === "parent") addEdge(id, relTo, "parent");
  else if (mode === "child") addEdge(relTo, id, "parent");
  else if (mode === "spouse") addEdge(relTo, id, "spouse");
  else if (mode === "sibling") parentsOf(relTo).forEach(parentId => addEdge(parentId, id, "parent"));

  save();
  toast(`Unclaimed profile created: ${id} — linked to the family graph`);
  treeCenterId = id;
  go("people");
}

/* ---------------- Add Relative — rich form (photo, contact, life details) ---------------- */
function openAddRelative(targetId, typeKey) {
  if (!canAddRelativeTo(targetId)) { toast("Only this tree's owner or admins can add relatives to other people"); return; }
  if ((RELATION_TYPES[typeKey] || {}).edgeType === "sibling" && !parentsOf(targetId).length) { toast("Brother/Sister add karne ke liye pehle parents (Father/Mother) add karein"); return; }
  addRelativeTargetId = targetId;
  addRelativeTypeKey = typeKey;
  addRelativeMode = "new";
  arFoundPerson = null;
  addRelativePhotoFile = null;
  addRelativePersonId = crypto.randomUUID();
  go("addRelative");
}
function pickAddRelativePhoto() {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "image/png,image/jpeg,image/webp,image/gif";
  input.onchange = () => {
    const file = input.files && input.files[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) { toast("Please choose an image file"); return; }
    if (file.size > 5 * 1024 * 1024) { toast("Image must be under 5MB"); return; }
    addRelativePhotoFile = file;
    const preview = document.getElementById("arPhotoPreview");
    if (preview) preview.innerHTML = `<img src="${URL.createObjectURL(file)}" style="width:100%;height:100%;object-fit:cover;border-radius:50%">`;
  };
  input.click();
}
function addRelative() {
  const target = personById(addRelativeTargetId) || me();
  const t = RELATION_TYPES[addRelativeTypeKey] || RELATION_TYPES.son;
  const isSpouseRel = t.edgeType === "spouse";
  const gOpt = v => `<option value="${v}" ${t.gender === v ? "selected" : ""}>${v}</option>`;
  return `<div class="page-head"><h2>Add ${esc(t.label)} to ${esc(target.name)}</h2><p class="muted">Fill in what you know — you can always add more later.</p></div>
  <div class="card form">
    <div class="field"><label>Who do you want to add?</label>
      <div class="view-switch" id="arModeSwitch">
        <button type="button" data-mode="new" class="${addRelativeMode === 'new' ? 'active' : ''}" onclick="setAddRelativeMode('new')">➕ New member</button>
        <button type="button" data-mode="existing" class="${addRelativeMode === 'existing' ? 'active' : ''}" onclick="setAddRelativeMode('existing')">👥 From tree</button>
        <button type="button" data-mode="uid" class="${addRelativeMode === 'uid' ? 'active' : ''}" onclick="setAddRelativeMode('uid')">🔎 Add by Unique ID</button>
      </div>
    </div>
    <div class="field"><label>Relationship type</label>
      <select id="arRelType" onchange="arRelTypeChanged()">${Object.entries(RELATION_TYPES).map(([k, v]) => `<option value="${k}" ${k === addRelativeTypeKey ? "selected" : ""}>${v.label}</option>`).join("")}</select>
    </div>
  </div>
  <div id="arNewWrap" style="${addRelativeMode === 'new' ? '' : 'display:none'}">
  <div class="card form">
    <div style="display:flex;align-items:center;gap:14px;margin-bottom:6px">
      <div id="arPhotoPreview" onclick="pickAddRelativePhoto()" style="width:64px;height:64px;border-radius:50%;background:var(--sand,#f1e9d8);display:flex;align-items:center;justify-content:center;cursor:pointer;font-size:22px;color:var(--muted,#8a8478);flex-shrink:0">+</div>
      <button class="ghost" onclick="pickAddRelativePhoto()">Add a profile picture</button>
    </div>
    <div class="field"><label>First Name *</label><input id="arFirst" placeholder="First name"></div>
    <div class="field"><label>Middle Name</label><input id="arMiddle" placeholder="Optional"></div>
    <div class="field"><label>Surname *</label><input id="arSurname" placeholder="Surname" value="${esc((target.name || "").split(" ").slice(-1)[0] || "")}"></div>
    <div class="field"><label>Gender</label><select id="arGender">${gOpt("Male")}${gOpt("Female")}${gOpt("Other")}</select></div>
    <div class="field"><label>Married</label><select id="arMarried"><option value="" ${isSpouseRel ? "" : "selected"}>— Select —</option><option value="yes" ${isSpouseRel ? "selected" : ""}>Married</option><option value="no">Unmarried</option></select></div>
    <div class="field"><label>Nickname</label><input id="arNickname" placeholder="Optional"></div>
    <div class="field" style="flex-direction:row;align-items:center;gap:8px"><input type="checkbox" id="arShowNick" style="width:auto"><label style="margin:0">Display nickname on tree instead of full name</label></div>
    <div class="field"><label>Email ID</label><input id="arEmail" type="email" placeholder="Optional"></div>
    <div class="field"><label>Phone Number</label><input id="arPhone" placeholder="+91 98XXXXXXXX"></div>
    <div class="field"><label>Status</label>
      <div style="display:flex;gap:16px">
        <label style="display:flex;align-items:center;gap:6px;margin:0"><input type="radio" name="arStatus" value="living" checked style="width:auto">Living</label>
        <label style="display:flex;align-items:center;gap:6px;margin:0"><input type="radio" name="arStatus" value="deceased" style="width:auto">Deceased</label>
      </div>
    </div>
    <div class="field"><label>Birth Date</label><input id="arDob" type="date"></div>
    <div class="field"><label>Birth Place</label><input id="arBirthPlace" placeholder="Optional"></div>
    <div class="field"><label>Current Place</label><input id="arCurrentPlace" placeholder="Optional"></div>
    <div class="field"><label>State</label>${stateSelectHTML("arState", "", "ar")}</div>
    <div class="field"><label>City</label>${cityFieldHTML("ar", "")}</div>
  </div>
  <div class="card">
    <details id="arMarriageBox" ${isSpouseRel ? "open" : ""}><summary>💍 Marriage Details</summary>
      <div class="form" style="margin-top:10px">
        <div class="field"><label>Spouse name</label><input id="arMarriageSpouse" placeholder="Optional" value="${isSpouseRel ? esc(target.name || "") : ""}"></div>
        <div class="field"><label>Marriage date</label><input id="arMarriageDate" type="date"></div>
      </div>
    </details>
    <details><summary>📖 Education History</summary>
      <div class="form" style="margin-top:10px">
        <div class="field"><label>Degree / qualification</label><input id="arEduDegree" placeholder="Optional"></div>
        <div class="field"><label>Institute</label><input id="arEduInstitute" placeholder="Optional"></div>
      </div>
    </details>
    <details><summary>💼 Work History</summary>
      <div class="form" style="margin-top:10px">
        <div class="field"><label>Company / occupation</label><input id="arWorkCompany" placeholder="Optional"></div>
        <div class="field"><label>Role</label><input id="arWorkRole" placeholder="Optional"></div>
      </div>
    </details>
    <details><summary>❤️ Medical History</summary>
      <div class="form" style="margin-top:10px">
        <div class="field"><label>Notes</label><input id="arMedicalNotes" placeholder="Optional"></div>
      </div>
    </details>
    <details><summary>📋 Community Details</summary>
      <div class="form" style="margin-top:10px">
        <div class="field"><label>Caste / community</label><input id="arCommunityCaste" placeholder="Optional"></div>
        <div class="field"><label>Gotra</label><input id="arCommunityGotra" placeholder="Optional"></div>
      </div>
    </details>
    <details><summary>📞 Social Media</summary>
      <div class="form" style="margin-top:10px">
        <div class="field"><label>Facebook / Instagram handle</label><input id="arSocialHandle" placeholder="Optional"></div>
      </div>
    </details>
  </div>
  </div>
  <div id="arExistingWrap" style="${addRelativeMode === 'existing' ? '' : 'display:none'}">
    <div class="card form">
      <div class="field"><label>Select member from tree *</label><select id="arExistingPerson"></select></div>
      <p class="muted" id="arExistingHint" style="font-size:13px"></p>
    </div>
  </div>
  <div id="arUidWrap" style="${addRelativeMode === 'uid' ? '' : 'display:none'}">
    <div class="card form">
      <div class="field"><label>Unique ID of the existing profile *</label>
        <div style="display:flex;gap:8px"><input id="arUid" placeholder="e.g. P-10004" autocomplete="off" style="flex:1" onkeydown="if(event.key==='Enter'){event.preventDefault();searchRelativeByUid()}">
        <button type="button" class="secondary" onclick="searchRelativeByUid()">🔎 Search</button></div>
      </div>
      <p class="muted" style="font-size:13px">Profile already bana hua hai? Uski Unique ID (Person ID) daalo — naya profile nahi banega, bas link hoga.</p>
      <div id="arUidResult"></div>
    </div>
  </div>
  <div class="actions" style="margin-top:14px">
    <button class="ghost" onclick="go('tree')">Cancel</button>
    <button class="primary" onclick="saveAddRelative()">${addRelativeMode === 'new' ? 'Add Relative' : 'Link Member'}</button>
  </div>`;
}
function descendantsOf(id) {
  const out = new Set(); const stack = [...childrenOf(id)];
  while (stack.length) { const c = stack.pop(); if (out.has(c)) continue; out.add(c); childrenOf(c).forEach(x => stack.push(x)); }
  return out;
}
function ancestorsOf(id) {
  const out = new Set(); const stack = [...parentsOf(id)];
  while (stack.length) { const c = stack.pop(); if (out.has(c)) continue; out.add(c); parentsOf(c).forEach(x => stack.push(x)); }
  return out;
}
function existingCandidates(targetId, typeKey) {
  const t = RELATION_TYPES[typeKey] || RELATION_TYPES.son;
  const desc = descendantsOf(targetId), anc = ancestorsOf(targetId);
  return state.people.filter(p => {
    if (p.id === targetId) return false;
    if (t.edgeType === "spouse") return !spousesOf(targetId).includes(p.id);
    if (t.edgeType === "parent") return !parentsOf(targetId).includes(p.id) && !desc.has(p.id);
    if (t.edgeType === "sibling") return !siblingsOf(targetId).includes(p.id) && !desc.has(p.id) && !anc.has(p.id) && !spousesOf(targetId).includes(p.id);
    return !childrenOf(targetId).includes(p.id) && !anc.has(p.id);
  });
}
/* Relationship dropdown changed: re-apply the defaults that belong to it (Wife -> Female + Married, Son -> Male, Daughter -> Female ...) */
function arRelTypeChanged() {
  refreshExistingOptions();
  const t = RELATION_TYPES[document.getElementById("arRelType")?.value]; if (!t) return;
  const target = personById(addRelativeTargetId) || me();
  const g = document.getElementById("arGender"); if (g) g.value = t.gender;
  const m = document.getElementById("arMarried"); if (m) m.value = t.edgeType === "spouse" ? "yes" : "";
  const sp = document.getElementById("arMarriageSpouse"); if (sp) sp.value = t.edgeType === "spouse" ? (target.name || "") : "";
  const box = document.getElementById("arMarriageBox"); if (box) box.open = t.edgeType === "spouse";
}
function refreshExistingOptions() {
  const sel = document.getElementById("arExistingPerson"); if (!sel) return;
  const typeKey = document.getElementById("arRelType")?.value || addRelativeTypeKey;
  const list = existingCandidates(addRelativeTargetId, typeKey);
  const keep = sel.value;
  sel.innerHTML = list.length
    ? `<option value="">— Choose a person —</option>` + list.map(p => `<option value="${esc(p.id)}">${esc(p.name)}${p.me ? " (You)" : ""} · ${esc(p.personCode || p.id)}</option>`).join("")
    : `<option value="">No eligible members</option>`;
  if (keep && list.some(p => p.id === keep)) sel.value = keep;
  const hint = document.getElementById("arExistingHint");
  if (hint) hint.textContent = list.length ? "Only a relationship link will be created — no new profile." : "Everyone in this tree is already linked this way, or linking would create a loop. Use New member instead.";
}
function setAddRelativeMode(mode) {
  addRelativeMode = mode === "existing" ? "existing" : mode === "uid" ? "uid" : "new";
  const show = (id, on) => { const el = document.getElementById(id); if (el) el.style.display = on ? "" : "none"; };
  show("arNewWrap", addRelativeMode === "new");
  show("arExistingWrap", addRelativeMode === "existing");
  show("arUidWrap", addRelativeMode === "uid");
  document.querySelectorAll("#arModeSwitch button").forEach(b => b.classList.toggle("active", b.dataset.mode === addRelativeMode));
  const btn = document.querySelector(".actions .primary[onclick^='saveAddRelative']"); if (btn) btn.textContent = addRelativeMode === "new" ? "Add Relative" : "Link Member";
  if (addRelativeMode === "existing") refreshExistingOptions();
  if (addRelativeMode === "uid") document.getElementById("arUid")?.focus();
}
/* ---- Add by Unique ID: link an ALREADY-CREATED profile (in this tree, or elsewhere) instead of creating a new one ---- */
let arFoundPerson = null; // { person, inTree }
function normUid(v) { return String(v || "").trim().toUpperCase().replace(/\s+/g, ""); }
function mapRemotePerson(r) {
  return { id: r.id, personCode: r.person_code, name: r.full_name, gender: r.gender, status: r.status, dob: r.dob, mobile: r.mobile, email: r.email,
    avatar_url: r.avatar_url, me: false, claimed_by: r.claimed_by, created_by: r.created_by, privacy: "Family only", nickname: r.nickname,
    showNickname: r.show_nickname, birthPlace: r.birth_place, currentPlace: r.current_place, lifeStatus: r.life_status, details: r.details || {}, treeRole: "member" };
}
async function searchRelativeByUid() {
  const box = document.getElementById("arUidResult"); if (!box) return;
  const code = normUid(document.getElementById("arUid")?.value);
  arFoundPerson = null;
  if (!code) { toast("Enter a Unique ID (e.g. P-10004)"); return; }
  const note = (html, cls) => { box.innerHTML = `<div class="card" style="margin-top:6px"><p class="${cls || "muted"}" style="margin:0">${html}</p></div>`; };
  const target = addRelativeTargetId;
  let p = state.people.find(x => normUid(x.personCode) === code || normUid(x.id) === code);
  let inTree = !!p;
  if (!p && supabase && currentUser) {
    note("Searching…");
    // Row Level Security hides other accounts' profiles from a plain table query, so search through the
    // find_person_by_code() database function (see supabase-find-person.sql); fall back to the table if it isn't installed.
    let row = null, rpcErr = null;
    const r1 = await supabase.rpc("find_person_by_code", { p_code: code });
    if (r1.error) {
      rpcErr = r1.error;
      const r2 = await supabase.from("persons").select("*").eq("person_code", code).maybeSingle();
      if (r2.error) { note("Search failed: " + esc(r2.error.message)); return; }
      row = r2.data;
    } else row = Array.isArray(r1.data) ? r1.data[0] : r1.data;
    if (row) p = mapRemotePerson(row);
    else if (rpcErr) { note(`No profile found with ID <strong>${esc(code)}</strong> in your own tree. Profiles of other accounts need <strong>supabase-find-person.sql</strong> to be run once in Supabase.`); return; }
  }
  if (!p) { note(`No profile found with ID <strong>${esc(code)}</strong>. Check the ID or create a new member instead.`); return; }
  if (p.id === target) { note("A person can't be linked to themselves."); return; }
  const typeKey = document.getElementById("arRelType")?.value || addRelativeTypeKey;
  const t = RELATION_TYPES[typeKey] || RELATION_TYPES.son;
  let status, ok = true;
  if (inTree) {
    ok = existingCandidates(target, typeKey).some(x => x.id === p.id);
    status = ok ? `Already in your tree — will be linked as <strong>${esc(t.label)}</strong>.` : "Already linked this way, or linking would create a loop. Choose a different relationship type.";
  } else if (p.status !== "unclaimed" && p.claimed_by && (!currentUser || p.claimed_by !== currentUser.id)) {
    status = `This person has their own account. A <strong>connection request</strong> will be sent; they get linked as <strong>${esc(t.label)}</strong> once they accept.`;
  } else {
    status = `Will be added to your tree and linked as <strong>${esc(t.label)}</strong>.`;
  }
  if (ok) arFoundPerson = { person: p, inTree };
  box.innerHTML = `<div class="card" style="margin-top:6px"><div style="display:flex;gap:12px;align-items:center">${avatarHTML(p)}
    <div><strong>${esc(p.name)}</strong><div class="muted" style="font-size:12.5px">${esc(p.gender || "Gender not set")} · ${esc(p.personCode || p.id)} · ${p.status === "unclaimed" ? "Unclaimed" : "Claimed"}</div></div></div>
    <p class="muted" style="margin:10px 0 0;font-size:13px">${status}</p></div>`;
}
async function linkByUniqueId() {
  if ((RELATION_TYPES[document.getElementById("arRelType")?.value] || {}).edgeType === "sibling" && !parentsOf(addRelativeTargetId).length) {
    toast("Brother/Sister add karne ke liye pehle is person ke parents (Father/Mother) add karein"); return;
  }
  const f = arFoundPerson;
  if (!f) { toast("Search a Unique ID first"); return; }
  const typeKey = document.getElementById("arRelType").value;
  const t = RELATION_TYPES[typeKey];
  const p = f.person, targetId = addRelativeTargetId;
  if (f.inTree) {
    if (!existingCandidates(targetId, typeKey).some(x => x.id === p.id)) { toast("This link already exists or would create a loop"); return; }
  } else {
    if (p.status !== "unclaimed" && p.claimed_by && (!currentUser || p.claimed_by !== currentUser.id)) {
      const { error } = await supabase.rpc("request_connection", { p_tree_id: state.treeId, p_person_id: p.id, p_relation_type: typeKey, p_target_person_id: targetId });
      if (error) { toast(/request_connection|function|schema cache/i.test(error.message) ? "Run supabase-connections.sql in Supabase first" : error.message); return; }
      toast(`Request sent to ${p.name} — they'll be linked as ${t.label} once they accept`);
      go("tree"); return;
    }
    if (supabase && currentUser && state.treeId) {
      const { error } = await supabase.from("tree_members").upsert({ tree_id: state.treeId, person_id: p.id, added_by: currentUser.id, role: "member" }, { onConflict: "tree_id,person_id" });
      if (error) { toast("Couldn't add this profile: " + error.message); return; }
    }
    state.people.push(p);
  }
  linkRelative(targetId, p.id, t);
  save();
  toast(`${p.name} linked as ${t.label}`);
  arFoundPerson = null;
  treeCenterId = targetId;
  go("tree");
}
function linkRelative(targetId, personId, t) {
  if (t.edgeType === "sibling") {
    // A sibling is simply another child of the SAME parent(s) — so they share one connector line on the tree.
    const ps = new Set(parentsOf(targetId));
    [...ps].forEach(pid => { const sp = spousesOf(pid); if (sp.length === 1) ps.add(sp[0]); });
    let e = null;
    ps.forEach(pid => { e = addEdge(pid, personId, "parent") || e; });
    return e;
  }
  if (t.edgeType === "spouse") {
    const e = addEdge(targetId, personId, "spouse");
    [targetId, personId].forEach(id => { const p = personById(id); if (p && p.details?.married !== "yes" && (id === personId || canEditPerson(p))) p.details = { ...(p.details || {}), married: "yes" }; });
    syncMarriageDate(personId);   // one marriage date for both
    // New spouse should also show as parent of the target's existing single-parent children
    childrenOf(targetId).forEach(c => { if (parentsOf(c).length === 1) addEdge(personId, c, "parent"); });
    return e;
  }
  if (t.edgeType === "parent") {
    const e = addEdge(personId, targetId, "parent"); // other person is parent OF target
    // If the target already has exactly one other parent, the two parents are a couple
    const others = parentsOf(targetId).filter(x => x !== personId);
    if (others.length === 1 && spousesOf(personId).length === 0 && spousesOf(others[0]).length === 0) addEdge(others[0], personId, "spouse");
    return e;
  }
  const e = addEdge(targetId, personId, "parent"); // target is parent OF other person (child)
  // Child must show in BOTH parents' profiles: also link the target's spouse (when there is exactly one)
  const sp = spousesOf(targetId);
  if (sp.length === 1) addEdge(sp[0], personId, "parent");
  return e;
}
/* Backfill: existing children that have only one parent, whose parent has exactly one spouse,
   get linked to that spouse too. Returns true if anything changed. */
function syncSpouseParents() {
  let changed = false;
  state.people.forEach(c => {
    const ps = parentsOf(c.id);
    if (ps.length !== 1) return;
    const sp = spousesOf(ps[0]);
    if (sp.length === 1 && !removedEdgeKeys.has(edgeKey(sp[0], c.id, "parent")) && addEdge(sp[0], c.id, "parent")) changed = true;
  });
  return changed;
}
async function saveAddRelative() {
  if ((RELATION_TYPES[document.getElementById("arRelType")?.value] || {}).edgeType === "sibling" && !parentsOf(addRelativeTargetId).length) {
    toast("Brother/Sister add karne ke liye pehle is person ke parents (Father/Mother) add karein"); return;
  }
  if (!canAddRelativeTo(addRelativeTargetId)) { toast("Only this tree's owner or admins can add relatives to other people"); return; }
  if (addRelativeMode === "uid" && state.joined) { toast("Unique ID se link karna join approve hone ke baad se"); return; }
  if (addRelativeMode === "uid") { await linkByUniqueId(); return; }
  if (addRelativeMode === "existing") {
    const exId = document.getElementById("arExistingPerson").value;
    const ex = personById(exId);
    const exT = RELATION_TYPES[document.getElementById("arRelType").value];
    if (!ex) { toast("Please select a member from the tree"); return; }
    if (!existingCandidates(addRelativeTargetId, document.getElementById("arRelType").value).some(p => p.id === exId)) { toast("This link already exists or would create a loop"); return; }
    linkRelative(addRelativeTargetId, exId, exT);
    save();
    toast(`${ex.name} linked as ${exT.label}`);
    treeCenterId = addRelativeTargetId;
    go("tree");
    return;
  }
  const first = document.getElementById("arFirst").value.trim();
  const surname = document.getElementById("arSurname").value.trim();
  if (!first || !surname) { toast("First name and surname are required"); return; }
  const middle = document.getElementById("arMiddle").value.trim();
  const name = [first, middle, surname].filter(Boolean).join(" ");
  const relTypeKey = document.getElementById("arRelType").value;
  const t = RELATION_TYPES[relTypeKey];
  const id = addRelativePersonId || crypto.randomUUID();
  const lifeStatus = document.querySelector('input[name="arStatus"]:checked')?.value || "living";

  let avatar_url;
  if (addRelativePhotoFile && supabase && currentUser) {
    try {
      const ext = (addRelativePhotoFile.name.split(".").pop() || "jpg").toLowerCase();
      const path = `${currentUser.id}/${id}-${Date.now()}.${ext}`;
      const { error: upErr } = await supabase.storage.from("avatars").upload(path, addRelativePhotoFile, { upsert: true, cacheControl: "3600" });
      if (upErr) throw upErr;
      const { data: pub } = supabase.storage.from("avatars").getPublicUrl(path);
      avatar_url = pub.publicUrl;
    } catch (e) { console.error("Relative photo upload failed", e); toast("Photo upload failed, saving without photo: " + e.message); }
  }

  state.people.push({
    id, personCode: "P-" + Math.floor(10000 + Math.random() * 89999), name, gender: document.getElementById("arGender")?.value || t.gender,
    status: "unclaimed", created_by: currentUser?.id,
    nickname: document.getElementById("arNickname").value.trim() || undefined,
    showNickname: document.getElementById("arShowNick").checked,
    email: document.getElementById("arEmail").value.trim() || undefined,
    mobile: document.getElementById("arPhone").value.trim() || undefined,
    dob: document.getElementById("arDob").value || undefined,
    birthPlace: document.getElementById("arBirthPlace").value.trim() || undefined,
    currentPlace: document.getElementById("arCurrentPlace").value.trim() || undefined,
    lifeStatus, avatar_url,
    details: {
      married: document.getElementById("arMarried")?.value || "",
      state: document.getElementById("arState")?.value || "",
      city: document.getElementById("arCity")?.value.trim() || "",
      marriage: { spouse: document.getElementById("arMarriageSpouse").value.trim(), date: document.getElementById("arMarriageDate").value },
      education: { degree: document.getElementById("arEduDegree").value.trim(), institute: document.getElementById("arEduInstitute").value.trim() },
      work: { company: document.getElementById("arWorkCompany").value.trim(), role: document.getElementById("arWorkRole").value.trim() },
      medical: { notes: document.getElementById("arMedicalNotes").value.trim() },
      community: { caste: document.getElementById("arCommunityCaste").value.trim(), gotra: document.getElementById("arCommunityGotra").value.trim() },
      social: { handle: document.getElementById("arSocialHandle").value.trim() }
    }
  });

  linkRelative(addRelativeTargetId, id, t);

  save();
  toast(`${name} added as ${t.label}`);
  treeCenterId = addRelativeTargetId;
  go("tree");
}

/* ---------------- people ---------------- */
let peopleQuery = "";
let peopleSort = "name-asc";
const PEOPLE_SORTS = {
  "name-asc": "Name (A → Z)",
  "name-desc": "Name (Z → A)",
  "dob-asc": "Oldest first (DOB)",
  "dob-desc": "Youngest first (DOB)",
  "unclaimed": "Unclaimed first",
  "newest": "Recently added"
};
function peopleListHTML() {
  const q = peopleQuery.trim().toLowerCase();
  let rows = state.people.map(p => ({ p, label: p.me ? "Self" : deriveRelationship(me().id, p.id).label, kin: kinLine(p) }));
  if (q) rows = rows.filter(({ p, label, kin }) => [p.name, p.id, p.personCode, p.birthPlace, p.currentPlace, label, kin].some(v => (v || "").toString().toLowerCase().includes(q)));
  const byName = (a, b) => (a.p.name || "").localeCompare(b.p.name || "", undefined, { sensitivity: "base" });
  const dob = r => r.p.dob || "";   // ISO strings sort correctly; empty DOB always goes last
  const byDob = dir => (a, b) => (!dob(a) ? 1 : !dob(b) ? -1 : dir * dob(a).localeCompare(dob(b))) || byName(a, b);
  const sorters = {
    "name-asc": byName,
    "name-desc": (a, b) => byName(b, a),
    "dob-asc": byDob(1),
    "dob-desc": byDob(-1),
    "unclaimed": (a, b) => ((a.p.status === "unclaimed" ? 0 : 1) - (b.p.status === "unclaimed" ? 0 : 1)) || byName(a, b),
    "newest": (a, b) => (b.p.created_at || "").localeCompare(a.p.created_at || "") || byName(a, b)
  };
  rows.sort(sorters[peopleSort] || byName);
  const count = `<p class="muted" style="font-size:12.5px;margin:0 0 8px">${rows.length === state.people.length ? rows.length + " people" : rows.length + " of " + state.people.length + " people"}</p>`;
  if (!rows.length) return count + '<div class="card"><p class="muted">Koi match nahi mila. Kuch aur search karke dekhein.</p></div>';
  return count + `<div class="list">${rows.map(({ p, label, kin }) => `<div class="row person-row" style="cursor:pointer" onclick="openProfile('${p.id}')">
    <div class="person-main" style="display:flex;gap:12px;align-items:center">${avatarHTML(p)}<div class="person-txt"><strong>${esc(p.name)}</strong><div class="muted" style="font-size:12.5px">${esc(label)} · ${esc(p.personCode || p.id)}</div>${kin ? `<div class="person-kin">${esc(kin)}</div>` : ""}</div></div>
    <div class="person-side" style="display:flex;gap:8px;align-items:center">${p.status === "unclaimed" ? '<span class="badge">Unclaimed</span>' : '<span class="badge sage">Claimed</span>'}${canInviteProfile(p) ? `<button type="button" class="secondary" style="padding:6px 12px;font-size:12.5px" title="Invite link bhejo" aria-label="Invite link bhejo" onclick="event.stopPropagation();openProfileInvite('${esc(p.id)}')">🔗<span class="person-del-txt"> Invite</span></button>` : ""}${canDeletePerson(p) ? `<button type="button" class="danger" style="padding:6px 12px;font-size:12.5px" title="Delete this profile" aria-label="Delete this profile" onclick="event.stopPropagation();deletePerson('${esc(p.id)}')">🗑<span class="person-del-txt"> Delete</span></button>` : ""}</div>
  </div>`).join("")}</div>`;
}
function refreshPeopleList() { const el = document.getElementById("peopleList"); if (el) el.innerHTML = peopleListHTML(); }
function setPeopleSearch(v) { peopleQuery = v || ""; refreshPeopleList(); }
function clearPeopleSearch() { peopleQuery = ""; const i = document.getElementById("peopleSearch"); if (i) { i.value = ""; i.focus(); } refreshPeopleList(); }
function setPeopleSort(v) { peopleSort = PEOPLE_SORTS[v] ? v : "name-asc"; refreshPeopleList(); }
function people() {
  return `<div class="page-head"><h2>People</h2><p class="muted">Everyone connected to your family tree.</p></div>
  <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin-bottom:12px">
    <input id="peopleSearch" type="search" value="${esc(peopleQuery)}" placeholder="🔍 Search by name, relation, place or ID…" oninput="setPeopleSearch(this.value)" style="flex:1;min-width:220px">
    <button type="button" class="secondary" onclick="clearPeopleSearch()">Clear</button>
    <select id="peopleSort" onchange="setPeopleSort(this.value)" title="Sort by">${Object.entries(PEOPLE_SORTS).map(([k, l]) => `<option value="${k}"${k === peopleSort ? " selected" : ""}>${l}</option>`).join("")}</select>
  </div>
  <div id="peopleList">${peopleListHTML()}</div>`;
}

/* ---------------- V5: profile ---------------- */
function openProfile(id) { activeProfileId = id; go("profile"); }
/* ---------------- memories: family members can write on a person's profile ---------------- */
let memoriesPersonId = null;
function memoriesCardHTML(p) {
  const gone = p.lifeStatus === "deceased";
  return `<div class="card"><h3>${gone ? "🕯️ In Memory of " + esc(p.name) : "💭 Memories of " + esc(p.name)}</h3>
    <p class="muted" style="font-size:13px;margin-bottom:10px">${gone ? "Share a memory, a story or a few words for them." : "Write a memory or a few kind words. Family members who can see this profile can read it."}</p>
    <div id="memoriesBox"><p class="muted">Loading…</p></div></div>`;
}
async function loadMemories(personId) {
  const box = document.getElementById("memoriesBox"); if (!box) return;
  memoriesPersonId = personId;
  if (!supabase || !currentUser) { box.innerHTML = '<p class="muted">Sign in to see memories.</p>'; return; }
  const { data, error } = await supabase.rpc("list_person_memories", { p_person_id: personId });
  const now = document.getElementById("memoriesBox");
  if (!now || memoriesPersonId !== personId) return; // user navigated away
  if (error) { now.innerHTML = `<p class="muted">${/list_person_memories|function|schema cache/i.test(error.message) ? "Run person-memories.sql in Supabase first" : esc(error.message)}</p>`; return; }
  const p = personById(personId);
  const list = (data || []).map(m => `<div class="row" style="align-items:flex-start"><span style="flex:1">
      <b>${esc(m.author_name || "Family member")}</b> <span class="muted" style="font-size:12.5px">· ${esc(fmtDate(m.created_at))}</span>
      <div style="white-space:pre-wrap;margin-top:4px">${esc(m.body)}</div></span>
      ${m.can_delete ? `<button class="ghost" title="Delete" onclick="deleteMemory('${esc(m.id)}')">🗑</button>` : ""}</div>`).join("");
  now.innerHTML = `<div class="field"><textarea id="memText" rows="3" maxlength="2000" placeholder="Write a memory of ${esc(p ? p.name : "them")}…" style="width:100%;resize:vertical"></textarea></div>
    <div class="actions" style="margin:8px 0 14px"><button class="primary" onclick="addMemory('${esc(personId)}')">Post memory</button></div>
    ${list || '<p class="muted">No memories yet. Be the first to write one.</p>'}`;
}
async function addMemory(personId) {
  const t = document.getElementById("memText"); const body = (t?.value || "").trim();
  if (!body) { toast("Write something first"); return; }
  const { error } = await supabase.rpc("add_person_memory", { p_person_id: personId, p_body: body });
  if (error) { toast(error.message); return; }
  toast("Memory added");
  loadMemories(personId);
}
async function deleteMemory(id) {
  if (!confirm("Delete this memory?")) return;
  const { error } = await supabase.rpc("delete_person_memory", { p_id: id });
  if (error) { toast(error.message); return; }
  loadMemories(memoriesPersonId);
}

function profile(id) {
  const p = state.people.find(x => x.id === id) || me();
  return `<div class="page-head"><h2>Profile</h2><p class="muted">Person profile &amp; media.</p></div>
  <div class="card profile-head">
    <div>${avatarHTML(p, "lg " + (p.me ? "gold" : ""))}
      <button class="ghost full" style="margin-top:10px" onclick="changePhoto('${p.id}')">Change Photo</button></div>
    <div>
      <h1 style="font-family:var(--font-display);font-size:24px;margin-bottom:2px">${esc(p.name)}</h1>
      ${kinLine(p) ? `<p class="person-kin" style="margin:0 0 4px">${esc(kinLine(p))}</p>` : ""}
      <p class="muted">Person ID: <strong>${esc(p.personCode || p.id)}</strong> · ${p.status === "unclaimed" ? '<span class="badge">Unclaimed</span>' : '<span class="badge sage">Claimed</span>'}</p>
      <hr class="divider">
      <p><strong>About:</strong> ${esc(p.about) || "Family profile information can be shown here."}</p>
      <p><strong>Relation:</strong> ${p.me ? "Self" : deriveRelationship(me().id, p.id).label}${p.gender ? ` · <strong>Gender:</strong> ${esc(p.gender)}` : ""}${p.dob ? ` · <strong>DOB:</strong> ${p.dob}` : ""}${p.mobile ? ` · <strong>Mobile:</strong> ${esc(p.mobile)}` : ""}</p>
      <div class="field" style="max-width:240px;margin-top:10px"><label>Privacy</label>
        <select onchange="setPrivacy('${p.id}',this.value)"><option ${p.privacy === "Family only" || !p.privacy ? "selected" : ""}>Family only</option><option ${p.privacy === "Private" ? "selected" : ""}>Private</option><option ${p.privacy === "Selected family" ? "selected" : ""}>Selected family</option><option ${p.privacy === "Public" ? "selected" : ""}>Public</option></select>
      </div>
    </div>
  </div>
  ${canEditPerson(p) ? personDetailsCard(p) : ""}
  ${linksCardHTML(p)}
  ${memoriesCardHTML(p)}
  <div class="card"><h3>Photos &amp; Albums</h3><div class="photo-grid">
    <div class="album">📷</div><div class="album">👨‍👩‍👧</div><div class="album">🎉</div>
  </div>
  <div class="actions" style="margin-top:14px">
    <button class="secondary" onclick="toast('Demo: create album')">+ Create Album</button>
    <button class="secondary" onclick="toast('Demo: upload photo')">Upload Photo</button>
  </div></div>`;
}
function openMyProfile() { const m = me(); if (!m) { toast("Profile not loaded yet"); return; } activeProfileId = m.id; go("profile"); }
function nameParts(p) {
  const d = p.details || {};
  if (d.firstName || d.surname) return { first: d.firstName || "", middle: d.middleName || "", last: d.surname || "" };
  const t = (p.name || "").trim().split(/\s+/).filter(Boolean);
  if (t.length <= 1) return { first: t[0] || "", middle: "", last: "" };
  return { first: t[0], middle: t.slice(1, -1).join(" "), last: t[t.length - 1] };
}
function canEditPerson(p) {
  if (!p || treeViewing) return false;
  if (state.joined) {
    const mineAdded = !!currentUser && p.created_by === currentUser.id;
    if (isPendingJoiner()) return mineAdded;                       // pending: only what I added myself
    if (p.me) return true;
    return mineAdded || (p.status === "unclaimed" && !p.claimed_by); // approved: old unclaimed profiles too
  }
  if (p.me) return true;
  // other people's profiles: only while unclaimed, and only by the tree owner/admins or whoever created the profile
  return p.status === "unclaimed" && (canEditTree() || (!!currentUser && p.created_by === currentUser.id));
}
/* Profiles you (or the tree owner/admin) created and nobody has claimed yet can be deleted. Never your own profile. */
function canDeletePerson(p) { return !!p && !p.me && canEditPerson(p); }
async function deletePerson(id) {
  const p = personById(id);
  if (!p || !canDeletePerson(p)) { toast("You can't delete this profile"); return; }
  const links = state.relationships.filter(r => r.from === id || r.to === id).length;
  if (!confirm(`Delete "${p.name}"?\n\nThis also removes ${links} relationship link${links === 1 ? "" : "s"} from the tree. Relatives connected only through this person may disappear from the tree. This can't be undone.`)) return;
  const name = p.name, oldDetails = { ...(p.details || {}) };
  const snapshot = { people: state.people, relationships: state.relationships };
  state.people = state.people.filter(x => x.id !== id);
  state.relationships = state.relationships.filter(r => r.from !== id && r.to !== id);
  treeExpanded.delete(id);
  if (treeCenterId === id) treeCenterId = null;
  const wasOnProfile = activeProfileId === id;
  if (activeProfileId === id) activeProfileId = null;
  closeEditProfile();
  if (state.joined) {
    const { error } = await supabase.rpc("join_remove_person", { p_tree_id: state.joined.treeId, p_person_id: id });
    if (error) { state.people = snapshot.people; state.relationships = snapshot.relationships; toast("Delete failed: " + error.message); render(); return; }
  } else if (supabase && currentUser && state.treeId) {
    // NOTE: with Supabase Row Level Security a DELETE that isn't allowed does NOT raise an error - it just
    // deletes 0 rows, so the person came back after refresh. We now check how many rows were really removed
    // and fall back to a "soft delete" (hidden everywhere) when hard delete is blocked.
    const count = async q => { const { data, error } = await q.select(); if (error) throw error; return (data || []).length; };
    try {
      await count(supabase.from("relationships").delete().eq("tree_id", state.treeId).or(`person_a_id.eq.${id},person_b_id.eq.${id}`));
      const gone = await count(supabase.from("tree_members").delete().eq("tree_id", state.treeId).eq("person_id", id));
      if (gone > 0) {
        try { await supabase.from("persons").delete().eq("id", id); } catch (e) { /* person row may stay; it is no longer in this tree */ }
      } else {
        // hard delete blocked by RLS -> soft delete: hide the person + their links
        await count(supabase.from("relationships").update({ status: "removed" }).eq("tree_id", state.treeId).or(`person_a_id.eq.${id},person_b_id.eq.${id}`));
        const upd = await count(supabase.from("persons").update({ details: { ...oldDetails, deleted: true, deleted_at: new Date().toISOString() } }).eq("id", id));
        if (!upd) throw new Error("Server did not allow deleting this profile (permission). Run supabase-delete-policies.sql in Supabase.");
      }
    } catch (e) {
      console.error("Supabase delete failed", e);
      state.people = snapshot.people; state.relationships = snapshot.relationships;
      toast("Delete failed: " + (e.message || "server error"));
      render();
      return;
    }
  }
  await save();
  toast(`${name} deleted`);
  if (wasOnProfile) go("people"); else render();
}
/* "Linked family members": lets you remove a WRONG link (the two profiles stay, only the relationship goes). */
function linksCardHTML(p) {
  if (!p || treeViewing) return "";
  const seen = new Set(), rows = [];
  state.relationships.forEach(r => {
    if (r.from !== p.id && r.to !== p.id) return;
    const k = edgeKey(r.from, r.to, r.type); if (seen.has(k)) return; seen.add(k);
    const o = personById(r.from === p.id ? r.to : r.from); if (!o) return;
    const kind = r.type === "spouse" ? "Husband / Wife" : r.type === "parent" ? (r.from === p.id ? "Child (beta/beti)" : "Parent (maa/baap)") : r.type;
    rows.push(`<div class="row"><span><b>${esc(o.name)}</b><br><span class="muted" style="font-size:12.5px">${esc(kind)}</span></span>
      <button type="button" class="danger" style="padding:6px 12px;font-size:12.5px" onclick="removeLink('${esc(r.id)}')">✂️ Remove link</button></div>`);
  });
  if (!rows.length) return "";
  return `<div class="card"><h3>🔗 Linked family members</h3>
    <p class="muted" style="font-size:13px;margin:0 0 8px">Agar koi member galat link ho gaya hai to "Remove link" dabao. Dono profile rahenge, sirf rishta hat jayega.</p>${rows.join("")}</div>`;
}
async function removeLink(relId) {
  if (treeViewing) { toast("Yeh tree sirf dekhne ke liye hai"); return; }
  const r = state.relationships.find(x => x.id === relId); if (!r) return;
  const a = personById(r.from), b = personById(r.to);
  if (!confirm(`Remove the link between "${a ? a.name : "?"}" and "${b ? b.name : "?"}"?\n\nDono profile rahenge, sirf yeh rishta hat jayega.`)) return;
  const same = x => x.type === r.type && ((x.from === r.from && x.to === r.to) || (r.type === "spouse" && x.from === r.to && x.to === r.from));
  const snapshot = state.relationships;
  state.relationships = state.relationships.filter(x => !same(x));
  removedEdgeKeys.add(edgeKey(r.from, r.to, r.type));
  if (state.joined) {
    const rows = snapshot.filter(same).map(x => ({ id: x.id, person_a_id: x.from, person_b_id: x.to, relationship_type: x.type, status: "removed" }));
    const { data, error } = await supabase.rpc("join_sync", { p_tree_id: state.joined.treeId, p_people: [], p_rels: rows });
    if (error || (data && data.skipped && !data.updated)) { state.relationships = snapshot; removedEdgeKeys.delete(edgeKey(r.from, r.to, r.type)); toast(error ? "Remove failed: " + error.message : "Approval ke baad hi purane links hata sakte hain"); render(); return; }
  } else if (supabase && currentUser && state.treeId) {
    const restore = msg => { state.relationships = snapshot; removedEdgeKeys.delete(edgeKey(r.from, r.to, r.type)); toast(msg); render(); };
    const rpc = await supabase.rpc("remove_relationship_everywhere", { p_relationship_id: relId });
    if (rpc.error) {
      if (!/remove_relationship_everywhere|function|schema cache/i.test(rpc.error.message)) { restore("Remove failed: " + rpc.error.message); return; }
      // function not installed yet: remove the copies that live in MY tree
      const mine = snapshot.filter(x => same(x) && (!x.tree_id || x.tree_id === state.treeId));
      for (const x of mine) {
        let q = await supabase.from("relationships").delete().eq("id", x.id).select();
        if (q.error) { restore("Remove failed: " + q.error.message); return; }
        if (!(q.data || []).length) {
          q = await supabase.from("relationships").update({ status: "removed" }).eq("id", x.id).select();
          if (q.error || !(q.data || []).length) { restore("Server did not allow removing this link. Run supabase-remove-link.sql in Supabase."); return; }
        }
      }
      if (snapshot.some(x => same(x) && x.tree_id && x.tree_id !== state.treeId)) toast("Link removed from your tree; the other tree still has it. Run supabase-remove-link.sql to remove it everywhere.");
    }
  }
  toast("Link removed");
  render();
}
/* Delete MY profile / account.
   - I am also in someone else's tree  -> my card stays there as UNCLAIMED (contact info + photo removed), account is deleted
   - I am in no one else's tree        -> my account and all my data are deleted
   Done by the delete_my_profile() database function (see supabase-delete-account.sql). */
async function openDeleteMyProfile() {
  if (!supabase || !currentUser) { toast("Please sign in"); return; }
  const { data, error } = await supabase.rpc("my_profile_delete_preview");
  if (error) { toast(/function|schema cache/i.test(error.message) ? "Run supabase-delete-account.sql in Supabase first" : error.message); return; }
  const info = data || {};
  const own = Math.max(0, (info.own_members || 0) - 1);
  const msg = info.in_other_trees
    ? `Aap doosron ke family tree mein bhi hain, isliye wahan aapka profile UNCLAIMED ban jayega (naam rahega; mobile, email aur photo hat jayenge).\n\nAapka account delete ho jayega${own ? `, aur aapka apna tree (${own} member) bhi hat jayega` : ""}. Yeh wapas nahi ho sakta.`
    : `Aap kisi aur ke family tree mein nahi hain, isliye aapka account aur saara data${own ? ` (aapka apna tree aur uske ${own} member bhi)` : ""} hamesha ke liye delete ho jayega. Yeh wapas nahi ho sakta.`;
  const typed = prompt(msg + "\n\nConfirm karne ke liye DELETE type karo:");
  if (typed === null) return;
  if (typed.trim().toUpperCase() !== "DELETE") { toast("Delete cancel kiya"); return; }
  const r = await supabase.rpc("delete_my_profile");
  if (r.error) { toast("Delete failed: " + r.error.message); return; }
  await logout();
  toast(r.data === "unclaimed" ? "Account delete ho gaya. Doosron ke tree mein aapka profile unclaimed ban gaya hai." : "Aapka account delete ho gaya.");
}
function fmtDate(d) { if (!d) return ""; const x = new Date(d); return Number.isNaN(x.getTime()) ? String(d) : x.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }); }
/* Read-only details card on the profile page, with an Edit button that opens the popup form. */
function detailRowsHTML(p) {
  const n = nameParts(p), d = p.details || {};
  const row = (label, val) => `<div class="row"><span class="muted">${label}</span><span>${val ? esc(val) : "—"}</span></div>`;
  const married = d.married === "yes" ? "Married" : d.married === "no" ? "Unmarried" : "";
  return `${row("First name", n.first)}${row("Middle name", n.middle)}${row("Surname", n.last)}
    ${row("Gender", p.gender)}
    ${row("Date of birth", fmtDate(p.dob))}${row("Birth time", d.birth_time)}${row("Date of death", fmtDate(d.dod))}
    ${row("Mobile", p.mobile)}${row("Email", p.email)}
    ${row("State", d.state)}${row("City", d.city)}${row("Married", married)}`;
}
/* Read-only details card on the profile page, with an Edit button that opens the popup form. */
function personDetailsCard(p) {
  return `<div class="card"><div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:8px">
      <h3 style="margin:0">Personal details</h3>
      <div style="display:flex;gap:8px;flex-wrap:wrap">${p.me ? `<button class="secondary" onclick="openChangeEmail('${esc(p.id)}')">✉️ Change email</button>` : ""}${p.me && supabase && personTreeRole(p) !== "owner" ? `<button class="secondary" onclick="openTransferProfile('${esc(p.id)}')">🔁 Transfer profile</button>` : ""}${p.me ? `<button class="danger" onclick="openDeleteMyProfile()">🗑 Delete my profile</button>` : ""}${canEditPerson(p) ? `<button class="secondary" onclick="openEditProfile('${esc(p.id)}')">✏️ Edit</button>` : ""}${canDeletePerson(p) ? `<button class="danger" onclick="deletePerson('${esc(p.id)}')">🗑 Delete profile</button>` : ""}</div>
    </div>
    ${detailRowsHTML(p)}
  </div>`;
}
function editProfileFormHTML(p) {
  const n = nameParts(p), d = p.details || {};
  const v = x => esc(x || "");
  return `<div class="field"><label>First Name *</label><input id="mpFirst" value="${v(n.first)}" placeholder="First name"></div>
    <div class="field"><label>Middle Name</label><input id="mpMiddle" value="${v(n.middle)}" placeholder="Optional"></div>
    <div class="field"><label>Surname *</label><input id="mpSurname" value="${v(n.last)}" placeholder="Surname"></div>
    <div class="field"><label>Gender</label>
      <select id="mpGender"><option value="" ${p.gender ? "" : "selected"}>— Select —</option><option value="Male" ${p.gender === "Male" ? "selected" : ""}>Male</option><option value="Female" ${p.gender === "Female" ? "selected" : ""}>Female</option><option value="Other" ${p.gender === "Other" ? "selected" : ""}>Other</option></select>
    </div>
    <div class="field"><label>Date of Birth</label><input id="mpDob" type="date" value="${v(normalizeDate(p.dob))}"></div>
    <div class="field"><label>Birth time (rashi / horoscope ke liye)</label><input id="mpBirthTime" type="time" value="${v(d.birth_time)}"></div>
    <div class="field"><label>Date of Death</label><input id="mpDod" type="date" value="${v(d.dod)}"></div>
    <div class="field"><label>Mobile</label><input id="mpMobile" type="tel" value="${v(p.mobile)}" placeholder="+91 98XXXXXXXX"></div>
    <div class="field"><label>Email (Gmail)</label><input id="mpEmail" type="email" value="${v(p.email)}" placeholder="name@gmail.com"></div>
    <div class="field"><label>State</label>${stateSelectHTML("mpState", d.state, "mp")}</div>
    <div class="field"><label>City</label>${cityFieldHTML("mp", d.city)}</div>
    <div class="field"><label>Married</label>
      <select id="mpMarried"><option value="" ${d.married ? "" : "selected"}>— Select —</option><option value="yes" ${d.married === "yes" ? "selected" : ""}>Married</option><option value="no" ${d.married === "no" ? "selected" : ""}>Unmarried</option></select>
    </div>
    <div class="field"><label>Marriage date (anniversary ke liye)</label><input id="mpMarriageDate" type="date" value="${v(d.marriage?.date || marriageDateOf(p))}"></div>`;
}
let profileModalLocked = false; // true while the edit form is open: outside click / Esc must not discard typed data
let profileModalOrigin = "edit"; // "view" = opened from the tree (Cancel/Save go back to the view), "edit" = opened straight into the form
function profileModalShell(html) {
  let m = document.getElementById("editModal");
  if (!m) {
    m = document.createElement("div");
    m.id = "editModal"; m.className = "modal-overlay";
    m.onclick = e => { if (e.target === m && !profileModalLocked) closeEditProfile(); };
    document.body.appendChild(m);
    document.body.style.overflow = "hidden";
  }
  m.innerHTML = `<div class="modal-card" role="dialog" aria-modal="true">${html}</div>`;
  return m;
}
/* Which profile fields are filled, and how much of the profile that is (middle name / date of death are optional, so not counted). */
function profileFieldList(p) {
  const n = nameParts(p), d = p.details || {};
  const married = d.married === "yes" ? "Married" : d.married === "no" ? "Unmarried" : "";
  return [
    ["Name", [n.first, n.middle, n.last].filter(Boolean).join(" "), !!(n.first && n.last)],
    ["Gender", p.gender, !!p.gender],
    ["Date of birth", fmtDate(p.dob), !!p.dob],
    ["Photo", p.avatar_url ? "Added" : "", !!p.avatar_url],
    ["Mobile", p.mobile, !!p.mobile],
    ["Email", p.email, !!p.email],
    ["State", d.state, !!d.state],
    ["City", d.city, !!d.city],
    ["Married", married, !!married]
  ];
}
function profileCompletion(p) {
  const f = profileFieldList(p), done = f.filter(x => x[2]).length;
  return { done, total: f.length, pct: Math.round(done * 100 / f.length), missing: f.filter(x => !x[2]).map(x => x[0]) };
}
/* Popup body: only the details that are actually filled, plus a completion bar. */
function filledDetailsHTML(p) {
  const c = profileCompletion(p), d = p.details || {};
  const row = (label, val) => val ? `<div class="row"><span class="muted">${label}</span><span>${esc(val)}</span></div>` : "";
  const married = d.married === "yes" ? "Married" : d.married === "no" ? "Unmarried" : "";
  const bar = `<div class="pc-wrap"><div class="pc-head"><b>Profile ${c.pct}% complete</b><span class="muted">${c.done}/${c.total} details</span></div>
    <div class="pc-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${c.pct}"><span style="width:${c.pct}%"></span></div>
    ${c.missing.length ? `<div class="muted pc-miss">Baaki: ${esc(c.missing.join(", "))}</div>` : `<div class="muted pc-miss">Saari details bhari hui hain ✓</div>`}</div>`;
  const spLabel = p.gender === "Female" ? "Husband" : p.gender === "Male" ? "Wife" : "Spouse";
  return bar + row("Date of death", fmtDate(d.dod)) + profileFieldList(p).map(([label, val]) => label === "Name" || label === "Photo" ? "" : row(label, val)).join("")
    + row(spLabel, spouseCardLine(p)) + row("Marriage date", fmtDate(marriageDateOf(p)));
}
/* ---------------- person wall: posts, likes, comments, tags. Used in the person's Wall popup (ctx "m") and in the Wall tab feed (ctx "f") ---------------- */
let wallPersonId = null, wallTags = [], wallOpenComments = new Set(), wallComposerOnly = false;
function fmtDateTime(d) { if (!d) return ""; const x = new Date(d); return Number.isNaN(x.getTime()) ? "" : x.toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" }); }
function wallErr(e) { const m = e.message || ""; if (/p_place_name|place_name|wall-location/i.test(m)) return "Run supabase-wall-location.sql in Supabase first"; if (/p_media|wall-media|bucket not found/i.test(m)) return "Run supabase-wall-media.sql in Supabase first"; if (/my_reaction|reactions|set_wall_reaction/i.test(m)) return "Run supabase-wall-reactions.sql in Supabase first"; return /No access/i.test(m) ? m : /list_person_wall|list_wall_feed|toggle_wall_like|add_person_wall_post|list_wall_comments|add_wall_comment|function|schema cache/i.test(m) ? "Run supabase-person-wall.sql in Supabase first" : (m || "Something went wrong"); }
function wallComposerHTML(placeholder) {
  return `<div class="wall-compose">
    <textarea id="wallText" rows="3" maxlength="2000" placeholder="${esc(placeholder)}"></textarea>
    <div id="wallTagChips" class="wall-chips"></div>
    <div id="wallTagPicker" hidden></div>
    <div id="wallMediaChips" class="wall-media-chips"></div>
    <div id="wallLocChip" class="wall-chips"></div>
    ${wallLocPanelHTML()}
    <div class="wall-compose-actions"><button type="button" class="ghost" onclick="wallToggleTagPicker()">🏷 Tag</button><button type="button" class="ghost" onclick="wallPickMedia()">📎 Photo / Video</button><button type="button" class="ghost" onclick="wallToggleLoc()">📍 Location</button><button type="button" class="primary" id="wallPostBtn" onclick="wallPost()">Post</button></div>
  </div>`;
}
function openPersonWall(id) {
  const p = personById(id); if (!p) return;
  wallPersonId = id; wallFiles = []; wallTags = []; wallOpenComments = new Set(); wallComposerOnly = false; wishKey = null;
  profileModalOrigin = "view"; profileModalLocked = false;
  profileModalShell(`<div class="modal-head"><h3>📝 ${esc(p.name)}'s Wall</h3><button type="button" class="ghost" aria-label="Close" onclick="closeEditProfile()">✕</button></div>
    <div class="modal-body">
      ${wallComposerHTML("Write on " + p.name + "'s wall…")}
      <div id="wallList"><p class="muted">Loading…</p></div>
    </div>
    <div class="actions modal-foot"><button type="button" class="ghost" onclick="openProfilePopup('${esc(id)}')">← Profile</button></div>`);
  loadPersonWall();
}
/* "New post" on the Wall tab: always writes on MY OWN wall. */
function openNewWallPost() {
  const mp = myself();
  if (!mp) { toast("Pehle apna profile claim karo"); return; }
  wallPersonId = mp.id; wallFiles = []; wallTags = []; wallOpenComments = new Set(); wallComposerOnly = true; wishKey = null;
  profileModalOrigin = "view"; profileModalLocked = false;
  profileModalShell(`<div class="modal-head"><h3>✍️ New post</h3><button type="button" class="ghost" aria-label="Close" onclick="closeEditProfile()">✕</button></div>
    <div class="modal-body">
      ${wallComposerHTML("Kya share karna hai, " + (mp.name || "") + "?")}
      <p class="muted" style="font-size:12.5px;margin:0">Ye post aapki apni wall par jayegi aur poori family ke feed me dikhegi.</p>
    </div>`);
}
function wallRenderTags() {
  const box = document.getElementById("wallTagChips"); if (!box) return;
  box.innerHTML = wallTags.map(t => `<span class="wall-chip">🏷 ${esc(personById(t)?.name || "")}<button type="button" aria-label="Remove tag" onclick="wallRemoveTag('${esc(t)}')">✕</button></span>`).join("");
}
function wallRenderTagPicker() {
  const el = document.getElementById("wallTagPicker"); if (!el) return;
  const opts = mergeCandidates().filter(x => x.id !== wallPersonId && !wallTags.includes(x.id)).sort((a, b) => a.name.localeCompare(b.name))
    .map(x => `<option value="${esc(x.id)}">${esc(x.name)}${kinLine(x) ? " — " + esc(kinLine(x)) : ""}</option>`).join("");
  el.innerHTML = `<select onchange="wallAddTag(this.value)"><option value="">Select a person to tag…</option>${opts}</select>`;
}
function wallToggleTagPicker() { const el = document.getElementById("wallTagPicker"); if (!el) return; el.hidden = !el.hidden; if (!el.hidden) wallRenderTagPicker(); }
function wallAddTag(pid) { if (!pid || wallTags.includes(pid)) return; wallTags.push(pid); wallRenderTags(); wallRenderTagPicker(); }
function wallRemoveTag(pid) { wallTags = wallTags.filter(x => x !== pid); wallRenderTags(); wallRenderTagPicker(); }
/* ---- photos / videos on posts (private bucket "wall-media"; run supabase-wall-media.sql) ---- */
const WALL_MAX_FILES = 4, WALL_MAX_VIDEO_MB = 40;
const WALL_VIDEO_EXT = { "video/mp4": "mp4", "video/quicktime": "mov", "video/webm": "webm" };
let wallFiles = [];
function wallPickMedia() {
  const input = document.createElement("input");
  input.type = "file"; input.multiple = true; input.accept = "image/*,video/mp4,video/quicktime,video/webm";
  input.onchange = () => wallAddFiles([...input.files]);
  input.click();
}
function wallAddFiles(list) {
  for (const f of list) {
    if (wallFiles.length >= WALL_MAX_FILES) { toast(`Ek post mein max ${WALL_MAX_FILES} files`); break; }
    const isV = f.type.startsWith("video/"), isI = f.type.startsWith("image/");
    if (!isV && !isI) { toast("Sirf photo ya video chun sakte hain"); continue; }
    if (isV && !WALL_VIDEO_EXT[f.type]) { toast("Video MP4, MOV ya WebM hona chahiye"); continue; }
    if (isV && f.size > WALL_MAX_VIDEO_MB * 1048576) { toast(`Video ${WALL_MAX_VIDEO_MB}MB se chhota hona chahiye`); continue; }
    f._url = isI ? URL.createObjectURL(f) : null;
    wallFiles.push(f);
  }
  wallRenderFiles();
}
function wallRemoveFile(i) { const f = wallFiles[i]; if (f?._url) URL.revokeObjectURL(f._url); wallFiles.splice(i, 1); wallRenderFiles(); }
function wallRenderFiles() {
  const box = document.getElementById("wallMediaChips"); if (!box) return;
  box.innerHTML = wallFiles.map((f, i) => `<div class="wall-thumb">${f._url ? `<img src="${f._url}" alt="">` : `<span class="vid">🎬<small>${esc(f.name.slice(0, 14))}</small></span>`}<button type="button" aria-label="Remove" onclick="wallRemoveFile(${i})">✕</button></div>`).join("");
}
async function wallPrepImage(file) {       // shrink to max 1600px JPEG (keeps GIFs as they are so they stay animated)
  if (file.type === "image/gif") return { blob: file, type: "image/gif", ext: "gif" };
  let bmp;
  try { bmp = await createImageBitmap(file, { imageOrientation: "from-image" }); }
  catch (e) { throw new Error("Ye photo process nahi ho paayi (JPG ya PNG try karein)"); }
  const k = Math.min(1, 1600 / Math.max(bmp.width, bmp.height)), c = document.createElement("canvas");
  c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
  c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height); bmp.close?.();
  const blob = await new Promise(r => c.toBlob(r, "image/jpeg", 0.85));
  if (!blob) throw new Error("Photo process nahi ho paayi");
  return { blob, type: "image/jpeg", ext: "jpg" };
}
async function wallHydrateMedia(root) {    // turn data-wm paths into short-lived signed URLs
  if (!root || !supabase) return;
  const els = [...root.querySelectorAll("[data-wm]")]; if (!els.length) return;
  const { data, error } = await supabase.storage.from("wall-media").createSignedUrls([...new Set(els.map(e => e.dataset.wm))], 3600);
  if (error || !data) return;
  const urls = new Map(data.map(d => [d.path, d.signedUrl]));
  els.forEach(e => {
    const u = urls.get(e.dataset.wm);
    if (u) e.src = u; else { const n = document.createElement("div"); n.className = "muted"; n.textContent = "Media available nahi hai"; e.replaceWith(n); }
  });
}
/* ---- save / share a post's photo or video (WhatsApp etc. through the phone's share sheet; download as a fallback) ---- */
const WALL_MIME_EXT = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif", "video/mp4": "mp4", "video/quicktime": "mov", "video/webm": "webm" };
async function wallMediaFile(url) {
  const r = await fetch(url); if (!r.ok) throw new Error("fetch failed");
  const blob = await r.blob();
  return new File([blob], `familytree-${Date.now()}.${WALL_MIME_EXT[blob.type] || "jpg"}`, { type: blob.type });
}
async function wallMediaDownload(url) {
  try {
    const f = await wallMediaFile(url), a = document.createElement("a");
    a.href = URL.createObjectURL(f); a.download = f.name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  } catch (e) { window.open(url, "_blank"); }
}
async function wallMediaShare(url) {
  try {
    const f = await wallMediaFile(url);
    if (navigator.canShare && navigator.canShare({ files: [f] })) { await navigator.share({ files: [f], title: "FamilyTree" }); return; }
    toast("Is device par seedha share nahi ho sakta. Download ho raha hai, phir WhatsApp me bhej do");
    wallMediaDownload(url);
  } catch (e) { if (e && e.name === "AbortError") return; toast("Share nahi ho paya. Download try karo"); }
}
function wallSaveMedia(btn, mode) {   // buttons on a video
  const v = btn.closest(".wall-vwrap")?.querySelector("video"); if (!v?.src) { toast("Video abhi load ho raha hai"); return; }
  (mode === "share" ? wallMediaShare : wallMediaDownload)(v.src);
}
function wallViewImage(url) {
  if (!url) return;
  const el = document.createElement("div"); el.className = "modal-overlay wall-viewer"; el.style.zIndex = 140; el.style.background = "rgba(0,0,0,.88)";
  el.innerHTML = `<img src="${esc(url)}" alt="" style="max-width:100%;max-height:calc(100% - 64px);border-radius:8px">
    <div class="wall-viewer-bar"><button type="button" data-a="share">📤 Share</button><button type="button" data-a="download">⬇ Download</button><button type="button" data-a="close">✕ Close</button></div>`;
  el.onclick = e => {
    const a = e.target.closest && e.target.closest("button")?.dataset.a;
    if (a === "share") wallMediaShare(url); else if (a === "download") wallMediaDownload(url); else if (a === "close" || e.target === el) el.remove();
  };
  document.body.appendChild(el);
}
/* ---- location on posts ----
   Type a place name / lat+lng by hand, use phone GPS, search a place by name, paste a Google Maps link, or tap on a map.
   Search + map use OpenStreetMap (free, no API key). Viewers tap the 📍 tag to open it in Google Maps. */
let wallMap = null, wallMarker = null, wallLocHits = [];
function wallLocPanelHTML() {
  wallMap = null; wallMarker = null; wallLocHits = [];
  return `<div id="wallLocPanel" class="wall-loc" hidden>
    <input id="wallLocName" maxlength="160" placeholder="Jagah ka naam (e.g. Kuldevi Mandir, Jaipur)" oninput="wallLocRender()">
    <div class="wall-loc-row"><button type="button" class="ghost" onclick="wallLocGPS()">📡 Meri current location</button><button type="button" class="ghost" onclick="wallLocSearch()">🔍 Naam se dhundho</button></div>
    <div id="wallLocResults" class="wall-loc-results"></div>
    <input id="wallLocLink" placeholder="Google Maps link ya coordinates paste karo" onchange="wallLocPaste(this.value)" onpaste="setTimeout(() => wallLocPaste(this.value), 0)">
    <div class="wall-loc-row"><input id="wallLat" inputmode="decimal" placeholder="Latitude" oninput="wallLocRender()"><input id="wallLng" inputmode="decimal" placeholder="Longitude" oninput="wallLocRender()"></div>
    <div class="wall-loc-row"><button type="button" class="ghost" onclick="wallLocToggleMap()">🗺 Map pe chunein</button><button type="button" class="ghost" onclick="wallLocClear()">✕ Location hatao</button></div>
    <div id="wallLocMap" class="wall-loc-map" hidden></div>
  </div>`;
}
const wallMapsUrl = l => (l.lat != null && l.lng != null) ? `https://www.google.com/maps?q=${Number(l.lat)},${Number(l.lng)}` : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(l.name || "")}`;
function wallLocTagHTML(m) {
  if (!m.place_name && m.lat == null) return "";
  const label = m.place_name || `${Number(m.lat).toFixed(5)}, ${Number(m.lng).toFixed(5)}`;
  return `<div class="wall-chips"><a class="wall-chip link wall-loc-tag" href="${esc(wallMapsUrl({ name: m.place_name, lat: m.lat, lng: m.lng }))}" target="_blank" rel="noopener">📍 ${esc(label)}</a></div>`;
}
function wallToggleLoc() { const el = document.getElementById("wallLocPanel"); if (el) el.hidden = !el.hidden; }
/* Returns {name, lat, lng} (any may be null), null if nothing entered, or false (after a toast) if the numbers are invalid. */
function wallLocRead() {
  const v = id => (document.getElementById(id)?.value || "").trim();
  const name = v("wallLocName"), la = v("wallLat"), lo = v("wallLng");
  if (!name && !la && !lo) return null;
  let lat = null, lng = null;
  if (la || lo) {
    lat = Number(la.replace(",", ".")); lng = Number(lo.replace(",", "."));
    if (!la || !lo || !isFinite(lat) || !isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) { toast("Latitude (-90 se 90) aur Longitude (-180 se 180) dono sahi likho"); return false; }
  }
  return { name: name || null, lat, lng };
}
function wallLocRender() {
  const box = document.getElementById("wallLocChip"); if (!box) return;
  const v = id => (document.getElementById(id)?.value || "").trim();
  const name = v("wallLocName"), la = v("wallLat"), lo = v("wallLng");
  const label = name || (la && lo ? `${la}, ${lo}` : "");
  box.innerHTML = label ? `<span class="wall-chip">📍 ${esc(label)}<button type="button" aria-label="Remove location" onclick="wallLocClear()">✕</button></span>` : "";
}
function wallLocClear() {
  ["wallLocName", "wallLat", "wallLng", "wallLocLink"].forEach(id => { const e = document.getElementById(id); if (e) e.value = ""; });
  const r = document.getElementById("wallLocResults"); if (r) r.innerHTML = "";
  if (wallMarker && wallMap) { wallMap.removeLayer(wallMarker); wallMarker = null; }
  wallLocRender();
}
async function wallLocSet(lat, lng, name, opts = {}) {
  lat = Number(lat); lng = Number(lng);
  if (!isFinite(lat) || !isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return;
  document.getElementById("wallLat").value = lat.toFixed(6); document.getElementById("wallLng").value = lng.toFixed(6);
  const nm = document.getElementById("wallLocName");
  if (name) nm.value = name;
  wallLocRender();
  if (wallMap) wallMapPin(lat, lng, !opts.fromMap);
  if (!name && !nm.value.trim()) {          // fill the place name automatically (reverse geocode); user can still edit it
    try {
      const r = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=16&lat=${lat}&lon=${lng}`, { headers: { "Accept-Language": "en" } });
      const j = await r.json();
      const nmNow = document.getElementById("wallLocName");
      if (j?.display_name && nmNow && !nmNow.value.trim()) { nmNow.value = j.display_name.split(", ").slice(0, 3).join(", "); wallLocRender(); }
    } catch (e) { /* offline / blocked: coordinates are enough */ }
  }
}
function wallLocGPS() {
  if (!navigator.geolocation) { toast("Is browser mein GPS support nahi hai"); return; }
  toast("Location dhundh rahe hain…");
  navigator.geolocation.getCurrentPosition(
    pos => wallLocSet(pos.coords.latitude, pos.coords.longitude),
    err => toast(err.code === 1 ? "Location permission allow karo (browser/phone settings)" : "Location nahi mili, dobara try karo"),
    { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 });
}
async function wallLocSearch() {
  const q = (document.getElementById("wallLocName")?.value || "").trim();
  const box = document.getElementById("wallLocResults"); if (!box) return;
  if (q.length < 3) { toast("Pehle jagah ka naam likho (kam se kam 3 akshar)"); return; }
  box.innerHTML = '<p class="muted">Dhundh rahe hain…</p>';
  try {
    const r = await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5&q=${encodeURIComponent(q)}`, { headers: { "Accept-Language": "en" } });
    wallLocHits = await r.json();
  } catch (e) { box.innerHTML = '<p class="muted">Search nahi ho paya. Internet check karo ya lat/lng khud daalo.</p>'; return; }
  box.innerHTML = wallLocHits.length
    ? wallLocHits.map((h, i) => `<button type="button" class="wall-loc-hit" onclick="wallLocPick(${i})">📍 ${esc(h.display_name)}</button>`).join("")
    : '<p class="muted">Kuchh nahi mila. Thoda alag likh ke try karo, ya map pe chuno.</p>';
}
function wallLocPick(i) {
  const h = wallLocHits[i]; if (!h) return;
  wallLocSet(h.lat, h.lon, h.display_name.split(", ").slice(0, 3).join(", "));
  document.getElementById("wallLocResults").innerHTML = "";
}
/* Understands: full Google Maps links (.../@lat,lng,.. | ...!3dLAT!4dLNG | ?q=lat,lng | ?ll=lat,lng) and plain "lat, lng". */
function wallLocParse(s) {
  s = decodeURIComponent(String(s || "").trim());
  const num = "(-?\\d{1,3}(?:\\.\\d+)?)";
  const pats = [new RegExp("!3d" + num + "!4d" + num), new RegExp("@" + num + ",\\s*" + num), new RegExp("[?&](?:q|ll|query|destination|center)=" + num + ",\\s*" + num), new RegExp("^" + num + "\\s*[,\\s]\\s*" + num + "$")];
  for (const re of pats) { const m = s.match(re); if (m && Math.abs(m[1]) <= 90 && Math.abs(m[2]) <= 180) return { lat: +m[1], lng: +m[2] }; }
  return null;
}
function wallLocPaste(v) {
  v = (v || "").trim(); if (!v) return;
  const c = wallLocParse(v);
  if (c) { wallLocSet(c.lat, c.lng); toast("Location mil gayi"); return; }
  if (/maps\.app\.goo\.gl|goo\.gl\/maps/i.test(v)) toast("Ye chhota link hai. Browser mein khol ke poora link copy karo, ya map me pin dabake coordinates copy karo");
  else toast("Is link se coordinates nahi mile. Poora Google Maps link ya 'lat, lng' paste karo");
}
async function wallMapPin(lat, lng, pan) {
  if (!wallMap) return;
  const L = wallMap._L;
  if (wallMarker) wallMarker.setLatLng([lat, lng]);
  else {
    wallMarker = L.marker([lat, lng], { draggable: true }).addTo(wallMap);
    wallMarker.on("dragend", () => { const p = wallMarker.getLatLng(); wallLocSet(p.lat, p.lng, null, { fromMap: true }); });
  }
  if (pan) wallMap.setView([lat, lng], Math.max(wallMap.getZoom(), 15));
}
function wallLoadLeaflet() {   // Leaflet comes from a CDN on first use, so nothing needs to be installed with npm
  if (window.L) return Promise.resolve(window.L);
  return new Promise((res, rej) => {
    const css = document.createElement("link"); css.rel = "stylesheet"; css.href = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
    css.integrity = "sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY="; css.crossOrigin = ""; document.head.appendChild(css);
    const s = document.createElement("script"); s.src = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js";
    s.integrity = "sha256-20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo="; s.crossOrigin = "";
    s.onload = () => window.L ? res(window.L) : rej(new Error("leaflet missing")); s.onerror = () => rej(new Error("leaflet load failed")); document.head.appendChild(s);
  });
}
async function wallLocToggleMap() {
  const box = document.getElementById("wallLocMap"); if (!box) return;
  box.hidden = !box.hidden; if (box.hidden) return;
  if (wallMap) { setTimeout(() => wallMap.invalidateSize(), 50); return; }
  box.textContent = "Map load ho raha hai…";
  try {
    const L = await wallLoadLeaflet();
    box.textContent = "";
    const la = parseFloat(document.getElementById("wallLat").value), lo = parseFloat(document.getElementById("wallLng").value), has = isFinite(la) && isFinite(lo);
    wallMap = L.map(box).setView(has ? [la, lo] : [22.5, 79], has ? 15 : 5);
    wallMap._L = L;
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: "© OpenStreetMap" }).addTo(wallMap);
    wallMap.on("click", e => wallLocSet(e.latlng.lat, e.latlng.lng, null, { fromMap: true }));
    if (has) wallMapPin(la, lo, false);
    setTimeout(() => wallMap && wallMap.invalidateSize(), 80);
  } catch (e) { console.warn("map load failed", e); box.textContent = "Map load nahi hua. Lat/lng khud daal sakte ho."; }
}
async function wallPost() {
  const t = document.getElementById("wallText"); const body = (t?.value || "").trim();
  if (!body && !wallFiles.length) { toast("Kuch likho ya photo/video jodo"); return; }
  if (!supabase || !currentUser) { toast("Sign in to post"); return; }
  const loc = wallLocRead(); if (loc === false) return;
  const btn = document.getElementById("wallPostBtn");
  if (btn) { btn.disabled = true; btn.textContent = wallFiles.length ? "Uploading…" : "Posting…"; }
  const uploaded = [];
  try {
    for (const f of wallFiles) {
      const isV = f.type.startsWith("video/");
      const prep = isV ? { blob: f, type: f.type, ext: WALL_VIDEO_EXT[f.type] } : await wallPrepImage(f);
      const path = `${currentUser.id}/${crypto.randomUUID()}.${prep.ext}`;
      const { error: upErr } = await supabase.storage.from("wall-media").upload(path, prep.blob, { contentType: prep.type, cacheControl: "3600" });
      if (upErr) throw upErr;
      uploaded.push({ path, type: isV ? "video" : "image" });
    }
    const { error } = await supabase.rpc("add_person_wall_post", { p_person_id: wallPersonId, p_body: body, p_tagged: wallTags, p_media: uploaded, p_place_name: loc?.name || null, p_lat: loc?.lat ?? null, p_lng: loc?.lng ?? null });
    if (error) throw error;
  } catch (e) {
    if (uploaded.length) supabase.storage.from("wall-media").remove(uploaded.map(u => u.path)).catch(() => {});   // don't leave orphan files
    toast(wallErr(e));
    if (btn) { btn.disabled = false; btn.textContent = "Post"; }
    return;
  }
  toast(wishKey ? "Wish bhej di 🎉" : "Posted");
  evMarkWished();
  wallFiles.forEach(f => f._url && URL.revokeObjectURL(f._url)); wallFiles = [];
  if (wallComposerOnly) closeEditProfile();
  else { t.value = ""; wallTags = []; wallRenderTags(); wallRenderFiles(); wallLocClear(); if (btn) { btn.disabled = false; btn.textContent = "Post"; } const pk = document.getElementById("wallTagPicker"); if (pk) pk.hidden = true; loadPersonWall(); }
  if (document.getElementById("wallFeed")) loadWallFeed(); // Wall tab is open behind the popup: refresh it too
}
function wallPostHTML(m, ctx) {
  const tags = (m.tagged || []).map(t => `<button type="button" class="wall-chip link" onclick="openProfilePopup('${esc(t.id)}')">🏷 ${esc(t.name)}</button>`).join("");
  const id = esc(m.id), k = ctx + "-" + id;
  const onWall = m.person_id && !m.on_own_wall ? ` <span class="muted">›</span> <button type="button" class="wall-link" onclick="openPersonWall('${esc(m.person_id)}')">${esc(m.person_name || "")}'s wall</button>` : "";
  const media = Array.isArray(m.media) ? m.media : [];
  const mediaHTML = media.length ? `<div class="wall-media n${Math.min(media.length, 4)}">${media.map(x => x.type === "video"
    ? `<div class="wall-vwrap"><video data-wm="${esc(x.path)}" controls playsinline preload="metadata"></video><div class="wall-vact"><button type="button" title="Share" onclick="wallSaveMedia(this,'share')">📤</button><button type="button" title="Download" onclick="wallSaveMedia(this,'download')">⬇</button></div></div>`
    : `<img data-wm="${esc(x.path)}" alt="Post photo" loading="lazy" onclick="wallViewImage(this.src)">`).join("")}</div>` : "";
  return `<div class="wall-post" id="wp-${k}" data-media="${esc(JSON.stringify(media.map(x => x.path)))}">
    <div class="wall-post-head"><span><b>${esc(m.author_name || "Family member")}</b>${onWall} <span class="muted">· ${esc(fmtDateTime(m.created_at))}</span></span>
      ${m.can_delete ? `<button type="button" class="ghost" title="Delete" onclick="wallDeletePost('${id}','${ctx}')">🗑</button>` : ""}</div>
    ${m.body ? `<div class="wall-body">${esc(m.body)}</div>` : ""}${mediaHTML}${wallLocTagHTML(m)}
    ${tags ? `<div class="wall-chips">With ${tags}</div>` : ""}
    <div class="wall-actions">
      <div class="wall-react" id="wr-${k}">${wallReactHTML(m.id, ctx, m.reactions || (Number(m.like_count) ? { heart: Number(m.like_count) } : {}), m.my_reaction || (m.liked_by_me ? "heart" : null))}</div>
      <button type="button" class="wall-act" onclick="wallToggleComments('${id}','${ctx}')">💬 <span id="wcn-${k}">${Number(m.comment_count) || 0}</span></button>
    </div>
    <div class="wall-comments" id="wc-${k}" hidden></div>
  </div>`;
}
function wallReopenComments(ctx) { [...wallOpenComments].filter(x => x.startsWith(ctx + ":")).forEach(x => wallLoadComments(x.slice(ctx.length + 1), ctx)); }
async function loadPersonWall() {
  const pid = wallPersonId;
  const box = document.getElementById("wallList"); if (!box) return;
  if (!supabase || !currentUser) { box.innerHTML = '<p class="muted">Sign in to see the wall.</p>'; return; }
  const { data, error } = await supabase.rpc("list_person_wall", { p_person_id: pid });
  const now = document.getElementById("wallList");
  if (!now || wallPersonId !== pid) return; // closed or switched to another person
  if (error) { now.innerHTML = `<p class="muted">${esc(wallErr(error))}</p>`; return; }
  now.innerHTML = (data || []).map(m => wallPostHTML(m, "m")).join("") || '<p class="muted">Abhi kisi ne kuchh nahi likha. Pehli post aap likho.</p>';
  wallHydrateMedia(now);
  wallReopenComments("m");
}
/* Wall tab: everyone's posts in the tree, newest first. */
async function loadWallFeed() {
  const box = document.getElementById("wallFeed"); if (!box) return;
  if (!supabase || !currentUser || !state.treeId) { box.innerHTML = '<p class="muted">Sign in to see the family feed.</p>'; return; }
  const { data, error } = await supabase.rpc("list_wall_feed", { p_tree_id: state.treeId });
  const now = document.getElementById("wallFeed"); if (!now) return;
  if (error) { now.innerHTML = `<p class="muted">${esc(wallErr(error))}</p>`; return; }
  now.innerHTML = (data || []).map(m => wallPostHTML(m, "f")).join("") || '<p class="muted">Abhi kisi ne kuchh post nahi kiya. "New post" se shuruaat karo.</p>';
  wallHydrateMedia(now);
  wallReopenComments("f");
}
function wallRefresh(ctx) { if (ctx === "f") loadWallFeed(); else { loadPersonWall(); if (document.getElementById("wallFeed")) loadWallFeed(); } }
/* ---- reactions: one per person per post (tap the button, pick an emoji; pick the same one again to remove it) ---- */
const WALL_REACTIONS = [["like", "👍", "Like"], ["heart", "❤️", "Pyaar"], ["laugh", "😂", "Haha"], ["sad", "😢", "Dukh"], ["namaste", "🙏", "Namaste"], ["highfive", "🙌", "High five"]];
function wallReactHTML(postId, ctx, reactions, mine) {
  const id = esc(postId), cur = WALL_REACTIONS.find(r => r[0] === mine);
  const summary = WALL_REACTIONS.map(r => [r, Number((reactions || {})[r[0]]) || 0]).filter(x => x[1] > 0).sort((a, b) => b[1] - a[1])
    .map(([r, n]) => `<span class="wall-rx${r[0] === mine ? " mine" : ""}" title="${esc(r[2])}">${r[1]} ${n}</span>`).join("");
  return `<button type="button" class="wall-act${cur ? " on" : ""}" onclick="wallReactToggle('${id}','${ctx}')">${cur ? cur[1] + " " + esc(cur[2]) : "🙂 React"}</button>${summary}
    <div class="wall-picker" hidden>${WALL_REACTIONS.map(r => `<button type="button" class="${r[0] === mine ? "sel" : ""}" title="${esc(r[2])}" aria-label="${esc(r[2])}" onclick="wallReact('${id}','${ctx}','${r[0]}')">${r[1]}</button>`).join("")}</div>`;
}
function wallReactToggle(postId, ctx) { const pk = document.querySelector(`#wr-${ctx}-${postId} .wall-picker`); if (pk) pk.hidden = !pk.hidden; }
async function wallReact(postId, ctx, key) {
  if (!supabase || !currentUser) { toast("Sign in to react"); return; }
  const { data, error } = await supabase.rpc("set_wall_reaction", { p_post_id: postId, p_reaction: key });
  if (error) { toast(/set_wall_reaction|function|schema cache/i.test(error.message || "") ? "Run supabase-wall-reactions.sql in Supabase first" : wallErr(error)); return; }
  const r = Array.isArray(data) ? data[0] : data; if (!r) return;
  const box = document.getElementById(`wr-${ctx}-${postId}`); if (box) box.innerHTML = wallReactHTML(postId, ctx, r.reactions || {}, r.my_reaction || null);
}
function wallToggleComments(postId, ctx) {
  const box = document.getElementById("wc-" + ctx + "-" + postId); if (!box) return;
  const key = ctx + ":" + postId;
  if (!box.hidden) { box.hidden = true; wallOpenComments.delete(key); return; }
  wallOpenComments.add(key); wallLoadComments(postId, ctx);
}
async function wallLoadComments(postId, ctx) {
  const k = ctx + "-" + postId;
  const box = document.getElementById("wc-" + k); if (!box) return;
  box.hidden = false;
  const { data, error } = await supabase.rpc("list_wall_comments", { p_post_id: postId });
  if (error) { box.innerHTML = `<p class="muted">${esc(wallErr(error))}</p>`; return; }
  const typed = document.getElementById("wci-" + k)?.value || "";
  const list = (data || []).map(c => `<div class="wall-comment"><span><b>${esc(c.author_name || "Family member")}</b> <span class="muted">· ${esc(fmtDateTime(c.created_at))}</span>
      <div class="wall-body">${esc(c.body)}</div></span>
      ${c.can_delete ? `<button type="button" class="ghost" title="Delete" onclick="wallDeleteComment('${esc(c.id)}','${esc(postId)}','${ctx}')">🗑</button>` : ""}</div>`).join("");
  box.innerHTML = `${list || '<p class="muted" style="margin:0 0 8px">Abhi koi comment nahi.</p>'}
    <div class="wall-cform"><input id="wci-${k}" maxlength="1000" placeholder="Write a comment…" onkeydown="if(event.key==='Enter'){wallAddComment('${esc(postId)}','${ctx}')}"><button type="button" class="primary" onclick="wallAddComment('${esc(postId)}','${ctx}')">Send</button></div>`;
  const inp = document.getElementById("wci-" + k); if (inp) inp.value = typed;
  const n = document.getElementById("wcn-" + k); if (n) n.textContent = (data || []).length;
}
async function wallAddComment(postId, ctx) {
  const inp = document.getElementById("wci-" + ctx + "-" + postId); const body = (inp?.value || "").trim();
  if (!body) return;
  const { error } = await supabase.rpc("add_wall_comment", { p_post_id: postId, p_body: body });
  if (error) { toast(wallErr(error)); return; }
  inp.value = ""; wallLoadComments(postId, ctx);
}
async function wallDeleteComment(id, postId, ctx) {
  if (!confirm("Delete this comment?")) return;
  const { error } = await supabase.rpc("delete_wall_comment", { p_id: id });
  if (error) { toast(wallErr(error)); return; }
  wallLoadComments(postId, ctx);
}
async function wallDeletePost(id, ctx) {
  if (!confirm("Delete this post?")) return;
  let paths = []; try { paths = JSON.parse(document.getElementById("wp-" + ctx + "-" + id)?.dataset.media || "[]"); } catch (e) {}
  const { error } = await supabase.rpc("delete_person_wall_post", { p_id: id });
  if (error) { toast(wallErr(error)); return; }
  if (paths.length) supabase.storage.from("wall-media").remove(paths).catch(() => {});   // only the uploader's own files can be removed
  wallOpenComments.delete(ctx + ":" + id); wallRefresh(ctx);
}
/* Popup that shows a person's profile (opened by clicking a card in the tree). */
function openProfilePopup(id) {
  const p = personById(id); if (!p) return;
  profileModalOrigin = "view";
  profileModalLocked = false;
  const rel = p.me ? "Self" : deriveRelationship(me().id, p.id).label;
  profileModalShell(`<div class="modal-head"><h3>Profile</h3><button type="button" class="ghost" aria-label="Close" onclick="closeEditProfile()">✕</button></div>
    <div class="modal-body">
      <div style="display:flex;gap:14px;align-items:center">${avatarHTML(p, "lg " + (p.me ? "gold" : ""))}
        <div><div style="font-family:var(--font-display);font-size:20px;font-weight:700">${esc(p.name)}</div>
        <div class="muted" style="font-size:12.5px;margin:2px 0 2px">${esc(rel)} · ${esc(p.personCode || p.id)}</div>
        ${kinLine(p) ? `<div class="person-kin" style="margin:0 0 6px">${esc(kinLine(p))}</div>` : '<div style="margin-bottom:4px"></div>'}
        ${p.status === "unclaimed" ? '<span class="badge">Unclaimed</span>' : '<span class="badge sage">Claimed</span>'}</div></div>
      <div>${filledDetailsHTML(p)}</div>
    </div>
    <div class="actions modal-foot">
      <button type="button" class="secondary" onclick="openPersonWall('${esc(p.id)}')">📝 Wall</button>
      <button type="button" class="ghost" onclick="openFullProfile('${esc(p.id)}')">Open full profile</button>
      ${canEditPerson(p) ? `<button type="button" class="primary" onclick="openEditProfile('${esc(p.id)}', true)">✏️ Edit</button>` : ""}
    </div>`);
}
function openFullProfile(id) { closeEditProfile(); openProfile(id); }
/* Full edit form. fromView = true when it was reached from the profile popup. */
function openEditProfile(id, fromView) {
  const p = personById(id);
  if (!p || !canEditPerson(p)) { toast("You can't edit this profile"); return; }
  profileModalOrigin = fromView ? "view" : "edit";
  profileModalLocked = true;
  profileModalShell(`<div class="modal-head"><h3>✏️ ${p.me ? "Edit my details" : "Edit details of " + esc(p.name)}</h3><button type="button" class="ghost" aria-label="Close" onclick="closeEditProfile()">✕</button></div>
    <div class="form modal-body">${editProfileFormHTML(p)}</div>
    <div class="actions modal-foot"><button type="button" class="ghost" onclick="cancelEditProfile('${esc(p.id)}')">Cancel</button><button type="button" class="primary" onclick="saveProfileEdits('${esc(p.id)}')">Save changes</button></div>`);
  document.getElementById("mpFirst")?.focus();
}
/* Change your own contact email from the profile page (updates your person card + account profile). */
function openChangeEmail(id) {
  const p = personById(id);
  if (!p || !p.me) { toast("You can only change your own email"); return; }
  profileModalOrigin = "edit";
  profileModalLocked = true;
  profileModalShell(`<div class="modal-head"><h3>✉️ Change email</h3><button type="button" class="ghost" aria-label="Close" onclick="closeEditProfile()">✕</button></div>
    <div class="form modal-body">
      <p class="muted" style="font-size:13px;margin:0 0 8px">Current email: <strong>${esc(p.email || state.account.email || "not set")}</strong></p>
      <div class="field"><label>New email</label><input id="mpNewEmail" type="email" placeholder="name@gmail.com" autocomplete="email"></div>
    </div>
    <div class="actions modal-foot"><button type="button" class="ghost" onclick="closeEditProfile()">Cancel</button><button type="button" class="primary" onclick="saveNewEmail('${esc(p.id)}')">Save email</button></div>`);
  document.getElementById("mpNewEmail")?.focus();
}
/* Changes the LOGIN (auth) email. Supabase may require the new address to be confirmed first. */
async function changeLoginEmail(email) {
  if (!supabase || !currentUser) return { status: "applied" }; // demo mode
  const { data, error } = await supabase.auth.updateUser({ email }, { emailRedirectTo: window.location.origin });
  if (error) {
    const taken = error.code === "email_exists" || /already (been )?registered|already exists|already in use/i.test(error.message || "");
    return { status: "error", message: taken ? `${email} pehle se kisi aur account mein registered hai. Koi doosra email daalo, ya us email wale account se login karo.` : error.message };
  }
  if ((data?.user?.email || "").toLowerCase() === email.toLowerCase()) { currentUser = data.user; return { status: "applied" }; }
  try { localStorage.setItem("ft_pending_email", JSON.stringify({ uid: currentUser.id, email: email.toLowerCase() })); } catch (e) {}
  return { status: "pending" };
}
async function saveNewEmail(id) {
  const p = personById(id);
  if (!p || !p.me) { toast("You can only change your own email"); return; }
  const email = document.getElementById("mpNewEmail").value.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { toast("Please enter a valid email"); return; }
  if (email === (p.email || "").toLowerCase() && email === (currentUser?.email || "").toLowerCase()) { toast("This is already your email"); return; }
  const res = await changeLoginEmail(email);
  if (res.status === "error") { toast("Login email change failed: " + res.message); return; }
  if (res.status === "pending") {
    toast(`${email} par confirmation link bheja gaya hai. Link par click karte hi aapka login email badal jayega.`);
    closeEditProfile(); render(); return; // card + profile email are synced automatically after you confirm
  }
  p.email = email;
  state.account.email = email;
  await save();
  if (supabase && currentUser) {
    const { error } = await supabase.from("profiles").update({ email }).eq("id", currentUser.id);
    if (error) { toast("Saved on your card, but account email failed: " + error.message); render(); closeEditProfile(); return; }
  }
  toast("Email updated");
  closeEditProfile();
  render();
}
function cancelEditProfile(id) { if (profileModalOrigin === "view") openProfilePopup(id); else closeEditProfile(); }
function closeEditProfile() {
  profileModalLocked = false;
  document.getElementById("editModal")?.remove();
  document.body.style.overflow = "";
}
document.addEventListener("keydown", e => { if (e.key === "Escape" && !profileModalLocked) closeEditProfile(); });
async function saveProfileEdits(id) {
  const p = personById(id); if (!p || !canEditPerson(p)) { toast("You can't edit this profile"); return; }
  const g = id => document.getElementById(id).value.trim();
  const first = g("mpFirst"), middle = g("mpMiddle"), last = g("mpSurname");
  if (!first || !last) { toast("First name and surname are required"); return; }
  const email = g("mpEmail");
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { toast("Please enter a valid email"); return; }
  const mobile = g("mpMobile");
  if (mobile && !/^[+\d][\d\s-]{6,17}$/.test(mobile)) { toast("Please enter a valid mobile number"); return; }
  // my own card: the email is also my login email, so change it in the account too
  let emailPending = false;
  const oldCardEmail = p.email;
  if (p.me && email && supabase && currentUser && email.toLowerCase() !== (currentUser.email || "").toLowerCase()) {
    const res = await changeLoginEmail(email);
    if (res.status === "error") { toast("Login email change failed: " + res.message); return; }
    emailPending = res.status === "pending";
  }
  const dob = g("mpDob"), dod = g("mpDod");
  if (dob && dod && dod < dob) { toast("Date of death can't be before date of birth"); return; }
  p.name = [first, middle, last].filter(Boolean).join(" ");
  p.gender = document.getElementById("mpGender").value || undefined;
  p.dob = dob || undefined;
  p.mobile = mobile || undefined;
  p.email = emailPending ? oldCardEmail : (email || undefined);
  p.lifeStatus = dod ? "deceased" : "living";
  p.details = { ...(p.details || {}), firstName: first, middleName: middle, surname: last, dod: dod || "", birth_time: g("mpBirthTime"), state: g("mpState"), city: g("mpCity"), married: document.getElementById("mpMarried").value, marriage: { ...((p.details || {}).marriage || {}), date: g("mpMarriageDate") } };
  if (p.details.marriage?.date) syncMarriageDate(id); else clearSpouseMarriageDate(id);   // husband / wife get the same anniversary
  if (p.me) { state.account.name = p.name; if (email && !emailPending) state.account.email = email; }
  await save();
  if (p.me && supabase && currentUser) { try { await supabase.from("profiles").update({ display_name: p.name, ...(email && !emailPending ? { email } : {}) }).eq("id", currentUser.id); } catch (e) { console.warn("display_name update failed", e); } }
  toast(emailPending ? `Profile updated. ${email} par confirmation link bheja gaya hai — click karte hi login email badal jayega.` : "Profile updated");
  render();
  if (profileModalOrigin === "view") openProfilePopup(id); else closeEditProfile();
}
function setPrivacy(id, val) { const p = state.people.find(x => x.id === id); if (p) { p.privacy = val; save(); toast("Privacy set to " + val); } }

/* ---------------- Profile photo: Camera / Gallery + square crop ---------------- */
function closePhotoSheet() { document.getElementById("photoSheet")?.remove(); }
function closePhotoCrop() { document.getElementById("photoCrop")?.remove(); }
function changePhoto(id) {
  if (!supabase || !currentUser) { toast("Please sign in to upload a photo"); return; }
  closePhotoSheet();
  const el = document.createElement("div");
  el.id = "photoSheet"; el.className = "modal-overlay"; el.style.zIndex = 120;
  el.innerHTML = `<div class="modal-card" style="max-width:360px"><div class="modal-head"><h3>Profile photo</h3><button type="button" class="ghost" id="phClose" aria-label="Close">✕</button></div>
    <div class="modal-body"><button type="button" class="primary" id="phCam">📷 Camera se photo lein</button><button type="button" class="secondary" id="phGal">🖼️ Gallery se chunein</button></div></div>`;
  document.body.appendChild(el);
  const pick = useCamera => {          // must run inside the click handler so the browser allows the picker
    const input = document.createElement("input");
    input.type = "file"; input.accept = "image/*";
    if (useCamera) input.setAttribute("capture", "user");   // opens the camera on phones; desktops show the normal file picker
    input.onchange = () => { const f = input.files && input.files[0]; closePhotoSheet(); if (f) openPhotoCrop(id, f); };
    input.click();
  };
  el.addEventListener("click", e => { if (e.target === el) closePhotoSheet(); });
  document.getElementById("phClose").onclick = closePhotoSheet;
  document.getElementById("phCam").onclick = () => pick(true);
  document.getElementById("phGal").onclick = () => pick(false);
}
async function openPhotoCrop(id, file) {
  if (!file.type.startsWith("image/")) { toast("Please choose an image file"); return; }
  if (file.size > 25 * 1024 * 1024) { toast("Image is too large (max 25MB)"); return; }
  let bmp;
  try { bmp = await createImageBitmap(file, { imageOrientation: "from-image" }); }
  catch (e) {
    try { bmp = await new Promise((res, rej) => { const im = new Image(), u = URL.createObjectURL(file); im.onload = () => { URL.revokeObjectURL(u); res(im); }; im.onerror = rej; im.src = u; }); }
    catch (e2) { toast("Ye photo khul nahi paayi. JPG ya PNG try karein."); return; }
  }
  const W = bmp.width, H = bmp.height, S = Math.max(220, Math.min(320, window.innerWidth - 72)), OUT = 512;
  const base = Math.max(S / W, S / H);                    // smallest scale that still covers the square
  let zoom = 1, ox = 0, oy = 0;                           // ox/oy = image-centre offset from the crop-square centre (view pixels)
  closePhotoCrop();
  const el = document.createElement("div");
  el.id = "photoCrop"; el.className = "modal-overlay"; el.style.zIndex = 130;
  el.innerHTML = `<div class="modal-card" style="max-width:380px"><div class="modal-head"><h3>Photo crop karein</h3><button type="button" class="ghost" id="pcX" aria-label="Close">✕</button></div>
    <div class="modal-body" style="justify-items:center"><canvas id="pcCanvas" class="crop-stage" width="${S}" height="${S}" style="width:${S}px;height:${S}px"></canvas>
      <div class="muted" style="font-size:12.5px">Photo ko khinch kar sahi jagah layein · zoom ke liye slider</div>
      <input id="pcZoom" type="range" min="1" max="4" step="0.01" value="1" style="width:${S}px" aria-label="Zoom"></div>
    <div class="actions modal-foot"><button type="button" class="ghost" id="pcCancel">Cancel</button><button type="button" class="primary" id="pcSave">Save photo</button></div></div>`;
  document.body.appendChild(el);
  const cv = document.getElementById("pcCanvas"), ctx = cv.getContext("2d");
  const clamp = () => { const k = base * zoom, mx = Math.max(0, (W * k - S) / 2), my = Math.max(0, (H * k - S) / 2); ox = Math.min(mx, Math.max(-mx, ox)); oy = Math.min(my, Math.max(-my, oy)); };
  const paint = (c, size, overlay) => {
    const f = size / S, k = base * zoom * f;
    c.fillStyle = "#111"; c.fillRect(0, 0, size, size);
    c.drawImage(bmp, size / 2 + ox * f - W * k / 2, size / 2 + oy * f - H * k / 2, W * k, H * k);
    if (overlay) {                                          // dim everything outside the circle so the final round avatar is visible
      c.save(); c.beginPath(); c.rect(0, 0, size, size); c.arc(size / 2, size / 2, size / 2 - 2, 0, Math.PI * 2, true);
      c.fillStyle = "rgba(0,0,0,.5)"; c.fill("evenodd"); c.restore();
      c.beginPath(); c.arc(size / 2, size / 2, size / 2 - 2, 0, Math.PI * 2); c.strokeStyle = "rgba(255,255,255,.85)"; c.lineWidth = 2; c.stroke();
    }
  };
  const redraw = () => { clamp(); paint(ctx, S, true); };
  const setZoom = z => { zoom = Math.min(4, Math.max(1, z)); document.getElementById("pcZoom").value = zoom; redraw(); };
  redraw();
  // drag to pan, pinch to zoom, wheel to zoom
  const ptrs = new Map(); let lastDist = 0;
  cv.addEventListener("pointerdown", e => { cv.setPointerCapture(e.pointerId); ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY }); lastDist = 0; cv.style.cursor = "grabbing"; });
  cv.addEventListener("pointermove", e => {
    const p = ptrs.get(e.pointerId); if (!p) return;
    const nx = e.clientX, ny = e.clientY;
    if (ptrs.size === 1) { ox += nx - p.x; oy += ny - p.y; ptrs.set(e.pointerId, { x: nx, y: ny }); redraw(); }
    else { ptrs.set(e.pointerId, { x: nx, y: ny }); const [a, b2] = [...ptrs.values()], d = Math.hypot(a.x - b2.x, a.y - b2.y); if (lastDist) setZoom(zoom * d / lastDist); lastDist = d; }
  });
  const up = e => { ptrs.delete(e.pointerId); lastDist = 0; cv.style.cursor = "grab"; };
  cv.addEventListener("pointerup", up); cv.addEventListener("pointercancel", up);
  cv.addEventListener("wheel", e => { e.preventDefault(); setZoom(zoom * (e.deltaY < 0 ? 1.08 : 1 / 1.08)); }, { passive: false });
  document.getElementById("pcZoom").oninput = e => setZoom(parseFloat(e.target.value));
  const close = () => { closePhotoCrop(); bmp.close?.(); };
  document.getElementById("pcX").onclick = close; document.getElementById("pcCancel").onclick = close;
  document.getElementById("pcSave").onclick = async () => {
    const btn = document.getElementById("pcSave"); btn.disabled = true; btn.textContent = "Saving…";
    const out = document.createElement("canvas"); out.width = out.height = OUT;
    paint(out.getContext("2d"), OUT, false);
    const blob = await new Promise(r => out.toBlob(r, "image/jpeg", 0.9));
    close();
    if (!blob) { toast("Photo save nahi ho paayi"); return; }
    await uploadAvatarBlob(id, blob);
  };
}
async function uploadAvatarBlob(id, blob) {
  toast("Uploading photo…");
  try {
    const path = `${currentUser.id}/${id}-${Date.now()}.jpg`;
    const { error: upErr } = await supabase.storage.from("avatars").upload(path, blob, { upsert: true, cacheControl: "3600", contentType: "image/jpeg" });
    if (upErr) throw upErr;
    const { data: pub } = supabase.storage.from("avatars").getPublicUrl(path);
    const avatar_url = pub.publicUrl;
    const { error: dbErr } = await supabase.from("persons").update({ avatar_url }).eq("id", id);
    if (dbErr) throw dbErr;
    const p = state.people.find(x => x.id === id);
    if (p) p.avatar_url = avatar_url;
    toast("Photo updated");
    render();
  } catch (e) {
    console.error("Photo upload failed", e);
    toast("Photo upload failed: " + e.message);
  }
}

/* ---------------- V4: merge ---------------- */
function normName(s) { return String(s || "").toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim(); }
function sameNameLoose(a, b) {
  const x = normName(a).split(" ").filter(Boolean), y = normName(b).split(" ").filter(Boolean);
  if (!x.length || !y.length) return false;
  if (x.join(" ") === y.join(" ")) return true;
  if ([...x].sort().join(" ") === [...y].sort().join(" ")) return true;
  return x.length > 1 && y.length > 1 && x[0] === y[0] && x[x.length - 1] === y[y.length - 1];
}
/* Father's name(s) of a person, taken from the relationship graph (parent link where the parent is Male). */
function fatherNamesOf(id) {
  return parentsOf(id).map(personById).filter(x => x && x.gender === "Male" && x.name).map(x => x.name);
}
/* Duplicate rule: name must match AND father name must match. If either profile has no father recorded yet, the
   father can't be compared: it stays a suggestion (set STRICT_FATHER_MATCH = true to skip such pairs instead). */
const STRICT_FATHER_MATCH = false;
function sameFatherLoose(a, b) {
  const fa = fatherNamesOf(a.id), fb = fatherNamesOf(b.id);
  if (!fa.length || !fb.length) return !STRICT_FATHER_MATCH;
  return fa.some(x => fb.some(y => sameNameLoose(x, y)));
}
function mergeCandidates() { return state.people.filter(p => p.status !== "merged" && !(p.details && p.details.deleted)); }
function personHint(p) {
  const bits = [];
  const par = parentsOf(p.id).map(personById).filter(Boolean).map(x => x.name);
  const sp = spousesOf(p.id).map(personById).filter(Boolean).map(x => x.name);
  const ch = childrenOf(p.id).length;
  if (par.length) bits.push("child of " + par.join(" & "));
  if (sp.length) bits.push("spouse of " + sp.join(", "));
  if (ch) bits.push(ch + " child" + (ch > 1 ? "ren" : ""));
  if (p.dob) bits.push("b. " + p.dob);
  if (p.details && p.details.gedcom_id) bits.push("imported");
  return bits.join(" · ") || "no details";
}
function mergeScore(p) {
  let s = 0;
  if (p.me) s += 1000;
  if (p.claimed_by) s += 500;
  ["dob", "mobile", "email", "avatar_url", "birthPlace", "currentPlace"].forEach(k => { if (p[k]) s += 10; });
  s += state.relationships.filter(r => r.from === p.id || r.to === p.id).length;
  return s;
}
/* Group likely duplicates (same / near-same name + same father name) using union-find. */
function findDuplicateGroups() {
  const list = mergeCandidates();
  const parent = {}; list.forEach(p => parent[p.id] = p.id);
  const find = x => parent[x] === x ? x : (parent[x] = find(parent[x]));
  for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
    const a = list[i], b = list[j];
    if (a.gender && b.gender && a.gender !== b.gender) continue;
    if (sameNameLoose(a.name, b.name) && sameFatherLoose(a, b)) parent[find(a.id)] = find(b.id);
  }
  const groups = {};
  list.forEach(p => { (groups[find(p.id)] = groups[find(p.id)] || []).push(p); });
  return Object.values(groups).filter(g => g.length > 1).map(g => {
    g.sort((x, y) => mergeScore(y) - mergeScore(x));
    return { keep: g[0], remove: g.slice(1) };
  });
}
function canMergeDirect() { return canEditTree() || isStaff(); }

function merge() {
  const groups = findDuplicateGroups();
  const direct = canMergeDirect();
  const dupCard = groups.length ? `<div class="card">
    <h3>Suggested duplicates (${groups.length})</h3>
    <p class="muted">Same naam aur same father ke naam wale profiles mile. Jo merge karne hain unhe tick karo — pehla naam (✓ Keep) rakha jayega, baaki uske andar merge honge.</p>
    ${groups.map((g, i) => `<div class="row" style="align-items:flex-start">
      <label style="display:flex;gap:10px;align-items:flex-start;flex:1;cursor:pointer">
        <input type="checkbox" class="dupchk" value="${i}" checked style="margin-top:4px">
        <span><strong>✓ Keep: ${esc(g.keep.name)}${g.keep.me ? " (You)" : ""}</strong> <span class="muted">— ${esc(personHint(g.keep))}</span>
        ${g.remove.map(r => `<br><span class="muted">↳ merge: ${esc(r.name)} — ${esc(personHint(r))}</span>`).join("")}</span>
      </label></div>`).join("")}
    <div style="margin-top:12px"><button class="primary" onclick="mergeSelectedGroups()">${direct ? "Merge selected now" : "Send merge requests"}</button></div>
  </div>` : `<div class="card"><h3>Suggested duplicates</h3><p class="muted">Koi duplicate profile nahi mila.</p></div>`;
  return `<div class="page-head"><h2>Duplicate Merge</h2><p class="muted">Duplicate profiles ko ek mein jodo. Saare rishte (relationships) kept profile par shift ho jayenge.</p></div>
  ${dupCard}
  <div class="card form">
    <h3>Manual merge</h3>
    ${mergePickerHTML("ma", "Profile A")}
    ${mergePickerHTML("mb", "Profile B")}
    <button class="secondary" style="justify-self:start" onclick="compareMerge()">Compare Profiles</button>
  </div>
  <div id="mergeCompare"></div>
  <div class="card"><h3>Requests</h3>${state.mergeRequests.length ? state.mergeRequests.map((r, i) => `<div class="row"><span>${esc(r.a)} ↔ ${esc(r.b)}</span><span class="badge ${r.status === "Merged" ? "sage" : ""}">${esc(r.status)}</span>${r.status === "Pending" && (isStaff() || canEditTree()) ? `<button class="secondary" onclick="approveMerge(${i})">Approve &amp; Merge</button>` : ""}</div>`).join("") : "<p class='muted'>No requests yet.</p>"}</div>`;
}
/* Type-to-search pickers for Profile A / B. The chosen person's id lives in a hidden input (#ma / #mb), so compareMerge() reads it as before. */
function mergePickerHTML(key, label) {
  return `<div class="field"><label>${label}</label><div class="mpick">
    <input type="hidden" id="${key}">
    <input type="text" id="${key}Text" autocomplete="off" placeholder="Naam, nickname, mobile ya Person ID type karo…" oninput="mergePickSearch('${key}', true)" onfocus="mergePickSearch('${key}')" onkeydown="mergePickKey(event, '${key}')">
    <div class="mpick-list" id="${key}List" hidden></div></div></div>`;
}
function mergePickSearch(key, typing) {
  const txt = document.getElementById(key + "Text"), hid = document.getElementById(key), box = document.getElementById(key + "List"); if (!txt || !box) return;
  if (typing) hid.value = "";                                   // typing again = no person chosen yet
  const words = txt.value.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const hay = p => [p.name, p.nickname, p.personCode, p.mobile, p.email].filter(Boolean).join(" ").toLowerCase();
  const hits = mergeCandidates().filter(p => words.every(w => hay(p).includes(w)))
    .sort((a, b) => (+b.name.toLowerCase().startsWith(words[0] || "") - +a.name.toLowerCase().startsWith(words[0] || "")) || a.name.localeCompare(b.name));
  box.innerHTML = hits.slice(0, 8).map(p => `<button type="button" class="mpick-item" onclick="mergePickChoose('${key}','${esc(p.id)}')"><b>${esc(p.name)}</b>${p.me ? " (You)" : ""}${p.external ? " (dusri tree)" : ""}<small class="muted">${esc(personHint(p))}${p.personCode ? " · " + esc(p.personCode) : ""}</small></button>`).join("")
    + (hits.length > 8 ? `<div class="mpick-more muted">+${hits.length - 8} aur — naam ka aur hissa likho</div>` : "")
    || '<div class="mpick-more muted">Koi profile nahi mila</div>';
  box.hidden = false;
}
function mergePickChoose(key, id) {
  const p = personById(id); if (!p) return;
  document.getElementById(key).value = id; document.getElementById(key + "Text").value = p.name; document.getElementById(key + "List").hidden = true;
}
function mergePickKey(e, key) {
  if (e.key === "Enter") { e.preventDefault(); const first = document.querySelector(`#${key}List .mpick-item`); if (first) first.click(); }
  else if (e.key === "Escape") document.getElementById(key + "List").hidden = true;
}
let mergeOutsideBound = false;
function mergeInitSelects() {
  if (mergeOutsideBound) return; mergeOutsideBound = true;
  document.addEventListener("click", e => { if (!e.target.closest || !e.target.closest(".mpick")) document.querySelectorAll(".mpick-list").forEach(x => x.hidden = true); });
}
function compareMerge() {
  const a = personById(document.getElementById("ma").value);
  const b = personById(document.getElementById("mb").value);
  const box = document.getElementById("mergeCompare");
  if (!a || !b) { toast("Dono profile chuno: naam type karke list me se select karo"); return; }
  if (a.id === b.id) { box.innerHTML = `<div class="card"><p class="muted">Do alag profiles chuno (A aur B same hain).</p></div>`; return; }
  const same = (x, y) => x && y && x === y;
  const rowField = (label, av, bv) => `<div class="row"><span class="muted">${label}</span><span>${esc(av) || "—"}</span><span>${esc(bv) || "—"}</span></div>`;
  const matches = [], conflicts = [];
  if (same(a.dob, b.dob)) matches.push("DOB"); else if (a.dob || b.dob) conflicts.push("DOB");
  if (same(a.mobile, b.mobile)) matches.push("mobile"); else if (a.mobile || b.mobile) conflicts.push("mobile");
  if (normName(a.name) !== normName(b.name)) conflicts.push("display name"); else matches.push("name");
  const names = id => parentsOf(id).map(personById).filter(Boolean).map(x => x.name).join(", ");
  const spouses = id => spousesOf(id).map(personById).filter(Boolean).map(x => x.name).join(", ");
  const keepA = mergeScore(a) >= mergeScore(b);
  box.innerHTML = `<div class="card">
    <div class="row"><span></span><strong>${esc(a.name)}</strong><strong>${esc(b.name)}</strong></div>
    ${rowField("DOB", a.dob, b.dob)}${rowField("Mobile", a.mobile, b.mobile)}${rowField("Parents", names(a.id), names(b.id))}${rowField("Spouse", spouses(a.id), spouses(b.id))}
    ${matches.length ? `<div class="badge sage" style="margin-top:10px">✓ Matching: ${matches.join(", ")}</div>` : ""}
    ${conflicts.length ? `<div class="badge terracotta" style="margin-top:8px;margin-left:6px">! Conflict: ${conflicts.join(", ")}</div>` : ""}
    <hr class="divider">
    <label><input type="radio" name="keepname" value="${esc(a.id)}" ${keepA ? "checked" : ""}> Keep "${esc(a.name)}"</label><br>
    <label><input type="radio" name="keepname" value="${esc(b.id)}" ${keepA ? "" : "checked"}> Keep "${esc(b.name)}"</label>
    <p class="muted" style="margin-top:8px">Saare rishte kept profile par shift honge, duplicate edges hat jayenge, aur khali fields (DOB, mobile, photo…) dusre profile se bhar jayengi.</p>
    <button class="primary" onclick="requestMerge('${esc(a.id)}','${esc(b.id)}')">${canMergeDirect() ? "Merge now" : "Create Merge Request"}</button>
  </div>`;
}
/* Core merge: moves edges + empty fields onto kept person, soft-removes the duplicate. */
async function performMerge(keptId, removedId) {
  let kept = personById(keptId), removed = personById(removedId);
  if (!kept || !removed || kept.id === removed.id) return false;
  if (removed.me || (kept.external && !removed.external)) { [kept, removed] = [removed, kept]; }  // keep my own / my-tree profile
  if (kept.external) { toast("Kam se kam ek profile aapki apni tree ka hona chahiye"); return false; }
  ["dob", "mobile", "email", "avatar_url", "gender", "birthPlace", "currentPlace", "nickname"].forEach(k => { if (!kept[k] && removed[k]) kept[k] = removed[k]; });
  kept.details = { ...(removed.details || {}), ...(kept.details || {}) };
  kept.details.merged_from = [...(kept.details.merged_from || []), removed.id];
  // edges of the duplicate that live in ANOTHER tree can't be edited here: re-create them in my tree instead
  const oldEdgeIds = state.relationships.filter(r => r.from === removed.id || r.to === removed.id).map(r => r.id).filter(Boolean);
  state.relationships.forEach(r => { if ((r.from === removed.id || r.to === removed.id) && r.tree_id && r.tree_id !== state.treeId) { r.id = null; r.tree_id = null; } });
  reassignEdges(removed.id, kept.id);
  if (supabase) {
    if (oldEdgeIds.length) {
      const { error: re } = await supabase.from("relationships").delete().in("id", oldEdgeIds);
      if (re && !removed.external) { toast(re.message); return false; }
    } else if (!removed.external) {
      const { error: re } = await supabase.from("relationships").delete().eq("tree_id", state.treeId).or(`person_a_id.eq.${removed.id},person_b_id.eq.${removed.id}`);
      if (re) { toast(re.message); return false; }
    }
    const rdetails = { ...(removed.details || {}), deleted: true, merged_into: kept.id };
    let { error: pe } = await supabase.from("persons").update({ status: "merged", merged_into_person_id: kept.id, details: rdetails }).eq("id", removed.id);
    if (pe) { ({ error: pe } = await supabase.from("persons").update({ details: rdetails }).eq("id", removed.id)); }
    if (pe && !removed.external) { toast(pe.message); return false; }
    state.people = state.people.filter(p => p.id !== removed.id);
    await save();                                                   // writes kept person + re-pointed relationships
    try { await supabase.from("merge_requests").insert({ source_person_id: removed.id, target_person_id: kept.id, requested_by: currentUser.id, status: "completed", reviewed_by: currentUser.id }); } catch (e) { /* audit row is best-effort */ }
  } else {
    state.people = state.people.filter(p => p.id !== removed.id);
  }
  return kept.id;
}
async function mergeSelectedGroups() {
  const idx = [...document.querySelectorAll(".dupchk:checked")].map(x => +x.value);
  if (!idx.length) return toast("Kam se kam ek group tick karo");
  const groups = findDuplicateGroups();
  let done = 0;
  for (const i of idx) {
    const g = groups[i]; if (!g) continue;
    for (const r of g.remove) {
      if (canMergeDirect()) { if (await performMerge(g.keep.id, r.id)) done++; else break; }
      else if (await queueMergeRequest(g.keep.id, r.id)) done++;
    }
  }
  if (supabase) { try { await loadProductionState(currentUser); } catch (e) { console.error(e); } }
  toast(canMergeDirect() ? `${done} profile merge ho gaye` : `${done} merge request bhej di`);
  render();
}
async function queueMergeRequest(keptId, removedId) {
  if (supabase) { const { error } = await supabase.from("merge_requests").insert({ source_person_id: removedId, target_person_id: keptId, requested_by: currentUser.id }); if (error) { toast(error.message); return false; } }
  else state.mergeRequests.push({ a: personById(removedId)?.name, b: personById(keptId)?.name, keptId, removedId, status: "Pending" });
  return true;
}
async function requestMerge(a, b) {
  const keptId = document.querySelector('input[name="keepname"]:checked')?.value || a;
  const removedId = keptId === a ? b : a;
  if (canMergeDirect()) {
    if (!(await performMerge(keptId, removedId))) return;
    if (supabase) { try { await loadProductionState(currentUser); } catch (e) { console.error(e); } }
    toast("Profiles merge ho gaye"); go("merge"); return;
  }
  if (!(await queueMergeRequest(keptId, removedId))) return;
  if (supabase) await loadProductionState(currentUser);
  toast("Merge request admin review ke liye bhej di"); go("merge");
}
/* Admin / tree owner approves a pending request. */
async function approveMerge(i) {
  const req = state.mergeRequests[i];
  if (!req) return;
  if (!(await performMerge(req.keptId, req.removedId))) return;
  if (supabase && req.id) await supabase.from("merge_requests").update({ status: "completed", reviewed_by: currentUser.id }).eq("id", req.id);
  if (state.mergeRequests[i]) state.mergeRequests[i].status = "Merged";
  toast("Merge complete");
  if (supabase) { try { await loadProductionState(currentUser); } catch (e) { console.error(e); } }
  render();
}

/* ---------------- relationship finder — real graph traversal + path ---------------- */
function relationship() {
  const opts = state.people.map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join("");
  return `<div class="page-head"><h2>Relationship Finder</h2><p class="muted">Select any two people — the label and the full relationship path are derived live from the family graph.</p></div>
  <div class="card form"><div class="field"><label>Person A</label><select id="ra">${opts}</select></div>
  <div class="field"><label>Person B</label><select id="rb" onchange="">${opts}</select></div>
  <button class="primary" style="justify-self:start" onclick="findRelation()">Find Relationship</button><div id="relout"></div></div>`;
}
/* Relationship path drawn as a small family tree: parents sit above children, spouses side by side,
   and every line is labelled (Father, Wife, Son ...). A and B are highlighted. */
function relationTreeHTML(fromId, path) {
  const W = 132, H = 66, CX = 176, RY = 118, PAD = 24;
  const ids = [fromId, ...path.map(s => s.personId)];
  const pos = [{ col: 0, row: 0 }]; const taken = new Set(["0,0"]);
  path.forEach((st, i) => {
    const prev = pos[i]; let col = prev.col, row = prev.row + (st.dir === "up" ? -1 : st.dir === "down" ? 1 : 0);
    if (st.dir === "spouse" || taken.has(col + "," + row)) { col++; while (taken.has(col + "," + row)) col++; }
    taken.add(col + "," + row); pos.push({ col, row });
  });
  const minRow = Math.min(...pos.map(q => q.row)), maxRow = Math.max(...pos.map(q => q.row)), maxCol = Math.max(...pos.map(q => q.col));
  const X = q => PAD + q.col * CX, Y = q => PAD + (q.row - minRow) * RY;
  const totalW = PAD * 2 + maxCol * CX + W, totalH = PAD * 2 + (maxRow - minRow) * RY + H;
  const label = (st, person) => {
    const g = person && person.gender;
    if (st.dir === "up") return g === "Male" ? "Father" : g === "Female" ? "Mother" : "Parent";
    if (st.dir === "down") return g === "Male" ? "Son" : g === "Female" ? "Daughter" : "Child";
    return g === "Male" ? "Husband" : g === "Female" ? "Wife" : "Spouse";
  };
  let lines = "", pills = "";
  path.forEach((st, i) => {
    const A = pos[i], B = pos[i + 1], pr = personById(ids[i + 1]);
    let lx, ly;
    if (st.dir === "spouse") {
      const y = Y(A) + H / 2, x1 = X(A) + W, x2 = X(B);
      lines += `<line x1="${x1}" y1="${y}" x2="${x2}" y2="${y}" class="rt-spouse"/><circle cx="${(x1 + x2) / 2}" cy="${y}" r="5" class="rt-ring"/>`;
      lx = (x1 + x2) / 2; ly = y - 16;
    } else {
      const upper = st.dir === "up" ? B : A, lower = st.dir === "up" ? A : B;
      const x1 = X(upper) + W / 2, y1 = Y(upper) + H, x2 = X(lower) + W / 2, y2 = Y(lower), mid = (y1 + y2) / 2;
      lines += `<path d="M${x1} ${y1} V${mid} H${x2} V${y2}" class="rt-line"/>`;
      lx = (x1 + x2) / 2; ly = mid;
    }
    pills += `<span class="rt-pill" style="left:${lx}px;top:${ly}px">${esc(label(st, pr))}</span>`;
  });
  const cards = ids.map((id, i) => {
    const pp = personById(id) || { name: "?" }, q = pos[i], end = i === 0 ? "start" : i === ids.length - 1 ? "end" : "";
    return `<div class="rt-card ${end}" style="left:${X(q)}px;top:${Y(q)}px;width:${W}px;height:${H}px">${avatarHTML(pp, "rt-av")}<span class="rt-name">${esc(pp.name)}</span>${end ? `<span class="rt-tag">${end === "start" ? "A" : "B"}</span>` : ""}</div>`;
  }).join("");
  return `<div class="rt-wrap"><div class="rt-canvas" style="width:${totalW}px;height:${totalH}px"><svg width="${totalW}" height="${totalH}" class="rt-svg">${lines}</svg>${pills}${cards}</div></div>`;
}
function findRelation() {
  const a = state.people.find(p => p.id === document.getElementById("ra").value);
  const b = state.people.find(p => p.id === document.getElementById("rb").value);
  const result = deriveRelationship(a.id, b.id);
  const box = document.getElementById("relout");
  if (result.path === null) {
    box.innerHTML = `<div class="card" style="margin-top:10px"><strong>${esc(b.name)} isn't connected to ${esc(a.name)} in the graph yet.</strong><p class="muted" style="margin-top:6px">Add a parent, spouse or child edge to connect them.</p></div>`;
    return;
  }
  box.innerHTML = `<div class="card" style="margin-top:10px">
    <strong>${esc(b.name)} is ${a.id === b.id ? "" : `${result.label} of`} ${esc(a.name)}${a.id === b.id ? " (same person)" : ""}.</strong>
    ${result.path.length ? relationTreeHTML(a.id, result.path) : ""}
  </div>`;
}

/* ---------------- Events: birthdays, marriage & death anniversaries (computed from the tree) + DB events ---------------- */
let evFilter = "all", evRange = 365;
const EV_FILTERS = [["all", "Sab"], ["birth", "🎂 Birthday"], ["marriage", "💍 Anniversary"], ["death", "🕯 Death anniv."], ["custom", "🎉 Other"]];
const EV_RANGES = [[30, "30 din"], [90, "90 din"], [365, "1 saal"]];
function evParse(v) {   // -> {y, m, d} (y may be 0 if unknown) or null
  if (!v) return null;
  const s = String(v), iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (iso) return { y: +iso[1], m: +iso[2], d: +iso[3] };
  const x = new Date(s); return Number.isNaN(x.getTime()) ? null : { y: x.getFullYear(), m: x.getMonth() + 1, d: x.getDate() };
}
function evNext(m, d, t0) {   // next date >= today on which month/day falls (Feb 29 -> Feb 28 in non-leap years)
  for (let y = t0.getFullYear(); y <= t0.getFullYear() + 1; y++) {
    let dt = new Date(y, m - 1, d); if (dt.getMonth() !== m - 1) dt = new Date(y, m - 1, d - 1);
    if (dt >= t0) return dt;
  }
  return null;
}
function evPrev(m, d, t0) {   // most recent date BEFORE today on which month/day fell
  for (let y = t0.getFullYear(); y >= t0.getFullYear() - 1; y--) {
    let dt = new Date(y, m - 1, d); if (dt.getMonth() !== m - 1) dt = new Date(y, m - 1, d - 1);
    if (dt < t0) return dt;
  }
  return null;
}
const EV_WISH_DAYS = 5;   // you can wish on the day itself and for 5 days after it
function buildFamilyEvents(days = 365) {
  const now = new Date(), t0 = new Date(now.getFullYear(), now.getMonth(), now.getDate()), out = [], seen = new Set();
  const push = e => { const n = Math.round((e.date - t0) / 864e5); if (n < -EV_WISH_DAYS || n > days || (n < 0 && e.type === "custom")) return; out.push({ ...e, daysAway: n }); };
  const occ = (m, d) => [evPrev(m, d, t0), evNext(m, d, t0)].filter(Boolean);   // last few days + the next time
  const gone = p => p.lifeStatus === "deceased" || !!p.details?.dod;
  state.people.forEach(p => {
    const b = evParse(p.dob), dd = evParse(p.details?.dod), marDate = marriageDateOf(p), mar = evParse(marDate);
    if (b && !gone(p)) occ(b.m, b.d).forEach(dt => push({ type: "birth", emoji: "🎂", date: dt, ids: [p.id], kin: kinLine(p), title: `${p.name} ka Birthday`, detail: p.gender === "Female"
      ? `Janm: ${new Date(2000, b.m - 1, b.d).toLocaleDateString("en-IN", { day: "2-digit", month: "short" })}`   // female: birth year and age are hidden
      : `Janm: ${fmtDate(p.dob)}` + (b.y ? ` · ${dt.getFullYear() - b.y} saal ka` : "") }));
    if (dd) occ(dd.m, dd.d).forEach(dt => push({ type: "death", emoji: "🕯", date: dt, ids: [p.id], kin: kinLine(p), title: `${p.name} ki Death Anniversary`, detail: `Dehant: ${fmtDate(p.details.dod)}` + (dd.y ? ` · ${dt.getFullYear() - dd.y} saal pehle` : "") }));
    if (mar) {
      const sp = spousesOf(p.id).map(personById).filter(Boolean)[0], key = sp ? [p.id, sp.id].sort().join("|") : p.id + "|" + marDate;
      if (!seen.has(key)) {   // husband and wife share ONE anniversary event
        seen.add(key);
        const spName = sp?.name || p.details?.marriage?.spouse;
        occ(mar.m, mar.d).forEach(dt => push({ type: "marriage", emoji: "💍", date: dt, ids: [p.id, sp?.id].filter(Boolean), kin: kinLine(p.gender !== "Female" && sp?.gender === "Female" ? sp : p), title: `${p.name}${spName ? " & " + spName : ""} ki Marriage Anniversary`, detail: `Shaadi: ${fmtDate(marDate)}` + (mar.y ? ` · ${dt.getFullYear() - mar.y} saal ki shaadi` : "") }));
      }
    }
  });
  (state.events || []).forEach(e => {   // one-time events saved in the database
    const x = evParse(e.date); if (!x) return;
    push({ type: "custom", emoji: e.emoji || "🎉", date: new Date(x.y, x.m - 1, x.d), ids: [], title: e.title, detail: String(e.type || "Event").replace(/_/g, " ") });
  });
  return out.sort((a, b) => a.date - b.date || a.title.localeCompare(b.title));
}
const evWhen = n => n === 0 ? "Aaj 🎉" : n === 1 ? "Kal" : n === -1 ? "Kal tha" : n < 0 ? `${-n} din pehle` : `${n} din baad`;
const evDateKey = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const evWishKey = e => `ft_wished:${e.type}:${e.ids.join("+")}:${evDateKey(e.date)}`;
function evWishedAlready(key) { try { return localStorage.getItem(key) === "1"; } catch (x) { return false; } }
/* Wish is open on the day itself and for EV_WISH_DAYS days after it. Not for my own birthday / anniversary or for DB "other" events. */
function evCanWish(e) { return e.type !== "custom" && e.daysAway <= 0 && e.daysAway >= -EV_WISH_DAYS && e.ids.length > 0 && !e.ids.some(id => personById(id)?.me); }
function evWishHTML(e) {
  if (!evCanWish(e)) return "";
  const key = evWishKey(e);
  return evWishedAlready(key)
    ? `<span class="ev-wished" data-wk="${esc(key)}">✓ Wish bheji</span>`
    : `<button type="button" class="ev-wish" data-wk="${esc(key)}" onclick="event.stopPropagation();openEventWish('${e.type}','${esc(e.ids.join(","))}','${evDateKey(e.date)}')">🎁 Wish</button>`;
}
function evRowHTML(e) {
  const dt = e.date, mon = dt.toLocaleString("en-IN", { month: "short" }), wd = dt.toLocaleString("en-IN", { weekday: "short" });
  const attr = e.ids.length ? `role="button" tabindex="0" onclick="openProfilePopup('${esc(e.ids[0])}')" onkeydown="if(event.key==='Enter')openProfilePopup('${esc(e.ids[0])}')"` : "";
  return `<div class="ev-row ev-${e.type}${e.daysAway === 0 ? " today" : ""}${e.daysAway < 0 ? " past" : ""}" ${attr}>
    <span class="ev-date"><b>${dt.getDate()}</b><small>${mon}</small></span>
    <span class="ev-main"><strong>${e.emoji} ${esc(e.title)}</strong><span class="muted">${esc(e.detail)} · ${wd}</span>${e.kin ? `<span class="person-kin">${esc(e.kin)}</span>` : ""}</span>
    <span class="ev-side"><span class="ev-when">${evWhen(e.daysAway)}</span>${evWishHTML(e)}</span></div>`;
}
/* Wish = a post on the person's wall (anniversary: on the wife's wall, the husband is tagged). Opens the normal wall composer with a ready message. */
let wishKey = null;
function openEventWish(type, idsCsv, dateKey) {
  const people = idsCsv.split(",").map(personById).filter(Boolean); if (!people.length) return;
  let target = people[0], tags = [];
  if (type === "marriage" && people.length > 1) { target = people.find(x => x.gender === "Female") || people[0]; tags = people.filter(x => x !== target).map(x => x.id); }
  const names = people.map(x => x.name).join(" & ");
  const text = { birth: `🎂 Janmdin ki hardik shubhkamnayein, ${target.name}! Aapka naya saal khushiyon aur achhi sehat se bhara ho. 🎉`,
    marriage: `💍 ${names} ko shaadi ki saalgirah ki bahut bahut badhai! Aap dono hamesha saath aur khush rahein. 💐`,
    death: `🕯 ${target.name} ji ki punyatithi par shraddhanjali. Hum aapko hamesha yaad karte hain. 🙏` }[type] || "";
  const title = { birth: "🎂 Birthday wish", marriage: "💍 Anniversary wish", death: "🕯 Shraddhanjali" }[type] || "Wish";
  wallPersonId = target.id; wallFiles = []; wallTags = tags; wallOpenComments = new Set(); wallComposerOnly = true;
  wishKey = `ft_wished:${type}:${people.map(x => x.id).join("+")}:${dateKey}`;
  profileModalOrigin = "view"; profileModalLocked = false;
  profileModalShell(`<div class="modal-head"><h3>${title}</h3><button type="button" class="ghost" aria-label="Close" onclick="closeEditProfile()">✕</button></div>
    <div class="modal-body">
      ${wallComposerHTML("Wish likho…")}
      <p class="muted" style="font-size:12.5px;margin:0">Ye wish ${esc(target.name)} ki wall par jayegi${tags.length ? " aur " + esc(tags.map(t => personById(t)?.name).join(", ")) + " tag honge" : ""}, aur poori family ke feed me dikhegi. Message badal sakte ho.</p>
    </div>`);
  const t = document.getElementById("wallText"); if (t) t.value = text;
  wallRenderTags();
}
function evMarkWished() {
  if (!wishKey) return;
  const key = wishKey; wishKey = null;
  try { localStorage.setItem(key, "1"); } catch (x) {}
  document.querySelectorAll(".ev-wish").forEach(b => { if (b.dataset.wk === key) { const s = document.createElement("span"); s.className = "ev-wished"; s.textContent = "✓ Wish bheji"; b.replaceWith(s); } });
}
function evPreviewHTML() {
  const list = buildFamilyEvents(60).slice(0, 3);
  return (list.length ? list.map(evRowHTML).join("") : '<p class="muted">Agle 60 din me koi event nahi.</p>') + `<button class="ghost" style="margin-top:8px" onclick="go('events')">Sab events dekho →</button>`;
}
function setEvFilter(f) { evFilter = f; render(); }
function setEvRange(n) { evRange = n; render(); }
function eventsPage() {
  const list = buildFamilyEvents(evRange).filter(e => evFilter === "all" || e.type === evFilter);
  const chips = (arr, cur, fn) => `<div class="ev-chips">${arr.map(([k, l]) => `<button type="button" class="ev-chip${k === cur ? " on" : ""}" onclick="${fn}(${typeof k === "number" ? k : `'${k}'`})">${l}</button>`).join("")}</div>`;
  let lastMonth = "", body = "";
  list.forEach(e => {
    const mk = e.date.toLocaleString("en-IN", { month: "long", year: "numeric" });
    if (mk !== lastMonth) { body += `<h4 class="ev-month">${mk}</h4>`; lastMonth = mk; }
    body += evRowHTML(e);
  });
  return `<div class="page-head"><h2>Events</h2><p class="muted">Family ke birthday, marriage anniversary aur death anniversary, date ke hisaab se.</p></div>
  ${chips(EV_FILTERS, evFilter, "setEvFilter")}${chips(EV_RANGES, evRange, "setEvRange")}
  <div class="card ev-list">${body || '<p class="muted">Is range me koi event nahi. Profile me Date of Birth, Marriage date ya Date of Death bharo to yahan dikhenge.</p>'}</div>`;
}

/* ---------------- V6: family wall ---------------- */
function wall() {
  return `<div class="page-head"><h2>Family Wall</h2><p class="muted">Poori family ki posts ek jagah. Apni wall par likhne ke liye "New post" dabao.</p></div>
  <div class="actions" style="margin-bottom:12px"><button class="primary" onclick="openNewWallPost()">＋ New post</button></div>
  <div class="card"><h3>Aane wale events</h3>${evPreviewHTML()}</div>
  <div class="card" id="feed"><div style="display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:8px"><h3 style="margin:0">Feed</h3><button type="button" class="secondary" onclick="openChatSheet()">💬 Chat<span class="dm-badge" hidden></span></button></div><div id="wallFeed" class="wall-feed"><p class="muted">Loading…</p></div></div>`;
}
function postHTML(p) { return `<div class="post" data-id="${p.id}"><div class="post-head"><div class="avatar">${esc(initials(p.author))}</div><strong>${esc(p.author)}</strong></div><p>${esc(p.text)}</p><div class="actions"><button class="ghost" onclick="likePost(${p.id})">❤️ ${p.likes}</button><button class="ghost">💬 ${p.comments}</button></div></div>`; }
async function publishPost() {
  const t = document.getElementById("postText").value.trim(); if (!t) return;
  if (supabase) { const {error}=await supabase.from('posts').insert({author_profile_id:currentUser.id,tree_id:state.treeId,body:t,post_type:'text',visibility:'family'}); if(error) return toast(error.message); await loadProductionState(currentUser); }
  else state.posts.unshift({ id: crypto.randomUUID(), author: state.account.name, text: t, likes: 0, comments: 0 });
  document.getElementById("postText").value = ""; go("wall");
}
function likePost(id) { const p = state.posts.find(x => x.id === id); if (p) { p.likes++; save(); go("wall"); } }

/* ---------------- Chat: 1-to-1 messages (the old common group chat is gone) ----------------
   Admins/owner are listed with a direct "Chat" button; every other member is found with the search box.
   A message is visible only to the two people in it (RLS in supabase-direct-chat.sql). Group talk happens on the Family Wall (post + comments). */
let dmMessages = [];        // all messages I sent/received in this tree, oldest first
let dmChannel = null;       // Realtime: presence + incoming messages
let dmLocalOnly = false;    // true when direct_messages isn't installed yet / no Supabase (demo)
let chatOnline = new Set(); // profile ids currently on the chat page (presence)
let dmOpenWith = null;      // profile id of the open conversation (null = list)
let dmSearchQ = "";
let dmUnread = 0, dmBadgeAt = 0;

function chatTime(iso) {
  const d = new Date(iso); if (Number.isNaN(d.getTime())) return "";
  const today = new Date().toDateString() === d.toDateString();
  const t = d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
  return today ? t : d.toLocaleDateString("en-IN", { day: "2-digit", month: "short" }) + ", " + t;
}
const dmKey = p => p.claimed_by || p.id;                       // the account id of a person (demo mode: person id)
const dmMine = m => m.sender_id ? (!!currentUser && m.sender_id === currentUser.id) : m.local === true;
const dmIsAdmin = p => p.treeRole === "owner" || p.treeRole === "admin";
const dmPersonByKey = k => state.people.find(p => dmKey(p) === k);
function dmPeople() {   // real people (claimed) of THIS tree that I can message
  return state.people.filter(p => p.status === "claimed" && !p.me && !p.external && !(p.details && p.details.deleted) && (!currentUser || p.claimed_by !== currentUser.id));
}
function dmWith(k) { return dmMessages.filter(m => m.local ? m.recipient_id === k : (m.sender_id === k || m.recipient_id === k)); }
function dmThreads() {  // conversations, newest first
  const by = new Map();
  dmMessages.forEach(m => {
    const other = m.local ? m.recipient_id : (dmMine(m) ? m.recipient_id : m.sender_id);
    const t = by.get(other) || { key: other, last: m, unread: 0, name: "" };
    t.last = m;
    if (!dmMine(m) && !m.read_at) t.unread++;
    if (!dmMine(m) && m.sender_name) t.name = m.sender_name;
    by.set(other, t);
  });
  return [...by.values()].sort((a, b) => String(b.last.created_at).localeCompare(String(a.last.created_at)));
}
function dmRowHTML(p) {
  const k = dmKey(p), on = chatOnline.has(k);
  const role = p.treeRole === "owner" ? "Owner" : p.treeRole === "admin" ? "Admin" : "";
  return `<div class="chat-member dm-row" data-dmkey="${esc(k)}" onclick="dmOpen('${esc(k)}')">
    <span class="chat-member-av">${avatarHTML(p)}<i class="presence ${on ? "on" : ""}"></i></span>
    <span class="chat-member-name">${esc(p.name)}<small class="muted">${role ? role + " · " : ""}<span class="dm-status ${on ? "online-txt" : "muted"}">${on ? "Online" : "Offline"}</span></small></span>
    <button type="button" class="secondary dm-btn" onclick="event.stopPropagation();dmOpen('${esc(k)}')">💬 Chat</button></div>`;
}
function dmRecentHTML(t) {
  const p = dmPersonByKey(t.key), name = p ? p.name : (t.name || "Family Member"), on = chatOnline.has(t.key);
  const prev = (dmMine(t.last) ? "Aap: " : "") + String(t.last.body).replace(/\s+/g, " ").slice(0, 42);
  return `<div class="chat-member dm-row" data-dmkey="${esc(t.key)}" onclick="dmOpen('${esc(t.key)}')">
    <span class="chat-member-av">${p ? avatarHTML(p) : `<div class="avatar">${esc(initials(name))}</div>`}<i class="presence ${on ? "on" : ""}"></i></span>
    <span class="chat-member-name">${esc(name)}<small class="muted">${esc(prev)}</small></span>
    <span class="muted" style="font-size:11px;white-space:nowrap">${esc(chatTime(t.last.created_at))}</span>${t.unread ? `<span class="dm-unread">${t.unread}</span>` : ""}</div>`;
}
function dmSearchResultsHTML() {
  const q = dmSearchQ.trim().toLowerCase();
  if (!q) return `<p class="muted" style="font-size:13px;margin:6px 0 0">Member ka naam likhkar search karo, phir 💬 Chat dabao.</p>`;
  const hits = dmPeople().filter(p => [p.name, p.nickname, p.personCode].some(v => (v || "").toString().toLowerCase().includes(q))).slice(0, 20);
  return hits.length ? hits.map(dmRowHTML).join("") : `<p class="muted" style="font-size:13px;margin:6px 0 0">Koi member nahi mila. Sirf wahi log milenge jinhone apna profile claim kiya hai.</p>`;
}
function dmListHTML() {
  const admins = dmPeople().filter(dmIsAdmin).sort((a, b) => (b.treeRole === "owner") - (a.treeRole === "owner") || (a.name || "").localeCompare(b.name || ""));
  const recent = dmThreads();
  return `<p class="muted" style="margin:0 0 12px">Kisi ek member se seedha baat karo. Poore parivaar ko kuch batana ho to Family Wall par post karo; sabko feed me dikhega aur baat comments me ho jayegi.</p>
  ${recent.length ? `<div class="card"><h3>Recent chats</h3>${recent.map(dmRecentHTML).join("")}</div>` : ""}
  ${admins.length ? `<div class="card"><h3>Admins</h3>${admins.map(dmRowHTML).join("")}</div>` : ""}
  <div class="card"><h3>Members</h3>
    <div style="display:flex;gap:8px"><input id="dmSearch" type="search" value="${esc(dmSearchQ)}" placeholder="🔍 Member ka naam search karo" autocomplete="off" style="flex:1" oninput="dmSearchInput(this.value)" onkeydown="if(event.key==='Enter'){event.preventDefault();dmSearchInput(this.value)}"><button type="button" class="secondary" aria-label="Search" onclick="dmSearchInput(document.getElementById('dmSearch').value)">🔍</button></div>
    <div id="dmSearchResults" style="margin-top:6px">${dmSearchResultsHTML()}</div></div>`;
}
function dmThreadHTML() {
  const p = dmPersonByKey(dmOpenWith), on = chatOnline.has(dmOpenWith);
  const name = p ? p.name : (dmThreads().find(t => t.key === dmOpenWith)?.name || "Family Member");
  return `<div class="card chat-card dm-thread">
    <div class="dm-head" data-dmkey="${esc(dmOpenWith)}"><button type="button" class="ghost" onclick="dmBack()" aria-label="Back to chats">←</button>
      <span class="chat-member-av">${p ? avatarHTML(p) : `<div class="avatar">${esc(initials(name))}</div>`}<i class="presence ${on ? "on" : ""}"></i></span>
      <span class="chat-member-name" style="flex:1;${p ? "cursor:pointer" : ""}" ${p ? `onclick="openProfilePopup('${esc(p.id)}')"` : ""}>${esc(name)}<small class="muted"><span class="dm-status ${on ? "online-txt" : "muted"}">${on ? "Online" : "Offline"}</span></small></span></div>
    <div class="chat-room" id="chatBox"><p class="muted" style="text-align:center">Loading…</p></div>
    <div class="chat-compose">
      <textarea id="chatInput" rows="1" placeholder="${esc(name)} ko message likhiye…" maxlength="2000" onkeydown="chatKey(event)" oninput="this.style.height='auto';this.style.height=Math.min(this.scrollHeight,120)+'px'"></textarea>
      <button class="primary" onclick="sendChat()">Send ➤</button>
    </div>
    <div id="chatNote" class="muted" style="font-size:12px;margin-top:6px"></div>
  </div>`;
}
function dmRootHTML() {
  if (isPendingJoiner()) return `<div class="card"><p class="muted">Join request approve hone ke baad aap chat kar paoge.</p></div>`;
  return dmOpenWith ? dmThreadHTML() : dmListHTML();
}
function openChatSheet() {
  if (document.getElementById("chatSheet")) return;
  const ov = document.createElement("div"); ov.id = "chatSheet"; ov.className = "modal-overlay";
  ov.setAttribute("role", "dialog"); ov.setAttribute("aria-label", "Chat");
  ov.addEventListener("click", e => { if (e.target === ov) closeChatSheet(); });
  ov.innerHTML = `<div class="chat-sheet-card"><div class="chat-sheet-top"><strong>💬 Chat</strong><button type="button" class="iconbtn" aria-label="Close chat" onclick="closeChatSheet()">✕</button></div><div class="chat-sheet-body"><div id="dmRoot">${dmRootHTML()}</div></div></div>`;
  document.body.appendChild(ov);
  initChat();
}
function closeChatSheet() { document.getElementById("chatSheet")?.remove(); teardownChat(); refreshDmBadge(true); }
function refreshDmRoot() {
  const root = document.getElementById("dmRoot"); if (!root) return;
  root.innerHTML = dmRootHTML();
  if (dmOpenWith) renderChatMessages(true);
}
function dmSetNote(t) { const n = document.getElementById("chatNote"); if (n) n.textContent = t || ""; }
function dmBubbleHTML(m) {
  return `<div class="chat-msg ${dmMine(m) ? "mine" : "theirs"}"><div class="chat-bubble"><div class="chat-text">${esc(m.body)}</div><div class="chat-time">${esc(chatTime(m.created_at))}</div></div></div>`;
}
function renderChatMessages(stick = true) {
  const box = document.getElementById("chatBox"); if (!box || !dmOpenWith) return;
  const nearBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 80;
  const list = dmWith(dmOpenWith);
  box.innerHTML = list.length ? list.map(dmBubbleHTML).join("") : `<div class="empty"><span class="big">💬</span><p class="muted">Abhi koi message nahi. Pehla message bhejiye!</p></div>`;
  if (stick || nearBottom) box.scrollTop = box.scrollHeight;
}
function dmSearchInput(v) {
  dmSearchQ = v || "";
  const r = document.getElementById("dmSearchResults"); if (r) r.innerHTML = dmSearchResultsHTML();
}
async function dmOpen(k) {
  if (isPendingJoiner()) { toast("Join request approve hone ke baad aap chat kar paoge"); return; }
  dmOpenWith = k;
  refreshDmRoot();
  requestAnimationFrame(() => document.getElementById("chatInput")?.focus());
  await dmMarkRead(k);
}
function dmBack() { dmOpenWith = null; dmSearchQ = ""; refreshDmRoot(); }
async function dmMarkRead(k) {
  let any = false;
  dmMessages.forEach(m => { if (!m.local && m.sender_id === k && !m.read_at) { m.read_at = new Date().toISOString(); any = true; } });
  if (!any || !supabase || dmLocalOnly) return;
  try { await supabase.rpc("mark_dm_read", { p_tree: state.treeId, p_other: k }); } catch (e) {}
  refreshDmBadge(true);
}
function dmPresenceRefresh() {   // update the dots in place so a search box being typed in is never re-rendered
  document.querySelectorAll("[data-dmkey]").forEach(el => {
    const on = chatOnline.has(el.dataset.dmkey);
    el.querySelector(".presence")?.classList.toggle("on", on);
    const st = el.querySelector(".dm-status"); if (st) { st.textContent = on ? "Online" : "Offline"; st.className = "dm-status " + (on ? "online-txt" : "muted"); }
  });
}
function dmIncoming(m) {
  if (!m || m.tree_id !== state.treeId || dmMessages.some(x => x.id === m.id)) return;
  dmMessages.push(m);
  if (dmOpenWith === m.sender_id) { renderChatMessages(false); dmMarkRead(m.sender_id); return; }
  const p = dmPersonByKey(m.sender_id);
  toast(`💬 ${(p && p.name) || m.sender_name || "Family Member"}: ${String(m.body).slice(0, 40)}`);
  if (!dmOpenWith) { const q = document.getElementById("dmSearch"); if (!q || document.activeElement !== q) refreshDmRoot(); }
}
async function initChat() {
  chatOnline = new Set();
  if (!supabase || !currentUser || !state.treeId) {
    dmLocalOnly = true; refreshDmRoot(); dmSetNote("Demo mode: messages sirf is session mein dikhenge."); return;
  }
  if (isPendingJoiner()) return;
  const { data, error } = await supabase.from("direct_messages").select("*").eq("tree_id", state.treeId).order("created_at", { ascending: false }).limit(500);
  if (error) {
    dmLocalOnly = true; dmMessages = dmMessages.filter(m => m.local); refreshDmRoot();
    dmSetNote(/direct_messages|relation|schema cache/i.test(error.message) ? "Chat shuru karne ke liye Supabase mein supabase-direct-chat.sql run kijiye." : error.message);
    return;
  }
  dmLocalOnly = false;
  dmMessages = (data || []).reverse();
  refreshDmRoot();
  if (dmOpenWith) dmMarkRead(dmOpenWith);
  teardownChat(true);
  chatOnline = new Set([currentUser.id]); dmPresenceRefresh();
  dmChannel = supabase.channel("dm-" + state.treeId, { config: { presence: { key: currentUser.id } } })
    .on("presence", { event: "sync" }, () => { chatOnline = new Set(Object.keys(dmChannel.presenceState())); dmPresenceRefresh(); })
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "direct_messages", filter: "recipient_id=eq." + currentUser.id }, payload => dmIncoming(payload.new))
    .subscribe(status => { if (status === "SUBSCRIBED") dmChannel.track({ name: state.account.name || "", at: new Date().toISOString() }); });
}
function teardownChat(keepMessages) {
  if (dmChannel && supabase) { try { dmChannel.untrack(); } catch (e) {} supabase.removeChannel(dmChannel); dmChannel = null; }
  if (!keepMessages) { chatOnline = new Set(); dmOpenWith = null; dmSearchQ = ""; }
}
function chatKey(e) { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendChat(); } }
async function sendChat() {
  const box = document.getElementById("chatInput"); if (!box || !dmOpenWith) return;
  const body = box.value.trim(); if (!body) return;
  if (body.length > 2000) return toast("Message bahut lamba hai (max 2000)");
  const name = state.account.name || "Family Member";
  if (!dmLocalOnly && supabase && currentUser && state.treeId) {
    box.disabled = true;
    const { data, error } = await supabase.from("direct_messages").insert({ tree_id: state.treeId, sender_id: currentUser.id, recipient_id: dmOpenWith, sender_name: name, body }).select().single();
    box.disabled = false;
    if (error) { toast(error.message); box.focus(); return; }
    if (!dmMessages.some(m => m.id === data.id)) dmMessages.push(data);
  } else {
    dmMessages.push({ id: crypto.randomUUID(), local: true, recipient_id: dmOpenWith, sender_name: name, body, created_at: new Date().toISOString() });
  }
  box.value = ""; box.style.height = "auto"; renderChatMessages(true); box.focus();
}
/* Unread badge on the Chat button (Wall header) and a dot on the Wall tab. Fetched at most every 20s; it updates when you move between pages. */
function dmPaintBadge() {
  document.querySelectorAll(".dm-badge").forEach(el => { if (!el.classList.contains("dm-dot")) el.textContent = dmUnread > 99 ? "99+" : String(dmUnread); el.hidden = !dmUnread; });
}
async function refreshDmBadge(force) {
  dmPaintBadge();
  if (!supabase || !currentUser || !state.treeId || isPendingJoiner() || dmLocalOnly) return;
  if (!force && Date.now() - dmBadgeAt < 20000) return;
  dmBadgeAt = Date.now();
  try { const r = await supabase.rpc("dm_unread_count", { p_tree: state.treeId }); if (!r.error) { dmUnread = Number(r.data) || 0; dmPaintBadge(); } } catch (e) {}
}


/* ---------------- V9: connections & sharing ---------------- */
function sharing() {
  const myId = me().personCode || me().id;
  return `<div class="page-head"><h2>Connections &amp; Sharing</h2><p class="muted">Share your profile and manage connections.</p></div>
  <div class="card"><h3>Share My Person Profile</h3>
    <div class="card" style="text-align:center;background:var(--plum-tint);border:none;font-family:var(--font-display);font-size:22px;font-weight:600;letter-spacing:.06em;color:var(--plum-deep)">${myId}</div>
    <p class="muted" style="margin-top:10px">Unique Person ID — safe to share. Private contact information is not shown.</p>
    <div class="actions"><button class="primary" onclick="shareId('${myId}')">Share ID</button><button class="secondary" onclick="toast('Demo: QR code generated')">▦ QR Code</button><button class="secondary" onclick="toast('Demo: invite link copied')">🔗 Invite Link</button></div>
  </div>
  <div class="card"><h3>Invite Relative</h3>
    <div class="field"><label>Mobile number or email</label><input id="inviteContact" placeholder="e.g. 98XXXXXXXX"></div>
    <div class="field"><label>Scope</label><select id="inviteScope"><option>Person profile</option><option>Family tree</option></select></div>
    <button class="primary" style="justify-self:start" onclick="invite()">Send Invite</button>
  </div>
  ${(state.incomingJoins || []).length ? `<div class="card"><h3>🙋 Tree join requests</h3>${state.incomingJoins.map(r => `<div class="row"><span><b>${esc(r.requester_name)}</b> tree join karna chahta hai${r.person_name ? ` (profile: <b>${esc(r.person_name)}</b>)` : ""}.<br><span class="muted" style="font-size:12.5px">Ab tak ${esc(r.added_profiles)} naye profile add kiye. Approve karne par wo purane profiles bhi edit kar sakega. Reject karne par uske add kiye sab profiles hat jayenge.</span></span>
      <span style="display:flex;gap:8px"><button class="primary" onclick="approveJoin('${esc(r.request_id)}')">Approve</button><button class="danger" onclick="rejectJoin('${esc(r.request_id)}', ${Number(r.added_profiles) || 0})">Reject</button></span></div>`).join("")}</div>` : ""}
  ${(state.incomingClaims || []).length ? `<div class="card"><h3>Profile claim requests</h3>${state.incomingClaims.map(r => `<div class="row"><span><b>${esc(r.requester_name || "Someone")}</b> says the profile <b>${esc(r.person_name)}</b> is them.<br><span class="muted" style="font-size:12.5px">Any tree admin can approve. Approve only if you know this person. They will get control of that profile.</span></span>
      <span style="display:flex;gap:8px"><button class="primary" onclick="approveClaim('${esc(r.request_id)}')">Approve</button><button class="ghost" onclick="rejectClaim('${esc(r.request_id)}')">Decline</button></span></div>`).join("")}</div>` : ""}
  ${(state.incoming || []).length ? `<div class="card"><h3>Connection requests for you</h3>${state.incoming.map(r => {
    const rl = RELATION_TYPES[r.relation_type]?.label;
    return `<div class="row"><span><b>${esc(r.requester_name || "A family member")}</b> wants to add you${rl && r.target_name ? ` as <b>${esc(rl)}</b> of <b>${esc(r.target_name)}</b>` : ""} in their family tree<br><span class="muted" style="font-size:12.5px">${esc(r.tree_name || "")}</span></span>
      <span style="display:flex;gap:8px"><button class="primary" onclick="approveIncoming('${esc(r.request_id)}')">Accept</button><button class="ghost" onclick="rejectIncoming('${esc(r.request_id)}')">Decline</button></span></div>`;
  }).join("")}</div>` : ""}
  <div class="card"><h3>Connections</h3>${state.connections.map((c, i) => `<div class="row"><span><b>${esc(c.name)}</b><br><span class="muted" style="font-size:12.5px">${c.relation}</span></span>${c.status === "connected" ? '<span class="muted">Connected</span>' : `<button class="secondary" onclick="acceptConnection(${i})">Accept</button>`}</div>`).join("") || "<p class='muted'>No connections yet.</p>"}</div>
  <div class="card"><h3>Privacy rule</h3><p>🔒 A social connection does not automatically grant access to a private family tree. Access follows the tree's permissions.</p></div>`;
}
function shareId(id) { navigator.clipboard?.writeText(id).catch(() => {}); toast("Person ID copied: " + id); }
function invite() { const x = document.getElementById("inviteContact").value.trim(); if (!x) { toast("Enter mobile or email"); return; } toast("Invite sent to " + x); }
async function approveIncoming(requestId) {
  if (!supabase || !currentUser) return;
  const { error } = await supabase.rpc("approve_connection", { p_request_id: requestId });
  if (error) { toast(error.message); return; }
  toast("Accepted — you're now linked in their family tree");
  try { await loadProductionState(currentUser); } catch (e) { console.error(e); }
  render();
}
async function rejectIncoming(requestId) {
  if (!supabase || !currentUser) return;
  const { error } = await supabase.rpc("reject_connection", { p_request_id: requestId });
  if (error) { toast(error.message); return; }
  toast("Request declined");
  try { await loadProductionState(currentUser); } catch (e) { console.error(e); }
  render();
}
function acceptConnection(i) { state.connections[i].status = "connected"; save(); go("sharing"); }

/* ---------------- V11 Support: tickets ---------------- */
/* ---------------- support desk: tickets + their messages ---------------- */
const TICKET_STATUS = { open: "Open", in_progress: "In Progress", resolved: "Resolved", closed: "Closed" };
const cap = s => String(s || "").charAt(0).toUpperCase() + String(s || "").slice(1);
async function loadSupportTickets(user) {
  state.ticketsError = null;
  const { data: tickets, error } = await supabase.from("support_tickets").select("*").order("created_at", { ascending: false }).limit(100);
  if (error) { console.warn("support_tickets", error); state.tickets = []; state.ticketsError = error.message; return; }
  const ids = (tickets || []).map(t => t.id);
  let msgs = [];
  if (ids.length) {
    const r = await supabase.from("support_messages").select("*").in("ticket_id", ids).order("created_at", { ascending: true });
    if (r.error) { console.warn("support_messages", r.error); state.ticketsError = r.error.message; } else msgs = r.data || [];
  }
  const names = {};
  try { // staff may not be allowed to read other profiles; then we simply show "User"
    const reqIds = [...new Set((tickets || []).map(t => t.requester_profile_id))];
    if (reqIds.length) { const r = await supabase.from("profiles").select("id,display_name,email").in("id", reqIds); (r.data || []).forEach(p => { names[p.id] = p.display_name || p.email; }); }
  } catch (e) {}
  state.tickets = (tickets || []).map(t => {
    const ms = msgs.filter(m => m.ticket_id === t.id).map(m => ({ from: m.sender_profile_id === t.requester_profile_id ? "user" : "staff", text: m.message, at: m.created_at }));
    if (!ms.length && t.description) ms.push({ from: "user", text: t.description, at: t.created_at });
    const last = ms[ms.length - 1];
    return { id: t.ticket_code, uuid: t.id, subject: t.subject, category: t.category, priority: cap(t.priority || "medium"), status: TICKET_STATUS[t.status] || cap(String(t.status).replace("_", " ")),
      rawStatus: t.status, requester: names[t.requester_profile_id] || "User", assignedToMe: t.assigned_to === user.id, assigned: !!t.assigned_to, created_at: t.created_at,
      messages: ms, needsReply: !!last && last.from === "user" && !["resolved", "closed"].includes(t.status) };
  });
}
let supportPoll = null;
function startSupportPoll() { // staff: look for new tickets/messages every 60s while on the Support page
  if (supportPoll) return;
  supportPoll = setInterval(async () => {
    if (!currentUser || !supabase) return;
    if ((location.hash || "").replace("#", "") !== "support") return;
    const before = state.tickets.filter(t => t.needsReply).length;
    await loadSupportTickets(currentUser);
    const after = state.tickets.filter(t => t.needsReply).length;
    if (after > before) toast("Naya support message aaya hai");
    if (!document.activeElement || document.activeElement.id !== "reply") render();
  }, 60000);
}
async function refreshSupport() { await loadSupportTickets(currentUser); toast("Support list refresh ho gayi"); render(); }

function ticketThreadCard(active, staffView) {
  if (!active) return "";
  const fmt = d => { try { return new Date(d).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }); } catch (e) { return ""; } };
  const closed = ["Resolved", "Closed"].includes(active.status);
  return `<div class="card"><h3 id="ticketTitle">Ticket ${esc(active.id)} — ${esc(active.subject)}</h3>
  <p class="muted" style="margin:0 0 8px">${staffView ? `<b>${esc(active.requester)}</b> · ` : ""}${esc(active.category)} · ${esc(active.priority)} · <span class="badge plum">${esc(active.status)}</span>${active.assigned ? (active.assignedToMe ? " · assigned to you" : " · assigned") : ""}</p>
  <div class="chat" id="chat">${active.messages.map(m => `<div class="msg ${m.from}">${esc(m.text)}<br><small class="muted">${m.from === "user" ? (staffView ? esc(active.requester) : "You") : "Support"} · ${esc(fmt(m.at))}</small></div>`).join("")}</div>
  ${closed && !staffView ? `<p class="muted" style="margin-top:10px">Ye ticket resolved hai. Naya message likhne par wo dobara open ho jayega.</p>` : ""}
  <textarea id="reply" placeholder="${staffView ? "Write a reply..." : "Apna message likhein..."}" style="margin-top:10px"></textarea>
  <div class="actions" style="margin-top:8px">
    <button class="primary" onclick="sendReply()">${staffView ? "Send Reply" : "Send"}</button>
    ${staffView ? `<button class="secondary" onclick="assignTicket()">Assign to me</button><button class="danger" onclick="resolveTicket()">Resolve</button>` : ""}
  </div></div>`;
}
function support() {
  if (isStaff()) return supportDashboard();
  const mine = state.tickets;
  const active = mine.find(x => x.id === activeTicketId);
  return `<div class="page-head"><h2>Support</h2><p class="muted">Get help from the FamilyTree support team.</p></div>
  ${state.ticketsError ? `<div class="card" style="border-left:4px solid #c0392b"><b>Tickets load nahi hue:</b> ${esc(state.ticketsError)}<br><span class="muted">Admin ko batayein ki supabase-support.sql run karni hai.</span></div>` : ""}
  <div class="card"><h3>My Tickets</h3>${mine.length ? mine.map(t => `<div class="row"><span><b>${esc(t.id)}</b> · ${esc(t.category)}<br><small class="muted">${esc(t.subject)}</small></span><span class="badge ${t.priority === "Urgent" ? "terracotta" : t.priority === "High" ? "" : "plum"}">${esc(t.status)}</span><button class="secondary" onclick="openTicket('${esc(t.id)}')">${t.messages.some(m => m.from === "staff") ? "💬 View reply" : "View"}</button></div>`).join("") : `<p class="muted">Abhi koi ticket nahi.</p>`}</div>
  ${ticketThreadCard(active, false)}
  <div class="card"><h3>Create Ticket</h3>
    <div class="field"><label>Subject</label><input id="tSubject" placeholder="Briefly describe the issue"></div>
    <div class="field"><label>Category</label><select id="tCategory"><option>Login / OTP</option><option>Family Tree</option><option>Profile Claim</option><option>Duplicate / Merge</option><option>Reels / Media</option><option>Family Wall</option><option>Account</option><option>Other</option></select></div>
    <div class="field"><label>Priority</label><select id="tPriority"><option>Medium</option><option>Low</option><option>High</option><option>Urgent</option></select></div>
    <div class="field"><label>Description</label><textarea id="tDesc" placeholder="Describe your issue..."></textarea></div>
    <button class="primary" style="justify-self:start" onclick="createTicket()">Create Ticket</button>
  </div>`;
}
async function createTicket() {
  const subject = document.getElementById("tSubject").value.trim();
  if (!subject) { toast("Enter a subject"); return; }
  const code = "FT-" + Date.now().toString().slice(-7);
  const categoryMap={'Login / OTP':'login_otp','Family Tree':'family_tree','Profile Claim':'profile_claim','Duplicate / Merge':'duplicate_merge','Reels / Media':'reels_media','Family Wall':'family_wall','Account':'account','Other':'other'};
  if(supabase){ const {data,error}=await supabase.from('support_tickets').insert({ticket_code:code,requester_profile_id:currentUser.id,category:categoryMap[document.getElementById('tCategory').value]||'other',priority:document.getElementById('tPriority').value.toLowerCase(),subject,description:document.getElementById('tDesc').value||subject}).select().single(); if(error) return toast(error.message); await supabase.from('support_messages').insert({ticket_id:data.id,sender_profile_id:currentUser.id,message:document.getElementById('tDesc').value||subject}); await loadProductionState(currentUser); }
  else state.tickets.unshift({ id: code, subject, category: document.getElementById("tCategory").value, priority: document.getElementById("tPriority").value, status: "Open", messages: [{ from: "user", text: document.getElementById("tDesc").value || subject }] });
  toast("Ticket created — " + code); go("support");
}
/* V11 support dashboard (staff view) */
function supportDashboard() {
  const t = [...state.tickets].sort((a, b) => Number(b.needsReply) - Number(a.needsReply));
  const open = x => !["Resolved", "Closed"].includes(x.status);
  const counts = { reply: t.filter(x => x.needsReply).length, progress: t.filter(x => x.status === "In Progress").length, urgent: t.filter(x => x.priority === "Urgent" && open(x)).length, resolved: t.filter(x => x.status === "Resolved").length };
  const active = t.find(x => x.id === activeTicketId) || t[0];
  activeTicketId = active?.id;
  return `<div class="page-head" style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;align-items:center"><div><h2>🎧 Support Center</h2><p class="muted">Support staff are not family members — access is limited to what's needed to resolve each ticket.</p></div><button class="secondary" onclick="refreshSupport()">🔄 Refresh</button></div>
  ${state.ticketsError ? `<div class="card" style="border-left:4px solid #c0392b"><b>Tickets load nahi hue:</b> ${esc(state.ticketsError)}<br><span class="muted">Supabase mein supabase-support.sql run karein.</span></div>` : ""}
  <div class="grid g4">
    <div class="card stat-card"><div class="muted">Waiting for reply</div><div class="stat" style="color:var(--terracotta)">${counts.reply}</div></div>
    <div class="card stat-card"><div class="muted">In Progress</div><div class="stat warn">${counts.progress}</div></div>
    <div class="card stat-card"><div class="muted">Urgent (open)</div><div class="stat" style="color:var(--terracotta)">${counts.urgent}</div></div>
    <div class="card stat-card"><div class="muted">Resolved</div><div class="stat ok">${counts.resolved}</div></div>
  </div>
  <div class="card"><h3>Support Queue</h3>${t.length ? t.map(x => `<div class="row" ${x.id === active?.id ? 'style="background:var(--plum-tint,#f6f0fa)"' : ""}><span>${x.needsReply ? "🔔 " : ""}<b>${esc(x.id)}</b> · ${esc(x.requester)} · ${esc(x.category)}<br><small class="muted">${esc(x.subject)} · ${esc(x.status)}</small></span><span class="badge ${x.priority === "Urgent" ? "terracotta" : "plum"}">${esc(x.priority)}</span><button class="secondary" onclick="openTicket('${esc(x.id)}')">Open</button></div>`).join("") : `<p class="muted">Koi ticket nahi hai.</p>`}</div>
  ${ticketThreadCard(active, true)}`;
}
function openTicket(id) { activeTicketId = id; go("support"); }
function ticketUuid() { return (state.tickets.find(x => x.id === activeTicketId) || {}).uuid; }
async function sendReply() {
  const box = document.getElementById("reply"); const val = box.value.trim(); if (!val) return;
  const uuid = ticketUuid(); if (!uuid) return;
  const { error } = await supabase.from("support_messages").insert({ ticket_id: uuid, sender_profile_id: currentUser.id, message: val });
  if (error) return toast(error.message);
  if (isStaff()) await supabase.from("support_ticket_events").insert({ ticket_id: uuid, actor_profile_id: currentUser.id, event_type: "staff_reply", metadata: {} });
  await loadSupportTickets(currentUser); toast(isStaff() ? "Reply bhej diya" : "Message bhej diya"); go("support");
}
async function assignTicket() {
  const uuid = ticketUuid(); if (!uuid) return;
  const { error } = await supabase.from("support_tickets").update({ assigned_to: currentUser.id }).eq("id", uuid);
  if (error) return toast(error.message);
  await supabase.from("support_ticket_events").insert({ ticket_id: uuid, actor_profile_id: currentUser.id, event_type: "assigned", metadata: {} });
  await loadSupportTickets(currentUser); toast("Ticket aapko assign ho gaya"); go("support");
}
async function resolveTicket() {
  const uuid = ticketUuid(); if (!uuid) return;
  const { error } = await supabase.from("support_tickets").update({ status: "resolved", resolved_at: new Date().toISOString() }).eq("id", uuid);
  if (error) return toast(error.message);
  await supabase.from("support_ticket_events").insert({ ticket_id: uuid, actor_profile_id: currentUser.id, event_type: "resolved", metadata: {} });
  await loadSupportTickets(currentUser); toast("Ticket marked resolved"); go("support");
}

/* ---------------- V10: admin & safety ---------------- */
function admin() {
  return `<div class="page-head"><h2>🛡️ Admin &amp; Safety</h2><p class="muted">Management area. Admin privileges are separate from family-tree membership.</p></div>
  <div class="grid">
    <div class="card stat-card"><div class="muted">Users</div><div class="stat">${1284}</div></div>
    <div class="card stat-card"><div class="muted">Merge Requests</div><div class="stat">${state.mergeRequests.length}</div></div>
    <div class="card stat-card"><div class="muted">Connections</div><div class="stat">${state.connections.length}</div></div>
  </div>
  <div class="card"><h3>Moderation Queue</h3>
    <div class="row"><span><b>Reported Profile</b><br><span class="muted" style="font-size:12.5px">Reason: duplicate/spam</span></span><button class="secondary" onclick="reviewItem(this)">Review</button></div>
    <div class="row"><span><b>Family Post</b><br><span class="muted" style="font-size:12.5px">Reason: reported by 2 users</span></span><button class="secondary" onclick="reviewItem(this)">Review</button></div>
  </div>
  <div class="card"><h3>Administrators</h3>
    <div class="row"><span>Super Admin</span><span class="badge plum">Full system</span></div>
    <div class="row"><span>Admin</span><span class="badge plum">Management</span></div>
    <div class="row"><span>Moderator</span><span class="badge plum">Content only</span></div>
  </div>
  <div class="card"><h3>Security Audit</h3>${state.audit.map(a => `<div class="row"><span>${esc(a.text)}</span><span class="muted" style="font-size:12.5px">${a.time}</span></div>`).join("")}</div>`;
}
function reviewItem(btn) { btn.textContent = "Reviewed"; btn.disabled = true; }

/* ---------------- Tree Admins — per-tree admin roles ---------------- */
/* An "admin" here can add/edit relatives inside THIS family tree only —
   separate from state.account.role (system-wide staff/admin). The owner
   (whoever created the tree) is the only one who can promote/demote. */
function treeAdmins() {
  const iAmOwner = isTreeOwner();
  const owners = iAmOwner ? state.people.filter(p => personTreeRole(p) === "owner") : []; // the owner is shown to the owner only, never to admins/members
  const admins = state.people.filter(p => personTreeRole(p) === "admin");
  const members = state.people.filter(p => personTreeRole(p) === "member");
  const rowFor = p => {
    const role = personTreeRole(p);
    const canManage = canManageAdmins() && role !== "owner";
    return `<div class="row">
      <span style="display:flex;align-items:center;gap:10px">${avatarHTML(p)}<span>${esc(p.name)}${p.me ? " <span class='muted' style='font-size:12px'>(You)</span>" : ""}</span></span>
      <span style="display:flex;align-items:center;gap:8px">
        <span class="badge ${treeRoleBadgeClass(role)}">${treeRoleLabel(role)}</span>
        ${canManage ? (role === "admin"
          ? `<button class="ghost" onclick="setTreeRole('${p.id}','member')">Remove Admin</button>`
          : (p.claimed_by || p.status === "claimed"
              ? `<button class="secondary" onclick="setTreeRole('${p.id}','admin')">Make Admin</button>`
              : `<span class="muted" style="font-size:12px">Not claimed yet</span>`)) : ""}
      </span>
    </div>`;
  };
  return `<div class="page-head"><h2>👑 Tree Admins</h2><p class="muted">People who can add and edit relatives in <b>${esc(me()?.name || "your")}'s</b> family tree. Anyone who claims a profile becomes an admin automatically, and stays admin until another admin removes them.</p></div>
  ${!canManageAdmins() ? `<div class="card" style="margin-bottom:14px"><span class="muted">Only tree admins can add or remove admins. You can view the list below.</span></div>` : ""}
  ${iAmOwner ? `<div class="card"><h3>Owner</h3>${owners.length ? owners.map(rowFor).join("") : "<p class='muted'>No owner set.</p>"}</div>` : ""}
  <div class="card"><h3>Admins <span class="muted" style="font-size:12.5px;font-weight:400">— can add &amp; edit relatives in this tree</span></h3>
    ${admins.length ? admins.map(rowFor).join("") : "<p class='muted'>No admins yet. Anyone who claims a profile becomes one, or promote a claimed member below.</p>"}
  </div>
  <div class="card"><h3>Members</h3>
    ${members.length ? members.map(rowFor).join("") : "<p class='muted'>No other members yet.</p>"}
  </div>`;
}
async function setTreeRole(personId, role) {
  if (!canManageAdmins()) { toast("Only a tree owner or admin can change admin roles"); return; }
  const p = personById(personId);
  if (!p) return;
  if (personTreeRole(p) === "owner") { toast("Can't change the owner's role"); return; }
  if (role === "admin" && !(p.claimed_by || p.status === "claimed")) { toast("Only a claimed profile (a person with an account) can be made admin"); return; }
  if (role === "member" && !confirm(p.me ? "Aap khud ko admin se hata rahe hain. Profile aapki hi rahegi, par aap add/edit nahi kar paoge. Continue?" : `${p.name} ko admin se hatayein? Unki profile claimed hi rahegi.`)) return;
  if (supabase && currentUser) {
    // The database decides: caller must be owner/admin, target must be claimed, owner can't be touched.
    const { error } = await supabase.rpc("set_tree_admin", { p_tree_id: state.joined ? state.joined.treeId : state.treeId, p_person_id: p.id, p_make_admin: role === "admin" });
    if (error) { toast(/set_tree_admin|function|schema cache/i.test(error.message) ? "Run supabase-admin-claim.sql in Supabase first" : error.message); return; }
  }
  p.treeRole = role; p.savedRole = role;
  toast(role === "admin" ? `${p.name} is now an admin of this tree` : `${p.name} is no longer an admin`);
  go("treeAdmins");
}

/* ---------------- Transfer my claimed profile to another account ---------------- */
/* Single-use code, valid 48h, stored hashed in the database. The receiver redeems it on their first-login screen.
   After the transfer the receiver owns the profile (and is admin); the sender stays admin with a fresh empty card. The tree owner's profile can't be transferred. */
async function openTransferProfile(id) {
  const p = personById(id);
  if (!p || !p.me) { toast("You can only transfer your own profile"); return; }
  if (personTreeRole(p) === "owner") { toast("Tree owner ka profile transfer nahi ho sakta"); return; }
  if (!supabase || !currentUser) { toast("Please sign in"); return; }
  if (!confirm("Ye profile kisi doosre account ko transfer karein?\n\nTransfer hone par wo person is profile ka owner (aur admin) ban jayega, aur aap is tree mein admin bane rahoge (aapko ek naya khaali card milega). Jab tak koi doosra admin aapko na hataye, admin rahoge.\n\nPehle ek code banega jo aap us person ko doge.")) return;
  const { data, error } = await supabase.rpc("create_profile_transfer", { p_person_id: p.id });
  if (error) { toast(/create_profile_transfer|function|schema cache/i.test(error.message) ? "Run supabase-admin-claim.sql in Supabase first" : error.message); return; }
  document.getElementById("transferModal")?.remove();
  const ov = document.createElement("div"); ov.className = "modal-overlay"; ov.id = "transferModal";
  ov.innerHTML = `<div class="modal-card"><div class="modal-head"><h3>🔁 Transfer code</h3><button class="ghost" onclick="closeTransferModal()">✕</button></div>
    <div class="modal-body">
      <p class="muted" style="margin:0">Ye code us person ko bhejiye jo ye profile lega. Wo naye account se login karke <b>"Transfer code hai"</b> mein daalega. Code 48 ghante tak chalega aur sirf ek baar.</p>
      <div class="card" style="padding:16px;text-align:center"><div style="font-size:26px;letter-spacing:3px;font-weight:700" id="transferCodeText">${esc(data.code)}</div></div>
      <p class="muted" style="font-size:12.5px;margin:0">Valid till ${esc(fmtDate(data.expires_at))}. Isse sirf us insaan ko do jis par aap bharosa karte ho.</p>
    </div>
    <div class="modal-foot">
      <button class="ghost" onclick="cancelTransferProfile('${esc(p.id)}')">Cancel transfer</button>
      <button class="primary" onclick="copyTransferCode()">Copy code</button>
    </div></div>`;
  document.body.appendChild(ov);
}
function closeTransferModal() { document.getElementById("transferModal")?.remove(); }
async function copyTransferCode() {
  const t = document.getElementById("transferCodeText")?.textContent || "";
  try { await navigator.clipboard.writeText(t); toast("Code copy ho gaya"); } catch (e) { toast("Code select karke copy karo"); }
}
async function cancelTransferProfile(personId) {
  const { error } = await supabase.rpc("cancel_profile_transfer", { p_person_id: personId });
  closeTransferModal();
  toast(error ? error.message : "Transfer cancel ho gaya");
}
async function redeemTransferCode() {
  const code = document.getElementById("trCode")?.value.trim();
  if (!code) { toast("Transfer code daaliye"); return; }
  const { error } = await supabase.rpc("accept_profile_transfer", { p_code: code });
  if (error) { toast(/accept_profile_transfer|function|schema cache/i.test(error.message) ? "Run supabase-admin-claim.sql in Supabase first" : error.message); return; }
  toast("Profile aapko transfer ho gaya. Ab aap is tree ke admin hain.");
  location.hash = "tree"; bootAuthenticatedApp();
}

/* ---------------- V11: production dashboard ---------------- */
function production() {
  return `<div class="page-head"><h2>🚀 Production Dashboard</h2><p class="muted">System health and release pipeline.</p></div>
  <div class="grid g3">
    <div class="card stat-card"><span class="muted">Users</span><div class="stat">1,284</div></div>
    <div class="card stat-card"><span class="muted">Family Trees</span><div class="stat">347</div></div>
    <div class="card stat-card"><span class="muted">System</span><div class="stat ok">Healthy</div></div>
  </div>
  <div class="card"><h3>Production checks</h3>
    <div class="row"><span>Database</span><b style="color:var(--sage)">✓ Healthy</b></div>
    <div class="row"><span>Storage</span><b style="color:var(--sage)">✓ Healthy</b></div>
    <div class="row"><span>Authentication</span><b style="color:var(--sage)">✓ Healthy</b></div>
    <div class="row"><span>Backups</span><b style="color:var(--sage)">✓ Configured</b></div>
    <div class="row"><span>RLS test suite</span><b style="color:var(--gold-deep)">⚠ Run before launch</b></div>
  </div>
  <div class="card"><h3>Release pipeline</h3>
    <div class="row"><span>GitHub</span><b>Source</b></div>
    <div class="row"><span>Vercel Preview</span><b>Testing</b></div>
    <div class="row"><span>Vercel Production</span><b>Release</b></div>
    <div class="row"><span>Supabase</span><b>Database + Auth + Storage</b></div>
  </div>`;
}

/* ---- GEDCOM import ---- */
/* GEDCOM files carry photo URLs that can be short-lived (they 404 a day later). Copy each photo into our own
   "avatars" bucket right now; if a photo can't be fetched, drop the dead link so the card shows initials. */
async function persistImportedPhotos(people) {
  const list = people.filter(p => p.avatar_url && /^https?:/i.test(p.avatar_url) && !String(p.avatar_url).includes("/storage/v1/object/public/avatars/"));
  if (!list.length) return;
  toast(`${list.length} photo save ho rahi hain…`);
  let ok = 0, lost = 0, i = 0;
  const worker = async () => {
    while (i < list.length) {
      const p = list[i++];
      try {
        const res = await fetch(p.avatar_url);
        if (!res.ok) throw new Error("HTTP " + res.status);
        const blob = await res.blob();
        if (!/^image\//.test(blob.type)) throw new Error("not an image");
        const ext = (blob.type.split("/")[1] || "jpg").replace("jpeg", "jpg").split("+")[0];
        const path = `${currentUser.id}/${p.id}-${Date.now()}.${ext}`;
        const { error } = await supabase.storage.from("avatars").upload(path, blob, { upsert: true, cacheControl: "3600", contentType: blob.type });
        if (error) throw error;
        p.avatar_url = supabase.storage.from("avatars").getPublicUrl(path).data.publicUrl; ok++;
      } catch (e) { console.warn("photo import failed for", p.name, e); p.details = { ...(p.details || {}), source_photo: p.avatar_url }; p.avatar_url = null; lost++; }
    }
  };
  await Promise.all([worker(), worker(), worker(), worker()]);
  toast(`Photos: ${ok} save hui` + (lost ? `, ${lost} download nahi ho paayi` : ""));
}
async function importGedcomPicked(inputEl) {
  const file = inputEl.files && inputEl.files[0];
  inputEl.value = "";                       // allow picking the same file again
  if (!file) return;
  if (treeViewing) return toast("Read-only while viewing another person's tree");
  if (state.joined) return toast("GEDCOM import sirf apni tree mein ho sakta hai");
  if (!currentUser || !state.treeId) return toast("Please sign in first");
  try {
    toast("Reading GEDCOM file…");
    const res = await importGedcomFile(file, {
      createdBy: currentUser.id,
      existingCodes: new Set(state.people.map(p => p.personCode).filter(Boolean)),
      existingGedIds: new Set(state.people.map(p => p.details && p.details.gedcom_id).filter(Boolean))
    });
    let people = res.people; const rels = res.relationships; const report = res.report;
    if (!people.length) return toast(report.skippedDuplicates ? "Is file ke sab log pehle se import ho chuke hain" : "File mein koi person nahi mila");

    // If the file contains the signed-in user, link to their existing card instead of creating a duplicate.
    const mine = myself();
    let linked = null;
    if (mine && mine.name) {
      const key = s => (s || "").toLowerCase().replace(/\s+/g, " ").trim();
      const hit = people.find(p => key(p.name) === key(mine.name)); // name match only: DOB in file may differ from profile; keep my own DOB
      if (hit) {
        rels.forEach(r => { if (r.from === hit.id) r.from = mine.id; if (r.to === hit.id) r.to = mine.id; });
        mine.details = { ...(mine.details || {}), gedcom_id: hit.details.gedcom_id };
        if (!mine.dob && hit.dob) mine.dob = hit.dob;
        if (!mine.birthPlace && hit.birthPlace) mine.birthPlace = hit.birthPlace;
        if (!mine.avatar_url && hit.avatar_url) mine.avatar_url = hit.avatar_url;
        people = people.filter(p => p !== hit);
        linked = mine.name;
      }
    }

    await persistImportedPhotos(people);
    const have = new Set(state.relationships.map(r => `${r.type}|${r.from}|${r.to}`));
    const newRels = rels.filter(r => !have.has(`${r.type}|${r.from}|${r.to}`));
    state.people.push(...people);
    state.relationships.push(...newRels);
    await save();
    render();
    toast(`${people.length} log aur ${newRels.length} rishte import hue` + (linked ? ` (${linked} aapke profile se jud gaye)` : ""));
  } catch (e) { console.error("GEDCOM import failed", e); toast("GEDCOM import failed: " + e.message); }
}

/* Expose functions referenced by inline onclick="..." handlers in the
   rendered HTML. Required because this file is loaded as an ES module
   (type="module"), and top-level function declarations in a module are
   scoped to the module — they are NOT attached to window automatically
   the way classic <script> globals are. */
Object.assign(window, {
  setHoroscope, loadHoroscope, openHoroscope, setHoroCity, tarotDraw, wallPickMedia, wallRemoveFile, wallViewImage, wallMediaShare, wallMediaDownload, wallSaveMedia,
  avatarFallback, sendChat, chatKey,
  openPersonTree, exitTreeView, openBranch, exitBranch,
  openChangeEmail, saveNewEmail,
  acceptConnection, addRelative, approveMerge, centerTree, changePhoto, compareMerge, mergeSelectedGroups, mergePickSearch, mergePickChoose, mergePickKey,
  createPerson, createTicket, findPerson, findRelation, go, googleLogin,
  invite, likePost, logout, openAddRelative, openProfile, openTicket,
  phoneLogin, pickAddRelativePhoto, publishPost, requestMerge, resolveTicket,
  reviewItem, saveAddRelative, sendReply, shareId, toast, treeFocusMe,
  treeReset, treeZoom, treeFit, toggleTreeExpand, treeSearch, treeSearchInput, treeSearchKey, treeSearchPick, setTreeRole,
  openTransferProfile, closeTransferModal, copyTransferCode, cancelTransferProfile, redeemTransferCode,
  setAddRelativeMode, refreshExistingOptions, openMyProfile, saveProfileEdits, openEditProfile, closeEditProfile, openProfilePopup, openFullProfile, cancelEditProfile, deletePerson, removeLink, openDeleteMyProfile, searchRelativeByUid, linkByUniqueId, approveIncoming, rejectIncoming,
  loadMemories, addMemory, deleteMemory,
  runClaimSearch, requestClaim, cancelClaim, startFreshProfile, approveClaim, rejectClaim,
  openJoinPreview, closeJoinPreview, sendJoinRequest, approveJoin, rejectJoin, cancelJoin, ackJoinRejected,
  openProfileInvite, closeProfileInvite, generateProfileInvite, copyProfileInvite, revokeProfileInvite, acceptProfileInvite, declineProfileInvite,
  dmOpen, dmBack, dmSearchInput, openChatSheet, closeChatSheet,
  assignTicket, refreshSupport, arRelTypeChanged, cityPicked, cityStateChanged,
  importGedcomPicked, setPeopleSearch, clearPeopleSearch, setPeopleSort, openMoreMenu, closeMoreMenu,
  /* these were used by inline onclick/onchange but never exported, so the Branch/Chart switch, the whole Chart toolbar and the profile Privacy dropdown did nothing */
  setEvFilter, setEvRange, openEventWish, dqAnother, dqShare, dqDownload, openPersonWall, openNewWallPost, wallToggleTagPicker, wallToggleLoc, wallLocRender, wallLocClear, wallLocGPS, wallLocSearch, wallLocPick, wallLocPaste, wallLocToggleMap, wallAddTag, wallRemoveTag, wallPost, wallReactToggle, wallReact, wallToggleComments, wallAddComment, wallDeleteComment, wallDeletePost, setTreeStyle, chartAddMenu, chartBack, chartFit, chartGoFamily, chartOpen, chartSetRoot, chartZoom, chartPanStart, chartWheel, setPrivacy
});

window.addEventListener("hashchange", render);

/* Startup / login sequence.
   After Google login the browser comes back to the app with a code/token in the URL. Supabase exchanges it
   asynchronously, so the first boot used to run BEFORE the session existed and drew the login screen; the page
   only worked after a manual refresh. Now: (1) only ONE boot runs at a time (extra requests are queued),
   (2) getSession() is awaited - it waits for the redirect to be processed, (3) while that happens we show
   "Signing you in..." instead of the login screen. */
let bootRunning = false, bootQueued = false;
async function bootAuthenticatedApp() {
  if (bootRunning) { bootQueued = true; return; }
  bootRunning = true;
  try { await bootOnce(); }
  finally { bootRunning = false; if (bootQueued) { bootQueued = false; bootAuthenticatedApp(); } }
}
async function bootOnce() {
  if (!supabase) { renderLogin(); return; }
  const returningFromLogin = /[?&#](code|access_token|refresh_token)=/.test(location.search + location.hash);
  if (returningFromLogin && !loggedIn) {
    const app = document.getElementById("app");
    if (app) app.innerHTML = '<div style="min-height:100vh;display:grid;place-items:center;font-family:var(--font-body);color:var(--ink-soft)">Signing you in…</div>';
  }
  const { data: sdata } = await supabase.auth.getSession(); // waits until the OAuth redirect has been processed
  let user = sdata?.session?.user || null;
  if (user) {
    const { data: u, error: ue } = await supabase.auth.getUser();
    if (!ue && u?.user) user = u.user;
    else if (ue && (ue.status === 401 || ue.status === 403)) user = null; // token really invalid; other errors (offline) keep the session
  }
  if (!user) { loggedIn = false; renderLogin(); return; }
  currentUser = user;
  loggedIn = true;
  try {
    await ensureProfileAndTree(user);
    await resolveJoinState(user);
    if (!state.joined && await showPendingInvite(user)) return;
    if (!state.joined && await needsClaimStep(user)) { await renderClaimStep(); return; }
    await loadProductionState(user);
    render();
  } catch (e) { console.error(e); toast('Could not load your family data: ' + e.message); render(); }
}

/* ---------------- join someone's tree: preview -> request -> (pending: add only) -> approve / reject ---------------- */
async function resolveJoinState(user) {
  state.joined = null; state.joinNotice = null;
  let data = null;
  try { const r = await supabase.rpc("my_join_state"); if (!r.error) data = r.data; } catch (e) {}
  if (!data) return; // SQL not installed yet, or never asked to join -> normal behaviour
  if (data.status === "pending" || data.status === "approved") {
    state.joined = { requestId: data.request_id, treeId: data.tree_id, personId: data.person_id, status: data.status, treeName: data.tree_name, known: new Set(), knownRels: new Set() };
    state.treeId = data.tree_id;
    if (data.status === "pending") startJoinPoll();
  } else if (data.status === "rejected" && localStorage.getItem("ft_join_rej_" + data.request_id) !== "1") {
    state.joinNotice = { requestId: data.request_id, treeName: data.tree_name };
  }
}
let joinPoll = null;
/* While pending, check every 30s so the member sees the decision without logging in again. */
function startJoinPoll() {
  if (joinPoll) return;
  joinPoll = setInterval(async () => {
    if (!state.joined || state.joined.status !== "pending" || !currentUser) { clearInterval(joinPoll); joinPoll = null; return; }
    try {
      const r = await supabase.rpc("my_join_state"); const s = r.data && r.data.status;
      if (s && s !== "pending") { clearInterval(joinPoll); joinPoll = null; toast(s === "approved" ? "Aapki join request approve ho gayi!" : "Aapki join request reject ho gayi"); bootAuthenticatedApp(); }
    } catch (e) {}
  }, 30000);
}
function joinBannerHTML() {
  if (!state.joined || state.joined.status !== "pending") return "";
  return `<div class="card" style="margin-bottom:14px;border-left:4px solid var(--gold,#e0a526)"><b>⏳ Join request pending</b> — ${esc(state.joined.treeName || "is tree")} ke admin ka approval baaki hai.<br>
    <span class="muted" style="font-size:13px">Abhi aap sirf <b>naye profiles add</b> kar sakte ho. Purane profiles edit/delete nahi ho sakte. Approve hone par edit bhi kar paoge. Agar request reject hui to aapke add kiye saare profiles bhi hata diye jayenge.</span>
    <div style="margin-top:8px"><button class="ghost" onclick="cancelJoin()">Request cancel karo</button></div></div>`;
}
async function cancelJoin() {
  if (!state.joined) return;
  if (!confirm("Request cancel karne par aapke add kiye hue naye profiles bhi hat jayenge. Cancel karein?")) return;
  const { error } = await supabase.rpc("cancel_join_request", { p_request_id: state.joined.requestId });
  if (error) { toast(error.message); return; }
  toast("Request cancel ho gayi");
  location.hash = "home"; bootAuthenticatedApp();
}
function previewTreeHTML(d, focusId) {
  const ppl = d.persons || [], rels = d.relationships || [];
  const gen = Object.fromEntries(ppl.map(p => [p.id, 0]));
  for (let i = 0; i < 40; i++) {
    let ch = false;
    rels.forEach(r => {
      if (!(r.person_a_id in gen) || !(r.person_b_id in gen)) return;
      if (r.relationship_type === "parent") { if (gen[r.person_b_id] < gen[r.person_a_id] + 1) { gen[r.person_b_id] = gen[r.person_a_id] + 1; ch = true; } }
      else if (r.relationship_type === "spouse") { const m = Math.max(gen[r.person_a_id], gen[r.person_b_id]); if (gen[r.person_a_id] !== m || gen[r.person_b_id] !== m) { gen[r.person_a_id] = gen[r.person_b_id] = m; ch = true; } }
    });
    if (!ch) break;
  }
  const rows = {};
  ppl.forEach(p => (rows[gen[p.id]] ||= []).push(p));
  return Object.keys(rows).map(Number).sort((a, b) => a - b).map(g => `<div class="jp-row"><div class="jp-label">Generation ${g + 1}</div><div class="jp-chips">${rows[g].map(p =>
    `<span class="jp-chip${p.id === focusId ? " focus" : ""}">${esc(p.full_name || "?")}${p.birth_year ? ` <small>${esc(p.birth_year)}</small>` : ""}${p.id === focusId ? " 👈" : ""}</span>`).join("")}</div></div>`).join("");
}
async function openJoinPreview(personId) {
  const { data: d, error } = await supabase.rpc("join_preview", { p_person_id: personId });
  if (error) { toast(/join_preview|function|schema cache/i.test(error.message) ? "Run supabase-join-tree.sql in Supabase first" : error.message); return; }
  const adm = (d.admins || []).map(a => `<div class="row"><span>${esc(a.name)}</span><span class="badge ${a.role === "owner" ? "sage" : "plum"}">${a.role === "owner" ? "Owner" : "Admin"}</span></div>`).join("") || "<p class='muted'>No admins listed.</p>";
  const ov = document.createElement("div"); ov.className = "modal-overlay"; ov.id = "joinPreview";
  ov.innerHTML = `<div class="modal-card"><div class="modal-head"><h3>🌳 ${esc(d.tree_name || "Family tree")}</h3><button class="ghost" onclick="closeJoinPreview()">✕</button></div>
    <div class="modal-body">
      <p class="muted" style="margin:0">Ye tree dekhiye. Agar isme aap hain (👈), to join request bhejiye. Sirf naam/saal dikhaye ja rahe hain — phone/email nahi.</p>
      <div class="card" style="padding:12px"><h4 style="margin:0 0 6px">Tree Admins</h4>${adm}</div>
      <div>${previewTreeHTML(d, d.focus_person_id) || "<p class='muted'>Tree khali hai.</p>"}</div>
    </div>
    <div class="modal-foot">
      <button class="ghost" onclick="closeJoinPreview()">Wapas</button>
      <button class="secondary" onclick="sendJoinRequest('${esc(d.tree_id)}', null)">Mera profile isme nahi — naya banao</button>
      <button class="primary" onclick="sendJoinRequest('${esc(d.tree_id)}', '${esc(d.focus_person_id)}')">✅ Ye main hu — Join karo</button>
    </div></div>`;
  document.body.appendChild(ov);
}
function closeJoinPreview() { document.getElementById("joinPreview")?.remove(); }
async function sendJoinRequest(treeId, personId) {
  const { error } = await supabase.rpc("request_join_tree", { p_tree_id: treeId, p_person_id: personId });
  if (error) {
    // A claimed profile can't be taken over with another email. Joining with a new profile is the safe route; an admin approves it.
    toast(/already belongs/i.test(error.message) ? "Ye profile pehle se claimed hai. \"Naya banao\" se join karo; admin approve karega to aap bhi admin ban jaoge." : error.message);
    return;
  }
  closeJoinPreview();
  toast("Join request bhej di gayi. Approval tak aap naye profiles add kar sakte hain.");
  location.hash = "tree"; bootAuthenticatedApp();
}
async function approveJoin(requestId) {
  if (!confirm("Approve karne par ye person is tree ka ADMIN ban jayega (profiles add aur edit kar sakega, aur doosre admin ko hata bhi sakega). Sirf tab approve karo jab aap isse jaante ho. Approve karein?")) return;
  const { error } = await supabase.rpc("approve_join_request", { p_request_id: requestId });
  if (error) { toast(error.message); return; }
  toast("Approved. Ye person ab tree admin hai.");
  try { await loadProductionState(currentUser); } catch (e) { console.error(e); }
  render();
}
async function rejectJoin(requestId, added) {
  if (!confirm(`Reject karne par is person ke add kiye ${added || 0} profile(s) aur unke links bhi hat jayenge. Reject karein?`)) return;
  const { data, error } = await supabase.rpc("reject_join_request", { p_request_id: requestId });
  if (error) { toast(error.message); return; }
  toast(`Rejected. ${data?.profiles_removed ?? 0} profile(s) hata diye gaye.`);
  try { await loadProductionState(currentUser); } catch (e) { console.error(e); }
  render();
}

/* ---------------- invite link for an unclaimed profile (admin optional) ---------------- */
/* An owner/admin picks an unclaimed profile in People and chooses "Admin bhi banao" or "Sirf member".
   The link is  <site>/?invite=TOKEN  (single-use, expires, hashed in the DB). It is stashed in localStorage on page load because the
   login redirect drops the URL; after sign-in the person sees a confirm screen and the server links them to exactly that profile. */
const INVITE_KEY = "ft_invite_token";
function canInviteProfile(p) { return !!supabase && !!currentUser && !!p && p.status === "unclaimed" && !p.claimed_by && !p.external && !treeViewing && canEditTree(); }
let inviteDraftPerson = null;
function openProfileInvite(id) {
  const p = personById(id);
  if (!canInviteProfile(p)) { toast("Sirf tree owner/admin unclaimed profile ka invite bana sakte hain"); return; }
  inviteDraftPerson = p.id;
  document.getElementById("inviteModal")?.remove();
  const ov = document.createElement("div"); ov.className = "modal-overlay"; ov.id = "inviteModal";
  ov.innerHTML = `<div class="modal-card"><div class="modal-head"><h3>🔗 Invite link — ${esc(p.name)}</h3><button class="ghost" onclick="closeProfileInvite()">✕</button></div>
    <div class="modal-body" id="inviteBody">
      <p class="muted" style="margin:0">Ye link jisko bhejoge, wo login karke <b>${esc(p.name)}</b> wali profile apni bana lega. Link ek hi baar chalega.</p>
      <label class="card" style="display:flex;gap:10px;align-items:flex-start;padding:12px;cursor:pointer"><input type="radio" name="invAdmin" value="0" checked style="margin-top:4px">
        <span><b>Sirf member</b><br><span class="muted" style="font-size:12.5px">Profile uski ho jayegi. Wo profiles add/edit kar sakta hai, par admin manage, join approve ya invite nahi bana sakta.</span></span></label>
      <label class="card" style="display:flex;gap:10px;align-items:flex-start;padding:12px;cursor:pointer"><input type="radio" name="invAdmin" value="1" style="margin-top:4px">
        <span><b>Admin bhi banao</b><br><span class="muted" style="font-size:12.5px">Profile uski ho jayegi aur wo tree ka <b>admin</b> banega: add/edit, join requests approve, doosre admin add/remove aur invite links.</span></span></label>
      <div class="field"><label>Link kitne din chale</label><select id="invDays"><option value="1">1 din</option><option value="7" selected>7 din</option><option value="30">30 din</option></select></div>
    </div>
    <div class="modal-foot"><button class="ghost" onclick="closeProfileInvite()">Cancel</button><button class="primary" onclick="generateProfileInvite()">Link banao</button></div></div>`;
  document.body.appendChild(ov);
}
function closeProfileInvite() { document.getElementById("inviteModal")?.remove(); }
async function generateProfileInvite() {
  const p = personById(inviteDraftPerson);
  if (!p) return;
  const makeAdmin = document.querySelector('input[name="invAdmin"]:checked')?.value === "1";
  const days = Number(document.getElementById("invDays")?.value) || 7;
  if (makeAdmin && !confirm(`${p.name} wali profile jo bhi is link se kholega wo tree ka ADMIN ban jayega. Sirf usi ko bhejo jise aap jaante ho. Continue?`)) return;
  const { data, error } = await supabase.rpc("create_profile_invite", { p_person_id: p.id, p_make_admin: makeAdmin, p_days: days });
  if (error) { toast(/create_profile_invite|function|schema cache/i.test(error.message) ? "Run supabase-profile-invite.sql in Supabase first" : error.message); return; }
  const link = `${location.origin}${location.pathname}?invite=${data.token}`;
  const wa = `https://wa.me/?text=${encodeURIComponent(`Family tree me aapki profile (${p.name}) ready hai. Is link se join karo: ${link}`)}`;
  const body = document.getElementById("inviteBody"), foot = document.querySelector("#inviteModal .modal-foot");
  if (!body || !foot) return;
  body.innerHTML = `<p style="margin:0">✅ Link ready — <b>${data.make_admin ? "Admin bhi banega" : "Sirf member banega"}</b>.</p>
    <input id="inviteLinkText" readonly value="${esc(link)}" onclick="this.select()" style="width:100%">
    <p class="muted" style="font-size:12.5px;margin:0">Valid till ${esc(fmtDate(data.expires_at))}, sirf ek baar chalega. Ye link dobara nahi dikhega, aur naya link banane par purana band ho jayega.</p>`;
  foot.innerHTML = `<button class="ghost" onclick="revokeProfileInvite('${esc(p.id)}')">Link band karo</button><a class="secondary" style="padding:10px 16px;border-radius:12px;text-decoration:none" href="${esc(wa)}" target="_blank" rel="noopener">WhatsApp</a><button class="primary" onclick="copyProfileInvite()">Copy link</button>`;
}
async function copyProfileInvite() {
  const t = document.getElementById("inviteLinkText")?.value || "";
  try { await navigator.clipboard.writeText(t); toast("Link copy ho gaya"); } catch (e) { document.getElementById("inviteLinkText")?.select(); toast("Link select karke copy karo"); }
}
async function revokeProfileInvite(personId) {
  const { error } = await supabase.rpc("revoke_profile_invite", { p_person_id: personId });
  closeProfileInvite();
  toast(error ? error.message : "Link band ho gaya");
}
/* Receiver side */
async function showPendingInvite(user) {
  const token = localStorage.getItem(INVITE_KEY);
  if (!token) return false;
  const { data: d, error } = await supabase.rpc("peek_profile_invite", { p_token: token });
  if (error) {
    if (/peek_profile_invite|function|schema cache/i.test(error.message)) { toast("Run supabase-profile-invite.sql in Supabase first"); return false; }
    localStorage.removeItem(INVITE_KEY);
    toast(/expired|invalid/i.test(error.message) ? "Ye invite link expire ho gaya ya band hai. Bhejne wale se naya link maango." : error.message);
    return false;
  }
  document.getElementById("app").innerHTML = `<main class="login"><section class="login-card" style="max-width:520px">
    <div class="eyebrow">Family invite</div>
    <h1 style="font-size:28px">🌳 ${esc(d.tree_name || "Family tree")}</h1>
    <p class="muted"><b>${esc(d.invited_by)}</b> ne aapko is tree me profile <b>${esc(d.person_name)}</b> ke roop me invite kiya hai.</p>
    <div class="card" style="margin:12px 0"><b>Accept karne par:</b><br><span class="muted" style="font-size:13.5px">• Ye profile aapki ho jayegi<br>• ${d.make_admin ? "Aap is tree ke <b>admin</b> banoge (add/edit, join approve, admin manage, invite)" : "Aap tree ke <b>member</b> banoge (profiles add/edit kar sakoge)"}</span></div>
    <p class="muted" style="font-size:12.5px">Agar ye profile aap nahi ho, to Accept mat karo.</p>
    <button class="primary full" onclick="acceptProfileInvite()">✅ Ye main hu — Accept</button>
    <button class="ghost full" style="margin-top:8px" onclick="declineProfileInvite()">Abhi nahi</button>
    <button class="ghost full" style="margin-top:8px" onclick="logout()">Logout</button>
  </section></main>`;
  return true;
}
async function acceptProfileInvite() {
  const token = localStorage.getItem(INVITE_KEY);
  if (!token) { bootAuthenticatedApp(); return; }
  const { data, error } = await supabase.rpc("accept_profile_invite", { p_token: token });
  if (error) {
    toast(error.message);
    if (/expired|invalid|no longer|already/i.test(error.message)) { localStorage.removeItem(INVITE_KEY); setTimeout(bootAuthenticatedApp, 1200); }
    return;
  }
  localStorage.removeItem(INVITE_KEY);
  toast(data && data.admin ? "Profile aapki ho gayi. Ab aap is tree ke admin hain." : "Profile aapki ho gayi. Ab aap is tree ke member hain.");
  location.hash = "tree"; bootAuthenticatedApp();
}
function declineProfileInvite() { localStorage.removeItem(INVITE_KEY); bootAuthenticatedApp(); }

/* ---------------- first-login: find & claim a profile someone already made ---------------- */
let skipClaimSearch = false;
async function needsClaimStep(user) {
  if (skipClaimSearch) return false;
  const { data: mine, error } = await supabase.from('persons').select('id').eq('claimed_by', user.id).limit(1);
  if (error) { console.warn('claim check failed', error); return false; }
  if (mine && mine.length) return false;
  const { data: tree } = await supabase.from('family_trees').select('id').eq('owner_id', user.id).limit(1).maybeSingle();
  if (tree) {
    const { data: tm } = await supabase.from('tree_members').select('person_id').eq('tree_id', tree.id).limit(1);
    if (tm && tm.length) return false; // existing user who already has people in their tree
  }
  return true;
}
async function renderClaimStep() {
  let pending = [];
  try { const r = await supabase.rpc('my_pending_claims'); pending = r.error ? [] : (r.data || []); } catch (e) {}
  const f = (id, label, ph, extra = '') => `<div class="field"><label>${label}</label><input id="${id}" placeholder="${ph}" autocomplete="off" ${extra} onkeydown="if(event.key==='Enter'){event.preventDefault();runClaimSearch()}"></div>`;
  document.getElementById('app').innerHTML = `<main class="login"><section class="login-card" style="max-width:560px">
    <div class="eyebrow">Welcome</div>
    <h1 style="font-size:28px">Is your profile already made by someone?</h1>
    <p class="muted">A relative may already have added you to the family tree. Search below, tap <b>"Ye main hu"</b> to see that tree and its admins, then send a join request.</p>
    ${state.joinNotice ? `<div class="card" style="margin:12px 0;border-left:4px solid #c0392b"><b>Aapki join request reject ho gayi</b> (${esc(state.joinNotice.treeName || "tree")}). Us request ke saath add kiye profiles hata diye gaye hain. Aap dobara search kar sakte hain ya naya profile bana sakte hain.<br><button class="ghost" style="margin-top:6px" onclick="ackJoinRejected()">Theek hai</button></div>` : ""}
    ${pending.length ? `<div class="card" style="margin:12px 0"><h3>Waiting for approval</h3>${pending.map(r => `<div class="row"><span><b>${esc(r.person_name)}</b><br><span class="muted" style="font-size:12.5px">The person who added this profile must approve your request.</span></span><button class="ghost" onclick="cancelClaim('${esc(r.request_id)}')">Cancel</button></div>`).join('')}</div>` : ''}
    <div class="form" style="margin-top:10px">
      ${f('clName', 'Your name *', 'e.g. Pooja Sharma', `value="${esc(state.account?.name || '')}"`)}
      ${f('clFather', "Father's name", 'Optional')}
      ${f('clMother', "Mother's name", 'Optional')}
      ${f('clSpouse', 'Husband / Wife name', 'Optional')}
      ${f('clSibling', 'Brother / Sister name', 'Optional')}
      <button class="primary" onclick="runClaimSearch()">🔎 Search profile</button>
    </div>
    <div id="clResults" style="margin-top:14px"></div>
    <hr class="divider">
    <div class="card" style="margin:0 0 12px"><h3 style="margin-top:0">Transfer code hai?</h3>
      <p class="muted" style="font-size:12.5px;margin:0 0 8px">Agar kisi ne apna profile aapko transfer kiya hai, uska code yahan daaliye.</p>
      <div style="display:flex;gap:8px"><input id="trCode" placeholder="XXXX-XXXX-XXXX-XXXX" autocomplete="off" style="flex:1" onkeydown="if(event.key==='Enter'){event.preventDefault();redeemTransferCode()}"><button class="secondary" onclick="redeemTransferCode()">Use code</button></div>
    </div>
    <button class="ghost full" onclick="startFreshProfile()">Not found — create a new profile</button>
    <button class="ghost full" style="margin-top:8px" onclick="logout()">Logout</button>
  </section></main>`;
}
async function runClaimSearch() {
  const v = id => document.getElementById(id)?.value.trim() || null;
  const name = v('clName');
  const box = document.getElementById('clResults');
  if (!name || name.length < 3) { toast('Enter at least 3 letters of your name'); return; }
  box.innerHTML = '<p class="muted">Searching…</p>';
  const { data, error } = await supabase.rpc('search_unclaimed_profiles', { p_name: name, p_father: v('clFather'), p_mother: v('clMother'), p_spouse: v('clSpouse'), p_sibling: v('clSibling') });
  if (error) { box.innerHTML = `<p class="muted">${/search_unclaimed_profiles|function|schema cache/i.test(error.message) ? 'Run claim-existing-profile.sql in Supabase first' : esc(error.message)}</p>`; return; }
  if (!data || !data.length) { box.innerHTML = '<p class="muted">No matching profile found. Try fewer fields, or create a new profile.</p>'; return; }
  box.innerHTML = data.map(r => `<div class="row"><span><b>${esc(r.full_name)}</b> <span class="muted" style="font-size:12.5px">${esc(r.person_code || '')}</span><br>
    <span class="muted" style="font-size:12.5px">${[r.birth_year ? 'Born ' + r.birth_year : '', r.current_place || '', r.added_by_name ? 'Added by ' + r.added_by_name : ''].filter(Boolean).map(esc).join(' · ')}</span></span>
    <button class="primary" onclick="openJoinPreview('${esc(r.person_id)}')">Ye main hu →</button></div>`).join('');
}
function ackJoinRejected() { if (state.joinNotice) localStorage.setItem("ft_join_rej_" + state.joinNotice.requestId, "1"); state.joinNotice = null; renderClaimStep(); }
async function requestClaim(personId) {
  const { error } = await supabase.rpc('request_profile_claim', { p_person_id: personId });
  if (error) { toast(error.message); return; }
  toast('Request sent. You will get access once they approve.');
  renderClaimStep();
}
async function cancelClaim(requestId) {
  const { error } = await supabase.rpc('cancel_profile_claim', { p_request_id: requestId });
  if (error) { toast(error.message); return; }
  renderClaimStep();
}
function startFreshProfile() { skipClaimSearch = true; bootAuthenticatedApp(); }
async function approveClaim(requestId) {
  const { error } = await supabase.rpc('approve_profile_claim', { p_request_id: requestId });
  if (error) { toast(error.message); return; }
  toast('Approved. This person can now sign in to their profile.');
  try { await loadProductionState(currentUser); } catch (e) { console.error(e); }
  render();
}
async function rejectClaim(requestId) {
  const { error } = await supabase.rpc('reject_profile_claim', { p_request_id: requestId });
  if (error) { toast(error.message); return; }
  toast('Request declined');
  try { await loadProductionState(currentUser); } catch (e) { console.error(e); }
  render();
}

async function ensureProfileAndTree(user) {
  let { data: profile, error } = await supabase.from('profiles').select('*').eq('id', user.id).maybeSingle();
  if (error) throw error;
  if (!profile) {
    const { data, error: pe } = await supabase.from('profiles').insert({ id: user.id, display_name: user.user_metadata?.full_name || user.email?.split('@')[0] || 'Family Member', email: user.email || null, phone: user.phone || null }).select().single();
    if (pe) throw pe; profile = data;
  }
  let { data: tree, error: te } = await supabase.from('family_trees').select('*').eq('owner_id', user.id).order('created_at').limit(1).maybeSingle();
  if (te) throw te;
  if (!tree) { const { data: nt, error: ne } = await supabase.from('family_trees').insert({ name: (profile.display_name || 'My') + " Family Tree", owner_id: user.id }).select().single(); if (ne) throw ne; tree = nt; }
  state.account = { name: profile.display_name || 'Family Member', email: profile.email || user.email || '', role: 'member', profileId: user.id };
  state.treeId = tree.id;
}

async function loadJoinedState(user) {
  const j = state.joined;
  const { data, error } = await supabase.rpc("get_joined_tree", { p_tree_id: j.treeId });
  if (error) throw error;
  j.status = data.access === "pending" ? "pending" : "approved";
  const roleById = Object.fromEntries((data.members || []).map(m => [m.person_id, m.role]));
  const people = (data.persons || []).filter(p => p.status !== "merged");
  state.people = people.map(p => {
    const mine = p.id === j.personId || p.claimed_by === user.id;
    return { id: p.id, created_at: p.created_at, personCode: p.person_code, name: p.full_name, gender: p.gender, status: p.status, dob: p.dob, mobile: p.mobile, email: p.email, avatar_url: p.avatar_url,
      me: mine, claimed_by: p.claimed_by, created_by: p.created_by, privacy: "Family only", nickname: p.nickname, showNickname: p.show_nickname, birthPlace: p.birth_place, currentPlace: p.current_place,
      lifeStatus: p.life_status, details: p.details || {}, treeRole: roleById[p.id] || "member", savedRole: roleById[p.id] || "member", external: false };
  });
  const ids = new Set(state.people.map(p => p.id));
  state.relationships = (data.relationships || []).filter(r => ids.has(r.person_a_id) && ids.has(r.person_b_id))
    .map(r => ({ id: r.id, from: r.person_a_id, to: r.person_b_id, type: r.relationship_type, status: r.status, tree_id: r.tree_id }));
  j.known = new Set(state.people.map(p => p.id));
  j.knownRels = new Set(state.relationships.map(r => r.id));
  state.account.role = "member";
  state.posts = []; state.events = []; state.mergeRequests = []; state.connections = [];
  try { await loadSupportTickets(user); } catch (e) { state.tickets = []; }
  state.incomingClaims = []; state.incoming = []; state.incomingJoins = [];
  activeTicketId = null;
  if (!state.people.some(p => p.me) && state.people[0]) state.people[0].me = true; // never leave the UI without a "me" card
}

async function loadProductionState(user) {
  treeViewing = null;
  if (state.joined) return loadJoinedState(user);
  const treeId = state.treeId;
  const { data: members, error: me } = await supabase.from('tree_members').select('person_id, role').eq('tree_id', treeId); if (me) throw me;
  const memberIds = (members || []).map(x => x.person_id);
  const memberRoleById = Object.fromEntries((members || []).map(x => [x.person_id, x.role]));
  let people = [];
  if (memberIds.length) { const { data, error } = await supabase.from('persons').select('*').in('id', memberIds); if (error) throw error; people = (data || []).filter(p => !(p.details && p.details.deleted) && p.status !== 'merged'); }
  if (!people.some(p => p.claimed_by === user.id)) {
    const { data: mine, error } = await supabase.from('persons').select('*').eq('claimed_by', user.id).limit(1).maybeSingle();
    if (error) throw error;
    if (mine) { await supabase.from('tree_members').upsert({ tree_id: treeId, person_id: mine.id, added_by: user.id, role: 'owner' }, { onConflict: 'tree_id,person_id' }); people.push(mine); }
    else {
      const newPerson = { id: crypto.randomUUID(), person_code: 'P-' + Math.floor(10000 + Math.random()*89999), full_name: state.account.name, gender: null, status: 'claimed', claimed_by: user.id, created_by: user.id };
      const { data: inserted, error: ie } = await supabase.from('persons').insert(newPerson).select().single(); if (ie) throw ie;
      const { error: tmerr } = await supabase.from('tree_members').insert({ tree_id: treeId, person_id: inserted.id, added_by: user.id, role: 'owner' }); if (tmerr) throw tmerr;
      people.push(inserted);
    }
  }
  // Relatives linked from OTHER trees (e.g. a child added by the spouse in their own tree) - one hop only, read-only here.
  let extRels = [];
  try {
    const { data: ext, error: xe } = await supabase.rpc('family_one_hop', { p_tree_id: treeId });
    if (!xe && ext) {
      const have = new Set(people.map(p => p.id));
      (ext.persons || []).forEach(p => { if (!have.has(p.id) && !(p.details && p.details.deleted)) { people.push({ ...p, __external: true }); have.add(p.id); } });
      extRels = ext.relationships || [];
    }
  } catch (e) { console.warn('family_one_hop unavailable', e); }
  const ids = people.map(p => p.id);
  let relationships=[]; if (ids.length) { const { data, error } = await supabase.from('relationships').select('*').eq('tree_id', treeId); if (error) throw error; relationships=[...(data||[]), ...extRels.filter(x => !(data||[]).some(d => d.id === x.id))].filter(r=>{ if (r.status==='removed') { removedEdgeKeys.add(edgeKey(r.person_a_id, r.person_b_id, r.relationship_type)); return false; } return ids.includes(r.person_a_id) && ids.includes(r.person_b_id); }).map(r=>({id:r.id,from:r.person_a_id,to:r.person_b_id,type:r.relationship_type,status:r.status,tree_id:r.tree_id})); }
  const { data: posts, error: postErr } = await supabase.from('posts').select('*').eq('tree_id', treeId).order('created_at',{ascending:false}).limit(100); if (postErr) throw postErr;
  const { data: events, error: eventErr } = await supabase.from('events').select('*').eq('tree_id', treeId).order('event_date').limit(100); if (eventErr) throw eventErr;
  const { data: merges, error: mergeErr } = await supabase.from('merge_requests').select('*').order('created_at',{ascending:false}).limit(100); if (mergeErr) throw mergeErr;
  const { data: conns, error: connErr } = await supabase.from('connection_requests').select('*').eq('tree_id', treeId).order('created_at',{ascending:false}); if (connErr) throw connErr;
  const staff = await supabase.from('support_staff').select('profile_id').eq('profile_id', user.id).eq('active',true).maybeSingle();
  const admin = await supabase.from('admin_roles').select('role').eq('profile_id', user.id).limit(1).maybeSingle();
  state.account.role = admin.data?.role || (staff.data ? 'support' : 'member');
  if (state.account.role !== 'member') startSupportPoll();
  const peopleById = Object.fromEntries(people.map(p=>[p.id,p]));
  state.people = people.map(p=>({id:p.id,created_at:p.created_at,personCode:p.person_code,name:p.full_name,gender:p.gender,status:p.status,dob:p.dob,mobile:p.mobile,email:p.email,avatar_url:p.avatar_url,me:p.claimed_by===user.id,claimed_by:p.claimed_by,created_by:p.created_by,privacy:'Family only',nickname:p.nickname,showNickname:p.show_nickname,birthPlace:p.birth_place,currentPlace:p.current_place,lifeStatus:p.life_status,details:p.details||{},treeRole:memberRoleById[p.id]||(p.claimed_by===user.id?'owner':'member'),savedRole:memberRoleById[p.id],external:!!p.__external}));
  state.relationships=relationships;
  try { // the user confirmed an email change from the link we sent -> now sync card + profile with the new login email
    const pend = JSON.parse(localStorage.getItem("ft_pending_email") || "null");
    if (pend && pend.uid === user.id && user.email && user.email.toLowerCase() === pend.email) {
      const mine = state.people.find(x => x.me); if (mine) mine.email = pend.email;
      state.account.email = pend.email;
      await supabase.from("profiles").update({ email: pend.email }).eq("id", user.id);
      localStorage.removeItem("ft_pending_email");
      save();
    }
  } catch (e) { console.warn("email sync failed", e); }
  if (syncSpouseParents()) save();
  state.posts=(posts||[]).map(p=>({id:p.id,author:p.author_profile_id===user.id?state.account.name:'Family Member',text:p.body||'',likes:0,comments:0,author_profile_id:p.author_profile_id}));
  state.events=(events||[]).map(e=>({id:e.id,emoji:'🎉',title:e.title,sub:e.event_date + ' · ' + e.event_type,date:e.event_date,type:e.event_type}));
  state.mergeRequests=(merges||[]).map(r=>({id:r.id,a:peopleById[r.source_person_id]?.full_name||r.source_person_id,b:peopleById[r.target_person_id]?.full_name||r.target_person_id,keptId:r.target_person_id,removedId:r.source_person_id,status:r.status==='completed'?'Merged':'Pending'}));
  state.connections=(conns||[]).map(c=>({id:c.id,name:peopleById[c.person_id]?.full_name||'Family member',relation:peopleById[c.person_id]?deriveRelationship(people.find(p=>p.claimed_by===user.id)?.id,c.person_id).label:'Family member',status:c.status==='approved'?'connected':'pending',requestId:c.id}));
  await loadSupportTickets(user);
  if (isStaff()) { const w = state.tickets.filter(t => t.needsReply).length; if (w) setTimeout(() => toast(`${w} support ticket(s) reply ka intezaar kar rahe hain`), 1200); }
  activeTicketId=state.tickets[0]?.id||null;
  try { const ic = await supabase.rpc('my_incoming_claims'); state.incomingClaims = ic.error ? [] : (ic.data || []); } catch (e) { state.incomingClaims = []; }
  try { const inc = await supabase.rpc('my_incoming_connections'); state.incoming = inc.error ? [] : (inc.data || []); } catch (e) { state.incoming = []; }
  try { const ij = await supabase.rpc('my_incoming_join_requests'); state.incomingJoins = ij.error ? [] : (ij.data || []); } catch (e) { state.incomingJoins = []; }
  if (state.incomingJoins.length) setTimeout(() => toast(`${state.incomingJoins.length} naye member tree join karna chahte hain — Connections & Sharing mein dekhein`), 900);
  if (state.incoming.length) setTimeout(() => toast(`You have ${state.incoming.length} connection request${state.incoming.length === 1 ? "" : "s"} — see Connections & Sharing`), 600);
}

supabase?.auth.onAuthStateChange((event, session) => {
  if (event === 'SIGNED_OUT') { loggedIn = false; render(); return; }
  if ((event === 'SIGNED_IN' || event === 'INITIAL_SESSION') && session?.user) {
    // boot only when we are not already logged in as this user (SIGNED_IN also fires on tab refocus)
    if (!(loggedIn && currentUser?.id === session.user.id)) setTimeout(bootAuthenticatedApp, 0);
  }
  if ((event === 'TOKEN_REFRESHED' || event === 'USER_UPDATED') && session?.user) currentUser = session.user; // no full reload on every token refresh
});

/* An invite link is /?invite=TOKEN (or #invite=TOKEN). Keep the token, then clean the URL so it is not left in history. */
try {
  const sp = new URLSearchParams(location.search), hp = new URLSearchParams(location.hash.replace(/^#/, ""));
  const tk = sp.get("invite") || hp.get("invite");
  if (tk && /^[0-9a-f]{32,128}$/i.test(tk)) {
    localStorage.setItem(INVITE_KEY, tk);
    sp.delete("invite"); hp.delete("invite");
    const q = sp.toString(), h = hp.toString();
    history.replaceState(null, "", location.pathname + (q ? "?" + q : "") + (h ? "#" + h : ""));
  }
} catch (e) { console.warn("invite link parse failed", e); }

bootAuthenticatedApp();
