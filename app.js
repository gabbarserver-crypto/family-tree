import { supabase, supabaseConfigured, signInWithGoogle, sendPhoneOtp, verifyPhoneOtp } from "./supabase.js";
import { importGedcomFile } from "./gedcom.js";

/* ==========================================================================
   FamilyTree — integrated app (V1 core + V3 Tree, V4 Merge, V5 Profiles,
   V6 Wall/Events, V8 Reels, V9 Sharing, V10 Admin, V11 Support/Production)
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
  reels: [
    { id: 1, author: "Priya Sharma", initials: "PS", caption: "Family dinner memories ❤️", likes: 12, comments: 3, grad: "linear-gradient(160deg,#3a2f66,#1b1224 60%,#5c3a30)" },
    { id: 2, author: "Rahul Sharma", initials: "RS", caption: "Wedding celebration 🎉", likes: 28, comments: 7, grad: "linear-gradient(160deg,#5c3660,#1b1224)" },
    { id: 3, author: "Amit Sharma", initials: "AS", caption: "Family trip memories 🚗", likes: 19, comments: 4, grad: "linear-gradient(160deg,#2c5850,#141a22)" }
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
    { text: "Moderator hid reported reel", time: "18 min ago" },
    { text: "Admin suspended account", time: "1 hr ago" }
  ]
};

let state = { account: {}, people: [], relationships: [], connections: [], mergeRequests: [], events: [], posts: [], reels: [], tickets: [], audit: [], treeId: null };
let loggedIn = false;
let currentUser = null;
let treeScale = 1;
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

async function persistState() {
  if (treeViewing) return; // read-only while viewing another person's tree
  if (!supabase || !currentUser || !state.treeId) return;
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
  if (p.avatar_url) return `<div class="avatar ${cls}" style="padding:0;overflow:hidden"><img src="${esc(p.avatar_url)}" alt="${esc(p.name)}" style="width:100%;height:100%;object-fit:cover;border-radius:inherit"></div>`;
  const [bg, fg] = avatarPalette(p);
  return `<div class="avatar ${cls}" style="background:${bg};color:${fg}">${esc(initials(p.name))}</div>`;
}
/* Gender-based tint (blue/rose, the common family-tree convention), with a
   deterministic hash-based fallback palette when gender isn't set, so the
   same person always gets the same color without needing to store one. */
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
/* Anyone can add relatives directly onto their own card, even if they're
   not a tree owner/admin. Everyone else's card still needs edit rights. */
function canAddRelativeTo(targetId) { if (treeViewing) return false; return canEditTree() || targetId === me().id; }
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
  state.relationships.push(e);
  return e;
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
  const gen = { [xId]: 0 };
  spousesOf(xId).forEach(sp => { gen[sp] = 0; }); // her husband only (no his parents / no her children)
  const parents = parentsOf(xId);
  parents.forEach(pa => { gen[pa] = -1; });
  parents.forEach(pa => spousesOf(pa).forEach(sp => { if (!(sp in gen)) gen[sp] = -1; }));
  // siblings + their spouses + all their descendants
  const down = (id, g) => {
    if (id in gen && id !== xId) { /* already placed */ }
    childrenOf(id).forEach(c => {
      if (c === xId || c in gen) return;
      gen[c] = g + 1;
      spousesOf(c).forEach(sp => { if (!(sp in gen)) gen[sp] = g + 1; });
      down(c, g + 1);
    });
  };
  parents.forEach(pa => down(pa, -1));
  return gen;
}
function openBranch(id) {
  if (!personById(id)) return;
  if (!parentsOf(id).length) { toast("Is ke parents ki details abhi add nahi hain"); return; }
  if (!branchView) branchView = { prevCenter: treeCenterId };
  branchView.id = id;
  treeExpanded = new Set();
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
const NAV = [
  { group: "Family", items: [
    ["home", "Home", "🏠"], ["tree", "My Tree", "🌳"], ["people", "People", "👨‍👩‍👧"],
    ["add", "Add Person", "➕"], ["merge", "Merge", "🔀"], ["relationship", "Relationship", "🔗"],
    ["treeAdmins", "Tree Admins", "👑"]
  ]},
  { group: "Social", items: [
    ["wall", "Family Wall", "📝"], ["reels", "Reels", "🎬"], ["sharing", "Connections", "🔗🤝"]
  ]},
  { group: "Account", items: [
    ["profile", "My Profile", "👤"], ["support", "Support", "🎧"]
  ]}
];
const ADMIN_NAV = { group: "Admin", items: [ ["admin", "Admin & Safety", "🛡️"], ["production", "Production", "🚀"] ] };

function navHTML(page) {
  const groups = NAV.map(g => ({ group: g.group, items: g.items.filter(([id]) => id !== "add" || canEditTree()) }));
  if (isStaff()) groups.push(ADMIN_NAV);
  return groups.map(g => `<div class="navgroup"><div class="navgroup-label">${g.group}</div>${
    g.items.map(([id, label, icon]) => navItem(id, label, icon, page)).join("")
  }</div>`).join("") + `<button class="nav logout"><span class="ic">🚪</span><span onclick="logout()">Logout</span></button>`;
}
function navItem(id, label, icon, page) {
  return `<button class="nav ${page === id ? "active" : ""}" onclick="go('${id}')"><span class="ic">${icon}</span><span>${label}</span></button>`;
}
function go(id) { location.hash = id; window.scrollTo(0, 0); render(); }

/* ---------------- login ---------------- */
function renderLogin() {
  document.getElementById("app").innerHTML = `<main class="login"><section class="login-card">
  <div class="eyebrow">Welcome to</div>
  <div class="brand"><img src="/assets/logo.png" alt="FamilyTree" style="height:64px;width:64px;object-fit:contain;vertical-align:middle;margin-right:8px"> Family<em>Tree</em></div>
  <h1>Roots, remembered.</h1>
  <p class="muted">Build your family tree, connect with relatives, and keep memories in one place.</p>
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
async function logout() { skipClaimSearch = false; if (supabase) await supabase.auth.signOut(); loggedIn = false; currentUser = null; state = { account: {}, people: [], relationships: [], connections: [], mergeRequests: [], events: [], posts: [], reels: [], tickets: [], audit: [], treeId: null }; location.hash = 'home'; render(); }

/* ---------------- shell ---------------- */
function topCenterHTML(page) {
  if (page !== "tree" && page !== "wall") return "";
  const search = page === "tree" ? `<input id="treeSearch" class="top-search" placeholder="Search by name or Person ID…" list="treeSearchList" onchange="treeSearch(this.value)"><datalist id="treeSearchList">${state.people.map(p => `<option value="${esc(p.name)} (${p.id})">`).join("")}</datalist>` : "";
  return `<div class="topbar-center"><span class="top-title">${treeViewing ? esc(treeViewing.ownerName) + "'s Family Tree" : "My Family Tree"}</span>${search}<div class="view-switch"><button class="${page === "tree" ? "active" : ""}" onclick="go('tree')">Family Tree</button><button class="${page === "wall" ? "active" : ""}" onclick="go('wall')">Family Wall</button></div></div>`;
}
function render() {
  if (!loggedIn) { renderLogin(); return; }
  const page = (location.hash || "#home").slice(1);
  if (treeViewing && page !== "tree" && page !== "profile") exitTreeView(false);
  const app = document.getElementById("app");
  const flatNav = NAV.flatMap(g => g.items).filter(([id]) => id !== "add" || canEditTree()).concat(isStaff() ? ADMIN_NAV.items : []);
  app.innerHTML = `<div class="shell">
    <header class="topbar">
      <div class="brand"><img src="/assets/logo.png" alt="FamilyTree" style="height:32px;width:32px;object-fit:contain;vertical-align:middle;margin-right:6px"> Family<em>Tree</em><small>V11</small></div>
      ${topCenterHTML(page)}
      <div class="top-actions">
        
        <span class="muted" style="font-size:13px;cursor:pointer" title="My Profile" onclick="openMyProfile()">${esc(state.account.name)}</span>
        <div style="cursor:pointer" title="My Profile" onclick="openMyProfile()">${myself() ? avatarHTML(myself()) : `<div class="avatar">${esc(initials(state.account.name))}</div>`}</div>
      </div>
    </header>
    <div class="layout">
      <aside class="sidebar">${navHTML(page)}</aside>
      <main class="content${page === "tree" ? " content-wide" : ""}">${pageView(page)}</main>
    </div>
    <nav class="bottomnav">${flatNav.slice(0, 6).map(([id, label, icon]) => navItem(id, label, icon, page)).join("")}</nav>
  </div>`;
  if (page === "tree") requestAnimationFrame(drawTreeConnectors);
  if (page === "merge") mergeInitSelects();
  if (page === "profile") requestAnimationFrame(() => loadMemories(activeProfileId || me()?.id));
}
function switchRole() {}

function pageView(p) {
  const map = {
    home, tree, add, addRelative, people, merge, relationship, profile: () => profile(activeProfileId || me().id),
    wall, reels, sharing, support, admin, production, treeAdmins
  };
  if ((p === "admin" || p === "production") && !isStaff()) return accessDenied();
  if (p === "add" && !canEditTree()) return accessDenied("Tree admin access required", "Only this tree's owner or admins can add relatives. Ask the owner to promote you from the Tree Admins page.");
  if (p === "addRelative" && !canAddRelativeTo(addRelativeTargetId)) return accessDenied("Tree admin access required", "Only this tree's owner or admins can add relatives to other people. Ask the owner to promote you from the Tree Admins page.");
  return (map[p] || home)();
}
function accessDenied(title, msg) {
  return `<div class="empty card"><span class="big">🔒</span><h3>${esc(title || "Staff access required")}</h3><p class="muted">${esc(msg || "Switch the demo role selector above to Admin or Support to view this area.")}</p></div>`;
}

/* ---------------- home ---------------- */
function home() {
  const upcoming = state.events.slice(0, 2);
  return `<div class="page-head"><h2>Family Dashboard</h2><p class="muted">Your family network, based on the logged-in account.</p></div>
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
  </div></div>
  <div class="card"><h3>Import from GEDCOM</h3>
    <p class="muted">Upload a .ged file (from iMeUsWe, Ancestry, MyHeritage, etc.) to add all its people and relationships to your tree.</p>
    <div class="actions">
      <button class="primary" onclick="document.getElementById('gedFile').click()">📥 Import .ged file</button>
      <input type="file" id="gedFile" accept=".ged,.gedcom" hidden onchange="importGedcomPicked(this)">
    </div>
  </div>
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
function tree() {
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
  const banner2 = bp ? `<div class="tree-view-banner"><span><b>${esc(bp.name)}</b> ki family tree (unke parents, bhai-behen aur unke bachhe)</span><button type="button" class="primary" onclick="exitBranch()">← Meri tree par wapas</button></div>` : "";
  return `${banner}${banner2}<div class="tree-canvas" id="treeCanvas">
    <div class="tree-stage" id="treeStage" style="position:relative">
      <svg id="treeLines" style="position:absolute;top:0;left:0;pointer-events:none;overflow:visible"></svg>
      ${rows || "<p class='muted'>No relationships recorded yet — tap the ＋ badge on your card to start the graph.</p>"}
    </div>
  </div>
  <div class="tree-controls">
    <button class="secondary" onclick="treeZoom(1.15)">＋ Zoom</button>
    <button class="secondary" onclick="treeZoom(0.87)">－ Zoom</button>
    <button class="ghost" onclick="treeReset()">Reset</button>
    <button class="ghost" onclick="treeFocusMe()">🎯 Focus Me</button>
  </div>`;
}

function addRelativeNode(typeKey, targetId) {
  const t = RELATION_TYPES[typeKey];
  return `<div class="branch-node add-node" id="${nodeElId(placeholderId(typeKey, targetId))}" onclick="openAddRelative('${targetId}','${typeKey}')">+ Add ${t.label}</div>`;
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
    : isBranchRoot ? "Back to my tree" : branchable ? "Open " + esc(p.name) + "'s family tree" : "Center tree on " + esc(p.name);
  const badgeClick = ownTree ? `openPersonTree('${p.id}')`
    : isBranchRoot ? `exitBranch()` : branchable ? `openBranch('${p.id}')` : (branchView ? `exitBranch()` : `centerTree('${p.id}')`);
  const centerBadge = `<button type="button" class="tree-badge right own-tree" title="${badgeTitle}" onclick="event.stopPropagation();${badgeClick}"><img src="/assets/tree-icon.png" alt="Tree"></button>`;
  const dodYear = p.details?.dod ? new Date(p.details.dod).getFullYear() : "";
  const years = p.dob ? `${new Date(p.dob).getFullYear()} –${dodYear ? " " + dodYear : ""}` : (dodYear ? `– ${dodYear}` : "–");
  return `<div class="branch-node ${p.me ? "me" : ""} ${isCenter && !p.me ? "me" : ""}" id="${nodeElId(p.id)}" style="position:relative;cursor:pointer" title="View profile" onclick="openProfilePopup('${p.id}')">
    ${addBadge}${centerBadge}
    ${avatarHTML(p, "photo" + (p.status !== "unclaimed" ? " claimed" : ""))}
    <strong>${esc(p.name)}</strong>
    <div class="mini">${years}${p.status === "unclaimed" ? " · Unclaimed" : ""}</div>
    <div class="mini rel">${deriveRelationship(me().id, p.id).label}</div>
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

function toggleTreeExpand(id) {
  if (treeExpanded.has(id)) treeExpanded.delete(id); else treeExpanded.add(id);
  render();
  requestAnimationFrame(drawTreeConnectors);
}

function centerTree(id) { branchView = null; treeCenterId = id; treeScale = 1; go("tree"); requestAnimationFrame(drawTreeConnectors); }
function treeSearch(val) {
  const idMatch = val.match(/\(([^)]+)\)\s*$/);
  const id = idMatch ? idMatch[1] : (state.people.find(p => p.name.toLowerCase() === val.toLowerCase())?.id);
  if (id && personById(id)) centerTree(id); else toast("Person not found");
}
function treeZoom(n) { treeScale = Math.max(.5, Math.min(2.2, treeScale * n)); document.getElementById("treeStage").style.transform = `scale(${treeScale})`; requestAnimationFrame(drawTreeConnectors); }
function treeReset() { treeScale = 1; const s = document.getElementById("treeStage"); if (s) s.style.transform = "scale(1)"; requestAnimationFrame(drawTreeConnectors); }
function treeFocusMe() { branchView = null; treeCenterId = me().id; treeReset(); go("tree"); requestAnimationFrame(drawTreeConnectors); }

/* Draw the org-chart style connector lines (branch lines + junction dots)
   between rendered tree nodes, using their actual DOM positions so the
   layout always matches whatever the browser/flexbox produced. */
function drawTreeConnectors() {
  const stage = document.getElementById("treeStage");
  const svg = document.getElementById("treeLines");
  if (!stage || !svg) return;
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
  // Give overlapping families their own horizontal "lane" so bus lines never merge into one tangle.
  const laneGroups = {};
  info.forEach(u => { const k = u.pBottom + "|" + u.kTop; (laneGroups[k] = laneGroups[k] || []).push(u); });
  Object.values(laneGroups).forEach(list => {
    list.sort((a, b) => a.minX - b.minX);
    const lanes = [];
    list.forEach(u => {
      let lane = lanes.findIndex(l => l.every(([a, b]) => u.maxX + 14 < a || u.minX - 14 > b));
      if (lane < 0) { lane = lanes.length; lanes.push([]); }
      lanes[lane].push([u.minX, u.maxX]);
      u.lane = lane;
    });
    list.forEach(u => { u.laneCount = lanes.length; });
  });
  info.forEach(u => {
    const busY = u.pBottom + (u.kTop - u.pBottom) * (u.lane + 1) / (u.laneCount + 1);
    if (u.bottomStart) dot(u.dropX, u.startY);
    line(u.dropX, u.startY, u.dropX, busY);
    if (u.minX < u.maxX) line(u.minX, busY, u.maxX, busY);
    u.kids.forEach(o => { const cx = o.r.x + o.r.w / 2; line(cx, busY, cx, o.r.y); dot(cx, o.r.y); });
  });

  svg.setAttribute("width", stage.scrollWidth);
  svg.setAttribute("height", stage.scrollHeight);
  svg.innerHTML = parts.join("");
}
window.addEventListener("resize", () => { if ((location.hash || "").slice(1) === "tree") drawTreeConnectors(); });

/* ---------------- add person — creates real graph edges ---------------- */
function add() {
  const opts = state.people.map(p => `<option value="${p.id}" ${p.id === me().id ? "selected" : ""}>${esc(p.name)} — ${p.id}</option>`).join("");
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
      <select id="arRelType" onchange="refreshExistingOptions()">${Object.entries(RELATION_TYPES).map(([k, v]) => `<option value="${k}" ${k === addRelativeTypeKey ? "selected" : ""}>${v.label}</option>`).join("")}</select>
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
  </div>
  <div class="card">
    <details><summary>💍 Marriage Details</summary>
      <div class="form" style="margin-top:10px">
        <div class="field"><label>Spouse name</label><input id="arMarriageSpouse" placeholder="Optional"></div>
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
    if (sp.length === 1 && addEdge(sp[0], c.id, "parent")) changed = true;
  });
  return changed;
}
async function saveAddRelative() {
  if ((RELATION_TYPES[document.getElementById("arRelType")?.value] || {}).edgeType === "sibling" && !parentsOf(addRelativeTargetId).length) {
    toast("Brother/Sister add karne ke liye pehle is person ke parents (Father/Mother) add karein"); return;
  }
  if (!canAddRelativeTo(addRelativeTargetId)) { toast("Only this tree's owner or admins can add relatives to other people"); return; }
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
    id, personCode: "P-" + Math.floor(10000 + Math.random() * 89999), name, gender: t.gender,
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
  let rows = state.people.map(p => ({ p, label: p.me ? "Self" : deriveRelationship(me().id, p.id).label }));
  if (q) rows = rows.filter(({ p, label }) => [p.name, p.id, p.personCode, p.birthPlace, p.currentPlace, label].some(v => (v || "").toString().toLowerCase().includes(q)));
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
  return count + `<div class="list">${rows.map(({ p, label }) => `<div class="row" style="cursor:pointer" onclick="openProfile('${p.id}')">
    <div style="display:flex;gap:12px;align-items:center">${avatarHTML(p)}<div><strong>${esc(p.name)}</strong><div class="muted" style="font-size:12.5px">${esc(label)} · ${p.id}</div></div></div>
    <div style="display:flex;gap:8px;align-items:center">${p.status === "unclaimed" ? '<span class="badge">Unclaimed</span>' : '<span class="badge sage">Claimed</span>'}${canDeletePerson(p) ? `<button type="button" class="danger" style="padding:6px 12px;font-size:12.5px" title="Delete this profile" onclick="event.stopPropagation();deletePerson('${esc(p.id)}')">🗑 Delete</button>` : ""}</div>
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
      <p class="muted">Person ID: <strong>${p.id}</strong> · ${p.status === "unclaimed" ? '<span class="badge">Unclaimed</span>' : '<span class="badge sage">Claimed</span>'}</p>
      <hr class="divider">
      <p><strong>About:</strong> ${esc(p.about) || "Family profile information can be shown here."}</p>
      <p><strong>Relation:</strong> ${p.me ? "Self" : deriveRelationship(me().id, p.id).label}${p.gender ? ` · <strong>Gender:</strong> ${esc(p.gender)}` : ""}${p.dob ? ` · <strong>DOB:</strong> ${p.dob}` : ""}${p.mobile ? ` · <strong>Mobile:</strong> ${esc(p.mobile)}` : ""}</p>
      <div class="field" style="max-width:240px;margin-top:10px"><label>Privacy</label>
        <select onchange="setPrivacy('${p.id}',this.value)"><option ${p.privacy === "Family only" || !p.privacy ? "selected" : ""}>Family only</option><option ${p.privacy === "Private" ? "selected" : ""}>Private</option><option ${p.privacy === "Selected family" ? "selected" : ""}>Selected family</option><option ${p.privacy === "Public" ? "selected" : ""}>Public</option></select>
      </div>
    </div>
  </div>
  ${canEditPerson(p) ? personDetailsCard(p) : ""}
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
  if (supabase && currentUser && state.treeId) {
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
function fmtDate(d) { if (!d) return ""; const x = new Date(d); return Number.isNaN(x.getTime()) ? String(d) : x.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }); }
/* Read-only details card on the profile page, with an Edit button that opens the popup form. */
function detailRowsHTML(p) {
  const n = nameParts(p), d = p.details || {};
  const row = (label, val) => `<div class="row"><span class="muted">${label}</span><span>${val ? esc(val) : "—"}</span></div>`;
  const married = d.married === "yes" ? "Married" : d.married === "no" ? "Unmarried" : "";
  return `${row("First name", n.first)}${row("Middle name", n.middle)}${row("Surname", n.last)}
    ${row("Gender", p.gender)}
    ${row("Date of birth", fmtDate(p.dob))}${row("Date of death", fmtDate(d.dod))}
    ${row("Mobile", p.mobile)}${row("Email", p.email)}
    ${row("State", d.state)}${row("City", d.city)}${row("Married", married)}`;
}
/* Read-only details card on the profile page, with an Edit button that opens the popup form. */
function personDetailsCard(p) {
  return `<div class="card"><div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:8px">
      <h3 style="margin:0">Personal details</h3>
      <div style="display:flex;gap:8px;flex-wrap:wrap">${p.me ? `<button class="secondary" onclick="openChangeEmail('${esc(p.id)}')">✉️ Change email</button>` : ""}${canEditPerson(p) ? `<button class="secondary" onclick="openEditProfile('${esc(p.id)}')">✏️ Edit</button>` : ""}${canDeletePerson(p) ? `<button class="danger" onclick="deletePerson('${esc(p.id)}')">🗑 Delete profile</button>` : ""}</div>
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
    <div class="field"><label>Date of Death</label><input id="mpDod" type="date" value="${v(d.dod)}"></div>
    <div class="field"><label>Mobile</label><input id="mpMobile" type="tel" value="${v(p.mobile)}" placeholder="+91 98XXXXXXXX"></div>
    <div class="field"><label>Email (Gmail)</label><input id="mpEmail" type="email" value="${v(p.email)}" placeholder="name@gmail.com"></div>
    <div class="field"><label>State</label><input id="mpState" value="${v(d.state)}" placeholder="State"></div>
    <div class="field"><label>City</label><input id="mpCity" value="${v(d.city)}" placeholder="City"></div>
    <div class="field"><label>Married</label>
      <select id="mpMarried"><option value="" ${d.married ? "" : "selected"}>— Select —</option><option value="yes" ${d.married === "yes" ? "selected" : ""}>Married</option><option value="no" ${d.married === "no" ? "selected" : ""}>Unmarried</option></select>
    </div>`;
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
        <div class="muted" style="font-size:12.5px;margin:2px 0 6px">${esc(rel)} · ${esc(p.personCode || p.id)}</div>
        ${p.status === "unclaimed" ? '<span class="badge">Unclaimed</span>' : '<span class="badge sage">Claimed</span>'}</div></div>
      <div>${detailRowsHTML(p)}</div>
    </div>
    <div class="actions modal-foot">
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
async function saveNewEmail(id) {
  const p = personById(id);
  if (!p || !p.me) { toast("You can only change your own email"); return; }
  const email = document.getElementById("mpNewEmail").value.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { toast("Please enter a valid email"); return; }
  if (email === (p.email || "").toLowerCase()) { toast("This is already your email"); return; }
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
  const dob = g("mpDob"), dod = g("mpDod");
  if (dob && dod && dod < dob) { toast("Date of death can't be before date of birth"); return; }
  p.name = [first, middle, last].filter(Boolean).join(" ");
  p.gender = document.getElementById("mpGender").value || undefined;
  p.dob = dob || undefined;
  p.mobile = mobile || undefined;
  p.email = email || undefined;
  p.lifeStatus = dod ? "deceased" : "living";
  p.details = { ...(p.details || {}), firstName: first, middleName: middle, surname: last, dod: dod || "", state: g("mpState"), city: g("mpCity"), married: document.getElementById("mpMarried").value };
  if (p.me) { state.account.name = p.name; if (email) state.account.email = email; }
  await save();
  if (p.me && supabase && currentUser) { try { await supabase.from("profiles").update({ display_name: p.name, ...(email ? { email } : {}) }).eq("id", currentUser.id); } catch (e) { console.warn("display_name update failed", e); } }
  toast("Profile updated");
  render();
  if (profileModalOrigin === "view") openProfilePopup(id); else closeEditProfile();
}
function setPrivacy(id, val) { const p = state.people.find(x => x.id === id); if (p) { p.privacy = val; save(); toast("Privacy set to " + val); } }

function changePhoto(id) {
  if (!supabase || !currentUser) { toast("Please sign in to upload a photo"); return; }
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "image/png,image/jpeg,image/webp,image/gif";
  input.onchange = async () => {
    const file = input.files && input.files[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) { toast("Please choose an image file"); return; }
    if (file.size > 5 * 1024 * 1024) { toast("Image must be under 5MB"); return; }
    toast("Uploading photo…");
    try {
      const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
      const path = `${currentUser.id}/${id}-${Date.now()}.${ext}`;
      const { error: upErr } = await supabase.storage.from("avatars").upload(path, file, { upsert: true, cacheControl: "3600" });
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
  };
  input.click();
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
/* Group likely duplicates (same / near-same name) using union-find. */
function findDuplicateGroups() {
  const list = mergeCandidates();
  const parent = {}; list.forEach(p => parent[p.id] = p.id);
  const find = x => parent[x] === x ? x : (parent[x] = find(parent[x]));
  for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
    const a = list[i], b = list[j];
    if (a.gender && b.gender && a.gender !== b.gender) continue;
    if (sameNameLoose(a.name, b.name)) parent[find(a.id)] = find(b.id);
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
  const people = mergeCandidates().slice().sort((a, b) => a.name.localeCompare(b.name));
  const opt = p => `<option value="${esc(p.id)}">${esc(p.name)}${p.me ? " (You)" : ""}${p.external ? " (dusri tree)" : ""} — ${esc(personHint(p))}</option>`;
  const optsA = people.map(opt).join("");
  const groups = findDuplicateGroups();
  const direct = canMergeDirect();
  const dupCard = groups.length ? `<div class="card">
    <h3>Suggested duplicates (${groups.length})</h3>
    <p class="muted">Same naam wale profiles mile. Jo merge karne hain unhe tick karo — pehla naam (✓ Keep) rakha jayega, baaki uske andar merge honge.</p>
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
    <div class="field"><label>Profile A</label><select id="ma">${optsA}</select></div>
    <div class="field"><label>Profile B</label><select id="mb">${optsA}</select></div>
    <button class="secondary" style="justify-self:start" onclick="compareMerge()">Compare Profiles</button>
  </div>
  <div id="mergeCompare"></div>
  <div class="card"><h3>Requests</h3>${state.mergeRequests.length ? state.mergeRequests.map((r, i) => `<div class="row"><span>${esc(r.a)} ↔ ${esc(r.b)}</span><span class="badge ${r.status === "Merged" ? "sage" : ""}">${esc(r.status)}</span>${r.status === "Pending" && (isStaff() || canEditTree()) ? `<button class="secondary" onclick="approveMerge(${i})">Approve &amp; Merge</button>` : ""}</div>`).join("") : "<p class='muted'>No requests yet.</p>"}</div>`;
}
/* Make Profile B default to a different person than A so "Compare" works straight away. */
function mergeInitSelects() {
  const a = document.getElementById("ma"), b = document.getElementById("mb");
  if (a && b && b.options.length > 1 && a.value === b.value) b.selectedIndex = 1;
}
function compareMerge() {
  const a = personById(document.getElementById("ma").value);
  const b = personById(document.getElementById("mb").value);
  const box = document.getElementById("mergeCompare");
  if (!a || !b) return;
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
    <p class="muted" style="margin-top:8px">Relationship path: ${result.chain.map(n => `<b>${n}</b>`).join(" → ")}</p>
  </div>`;
}

/* ---------------- V6: family wall ---------------- */
function wall() {
  return `<div class="page-head"><h2>Family Wall</h2><p class="muted">Share updates and keep track of family events.</p></div>
  <div class="card"><h3>Create Post</h3>
    <textarea id="postText" placeholder="Share something with your family..."></textarea>
    <div class="actions" style="margin-top:10px">
      <button class="primary" onclick="publishPost()">Publish</button>
      <button class="secondary" onclick="toast('Demo: photo picker')">📷 Photo</button>
      <button class="secondary" onclick="toast('Demo: event composer')">🎉 Event</button>
    </div>
  </div>
  <div class="card"><h3>Upcoming Family Events</h3>${state.events.map(e => `<div class="event-chip"><span class="em">${e.emoji}</span><div><strong>${esc(e.title)}</strong><div class="muted" style="font-size:12.5px">${e.sub}</div></div></div>`).join("")}</div>
  <div class="card" id="feed"><h3>Feed</h3>${state.posts.map(postHTML).join("")}</div>`;
}
function postHTML(p) { return `<div class="post" data-id="${p.id}"><div class="post-head"><div class="avatar">${esc(initials(p.author))}</div><strong>${esc(p.author)}</strong></div><p>${esc(p.text)}</p><div class="actions"><button class="ghost" onclick="likePost(${p.id})">❤️ ${p.likes}</button><button class="ghost">💬 ${p.comments}</button></div></div>`; }
async function publishPost() {
  const t = document.getElementById("postText").value.trim(); if (!t) return;
  if (supabase) { const {error}=await supabase.from('posts').insert({author_profile_id:currentUser.id,tree_id:state.treeId,body:t,post_type:'text',visibility:'family'}); if(error) return toast(error.message); await loadProductionState(currentUser); }
  else state.posts.unshift({ id: crypto.randomUUID(), author: state.account.name, text: t, likes: 0, comments: 0 });
  document.getElementById("postText").value = ""; go("wall");
}
function likePost(id) { const p = state.posts.find(x => x.id === id); if (p) { p.likes++; save(); go("wall"); } }

/* ---------------- V8: reels ---------------- */
function reels() {
  return `<div class="page-head"><h2>Reels</h2><p class="muted">Short family videos — family only.</p></div>
  <button class="primary" style="margin-bottom:12px" onclick="toast('Demo: upload reel → Supabase Storage')">＋ Upload Reel</button>
  <div class="reels-wrap"><div class="reels-feed">${state.reels.map(r => `
    <section class="reel" style="background:${r.grad}"><div class="grad"></div>
      <div class="info"><div class="avatar" style="background:#fff;color:var(--plum)">${r.initials}</div><h2 style="color:#fff;margin-top:8px">${esc(r.author)}</h2><p>${esc(r.caption)}</p><small>${r.likes} likes · ${r.comments} comments</small></div>
      <div class="actions-side">
        <button class="action" onclick="likeReel(${r.id},this)">♡</button>
        <button class="action" onclick="toast('Comments')">💬</button>
        <button class="action" onclick="toast('Reported')">⋮</button>
      </div>
    </section>`).join("")}</div></div>`;
}
function likeReel(id, btn) { btn.textContent = btn.textContent.trim() === "♡" ? "♥" : "♡"; const r = state.reels.find(x => x.id === id); if (r) { r.likes += btn.textContent === "♥" ? 1 : -1; save(); } }

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
  ${(state.incomingClaims || []).length ? `<div class="card"><h3>Profile claim requests</h3>${state.incomingClaims.map(r => `<div class="row"><span><b>${esc(r.requester_name || "Someone")}</b> says the profile <b>${esc(r.person_name)}</b> that you added is them.<br><span class="muted" style="font-size:12.5px">Approve only if you know this person. They will get control of that profile.</span></span>
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
function support() {
  if (isStaff()) return supportDashboard();
  const mine = state.tickets;
  return `<div class="page-head"><h2>Support</h2><p class="muted">Get help from the FamilyTree support team.</p></div>
  <div class="card"><h3>My Tickets</h3>${mine.map(t => `<div class="row"><span><b>${t.id}</b> · ${esc(t.category)}<br><small class="muted">${esc(t.subject)}</small></span><span class="badge ${t.priority === "Urgent" ? "terracotta" : t.priority === "High" ? "" : "plum"}">${t.priority}</span></div>`).join("")}</div>
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
  const t = state.tickets;
  const counts = { open: t.filter(x => x.status === "Open").length, progress: t.filter(x => x.status === "In Progress").length, urgent: t.filter(x => x.priority === "Urgent").length, resolved: t.filter(x => x.status === "Resolved").length };
  const active = t.find(x => x.id === activeTicketId) || t[0];
  activeTicketId = active?.id;
  return `<div class="page-head"><h2>🎧 Support Center</h2><p class="muted">Support staff are not family members — access is limited to what's needed to resolve each ticket.</p></div>
  <div class="grid g4">
    <div class="card stat-card"><div class="muted">Open</div><div class="stat">${counts.open}</div></div>
    <div class="card stat-card"><div class="muted">In Progress</div><div class="stat warn">${counts.progress}</div></div>
    <div class="card stat-card"><div class="muted">Urgent</div><div class="stat" style="color:var(--terracotta)">${counts.urgent}</div></div>
    <div class="card stat-card"><div class="muted">Resolved</div><div class="stat ok">${counts.resolved}</div></div>
  </div>
  <div class="card"><h3>Support Queue</h3>${t.map(x => `<div class="row"><span><b>${x.id}</b> · ${esc(x.category)}<br><small class="muted">${esc(x.subject)}</small></span><span class="badge ${x.priority === "Urgent" ? "terracotta" : "plum"}">${x.priority}</span><button class="secondary" onclick="openTicket('${x.id}')">Open</button></div>`).join("")}</div>
  ${active ? `<div class="card"><h3 id="ticketTitle">Ticket ${active.id} — ${esc(active.subject)}</h3>
  <div class="chat" id="chat">${active.messages.map(m => `<div class="msg ${m.from}">${esc(m.text)}</div>`).join("")}</div>
  <textarea id="reply" placeholder="Write a reply..." style="margin-top:10px"></textarea>
  <div class="actions" style="margin-top:8px">
    <button class="primary" onclick="sendReply()">Send Reply</button>
    <button class="secondary" onclick="toast('Ticket assigned to Support Staff')">Assign</button>
    <button class="danger" onclick="resolveTicket()">Resolve</button>
  </div></div>` : ""}`;
}
function openTicket(id) { activeTicketId = id; go("support"); }
async function sendReply() {
  const box = document.getElementById("reply"); const val = box.value.trim(); if (!val) return;
  const t = state.tickets.find(x => x.id === activeTicketId); if(!t) return;
  if(supabase){ const {data:ticket}=await supabase.from('support_tickets').select('id').eq('ticket_code',activeTicketId).single(); if(ticket){ const {error}=await supabase.from('support_messages').insert({ticket_id:ticket.id,sender_profile_id:currentUser.id,message:val}); if(error) return toast(error.message); await supabase.from('support_tickets').update({status:'in_progress'}).eq('id',ticket.id); await loadProductionState(currentUser); } }
  else { t.messages.push({ from: "staff", text: val }); t.status = "In Progress"; }
  go("support");
}
async function resolveTicket() { const t = state.tickets.find(x => x.id === activeTicketId); if (!t) return; if(supabase){ const {data:ticket}=await supabase.from('support_tickets').select('id').eq('ticket_code',activeTicketId).single(); if(ticket) await supabase.from('support_tickets').update({status:'resolved',resolved_at:new Date().toISOString()}).eq('id',ticket.id); await loadProductionState(currentUser); } else t.status='Resolved'; toast('Ticket marked resolved'); go('support'); }

/* ---------------- V10: admin & safety ---------------- */
function admin() {
  return `<div class="page-head"><h2>🛡️ Admin &amp; Safety</h2><p class="muted">Management area. Admin privileges are separate from family-tree membership.</p></div>
  <div class="grid">
    <div class="card stat-card"><div class="muted">Users</div><div class="stat">${1284}</div></div>
    <div class="card stat-card"><div class="muted">Merge Requests</div><div class="stat">${state.mergeRequests.length}</div></div>
    <div class="card stat-card"><div class="muted">Connections</div><div class="stat">${state.connections.length}</div></div>
  </div>
  <div class="card"><h3>Moderation Queue</h3>
    <div class="row"><span><b>Reported Reel</b><br><span class="muted" style="font-size:12.5px">Reason: inappropriate content</span></span><button class="secondary" onclick="reviewItem(this)">Review</button></div>
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
  const owners = state.people.filter(p => personTreeRole(p) === "owner");
  const admins = state.people.filter(p => personTreeRole(p) === "admin");
  const members = state.people.filter(p => personTreeRole(p) === "member");
  const rowFor = p => {
    const role = personTreeRole(p);
    const canManage = isTreeOwner() && role !== "owner";
    return `<div class="row">
      <span style="display:flex;align-items:center;gap:10px">${avatarHTML(p)}<span>${esc(p.name)}${p.me ? " <span class='muted' style='font-size:12px'>(You)</span>" : ""}</span></span>
      <span style="display:flex;align-items:center;gap:8px">
        <span class="badge ${treeRoleBadgeClass(role)}">${treeRoleLabel(role)}</span>
        ${canManage ? (role === "admin"
          ? `<button class="ghost" onclick="setTreeRole('${p.id}','member')">Remove Admin</button>`
          : `<button class="secondary" onclick="setTreeRole('${p.id}','admin')">Make Admin</button>`) : ""}
      </span>
    </div>`;
  };
  return `<div class="page-head"><h2>👑 Tree Admins</h2><p class="muted">People who can add and edit relatives in <b>${esc(me()?.name || "your")}'s</b> family tree. Admins can manage this tree only — not other people's trees.</p></div>
  ${!isTreeOwner() ? `<div class="card" style="margin-bottom:14px"><span class="muted">Only the tree owner (${esc(owners[0]?.name || "—")}) can promote or remove admins. You can view the list below.</span></div>` : ""}
  <div class="card"><h3>Owner</h3>${owners.length ? owners.map(rowFor).join("") : "<p class='muted'>No owner set.</p>"}</div>
  <div class="card"><h3>Admins <span class="muted" style="font-size:12.5px;font-weight:400">— can add &amp; edit relatives in this tree</span></h3>
    ${admins.length ? admins.map(rowFor).join("") : "<p class='muted'>No admins yet. Promote a family member below.</p>"}
  </div>
  <div class="card"><h3>Members</h3>
    ${members.length ? members.map(rowFor).join("") : "<p class='muted'>No other members yet.</p>"}
  </div>`;
}
function setTreeRole(personId, role) {
  if (!isTreeOwner()) { toast("Only the tree owner can change admin roles"); return; }
  const p = personById(personId);
  if (!p) return;
  if (personTreeRole(p) === "owner") { toast("Can't change the owner's role"); return; }
  p.treeRole = role;
  save();
  toast(role === "admin" ? `${p.name} is now an admin of this tree` : `${p.name} is no longer an admin`);
  go("treeAdmins");
}

/* ---------------- V11: production dashboard ---------------- */
function production() {
  return `<div class="page-head"><h2>🚀 Production Dashboard</h2><p class="muted">System health and release pipeline.</p></div>
  <div class="grid g4">
    <div class="card stat-card"><span class="muted">Users</span><div class="stat">1,284</div></div>
    <div class="card stat-card"><span class="muted">Family Trees</span><div class="stat">347</div></div>
    <div class="card stat-card"><span class="muted">Reels</span><div class="stat">5,821</div></div>
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
async function importGedcomPicked(inputEl) {
  const file = inputEl.files && inputEl.files[0];
  inputEl.value = "";                       // allow picking the same file again
  if (!file) return;
  if (treeViewing) return toast("Read-only while viewing another person's tree");
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
  openPersonTree, exitTreeView, openBranch, exitBranch,
  openChangeEmail, saveNewEmail,
  acceptConnection, addRelative, approveMerge, centerTree, changePhoto, compareMerge, mergeSelectedGroups,
  createPerson, createTicket, findPerson, findRelation, go, googleLogin,
  invite, likePost, likeReel, logout, openAddRelative, openProfile, openTicket,
  phoneLogin, pickAddRelativePhoto, publishPost, requestMerge, resolveTicket,
  reviewItem, saveAddRelative, sendReply, shareId, toast, treeFocusMe,
  treeReset, treeZoom, toggleTreeExpand, treeSearch, setTreeRole,
  setAddRelativeMode, refreshExistingOptions, openMyProfile, saveProfileEdits, openEditProfile, closeEditProfile, openProfilePopup, openFullProfile, cancelEditProfile, deletePerson, searchRelativeByUid, linkByUniqueId, approveIncoming, rejectIncoming,
  loadMemories, addMemory, deleteMemory,
  runClaimSearch, requestClaim, cancelClaim, startFreshProfile, approveClaim, rejectClaim,
  importGedcomPicked, setPeopleSearch, clearPeopleSearch, setPeopleSort
});

window.addEventListener("hashchange", render);

async function bootAuthenticatedApp() {
  if (!supabase) { renderLogin(); return; }
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) { loggedIn = false; renderLogin(); return; }
  currentUser = user;
  loggedIn = true;
  try {
    await ensureProfileAndTree(user);
    if (await needsClaimStep(user)) { await renderClaimStep(); return; }
    await loadProductionState(user);
    render();
  } catch (e) { console.error(e); toast('Could not load your family data: ' + e.message); render(); }
}

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
    <p class="muted">A relative may already have added you to the family tree. Search below instead of creating a duplicate. The more details you fill, the narrower the results.</p>
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
    <button class="primary" onclick="requestClaim('${esc(r.person_id)}')">This is me</button></div>`).join('');
}
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

async function loadProductionState(user) {
  treeViewing = null;
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
  let relationships=[]; if (ids.length) { const { data, error } = await supabase.from('relationships').select('*').eq('tree_id', treeId); if (error) throw error; relationships=[...(data||[]), ...extRels.filter(x => !(data||[]).some(d => d.id === x.id))].filter(r=>r.status!=='removed' && ids.includes(r.person_a_id) && ids.includes(r.person_b_id)).map(r=>({id:r.id,from:r.person_a_id,to:r.person_b_id,type:r.relationship_type,status:r.status,tree_id:r.tree_id})); }
  const { data: posts, error: postErr } = await supabase.from('posts').select('*').eq('tree_id', treeId).order('created_at',{ascending:false}).limit(100); if (postErr) throw postErr;
  const { data: events, error: eventErr } = await supabase.from('events').select('*').eq('tree_id', treeId).order('event_date').limit(100); if (eventErr) throw eventErr;
  const { data: merges, error: mergeErr } = await supabase.from('merge_requests').select('*').order('created_at',{ascending:false}).limit(100); if (mergeErr) throw mergeErr;
  const { data: conns, error: connErr } = await supabase.from('connection_requests').select('*').eq('tree_id', treeId).order('created_at',{ascending:false}); if (connErr) throw connErr;
  const { data: reels, error: reelErr } = await supabase.from('reels').select('*').eq('tree_id', treeId).eq('status','active').order('created_at',{ascending:false}).limit(50); if (reelErr) throw reelErr;
  const { data: tickets, error: ticketErr } = await supabase.from('support_tickets').select('*').order('created_at',{ascending:false}).limit(100); if (ticketErr) throw ticketErr;
  const staff = await supabase.from('support_staff').select('profile_id').eq('profile_id', user.id).eq('active',true).maybeSingle();
  const admin = await supabase.from('admin_roles').select('role').eq('profile_id', user.id).limit(1).maybeSingle();
  state.account.role = admin.data?.role || (staff.data ? 'support' : 'member');
  const peopleById = Object.fromEntries(people.map(p=>[p.id,p]));
  state.people = people.map(p=>({id:p.id,created_at:p.created_at,personCode:p.person_code,name:p.full_name,gender:p.gender,status:p.status,dob:p.dob,mobile:p.mobile,email:p.email,avatar_url:p.avatar_url,me:p.claimed_by===user.id,claimed_by:p.claimed_by,created_by:p.created_by,privacy:'Family only',nickname:p.nickname,showNickname:p.show_nickname,birthPlace:p.birth_place,currentPlace:p.current_place,lifeStatus:p.life_status,details:p.details||{},treeRole:memberRoleById[p.id]||(p.claimed_by===user.id?'owner':'member'),savedRole:memberRoleById[p.id],external:!!p.__external}));
  state.relationships=relationships;
  if (syncSpouseParents()) save();
  state.posts=(posts||[]).map(p=>({id:p.id,author:p.author_profile_id===user.id?state.account.name:'Family Member',text:p.body||'',likes:0,comments:0,author_profile_id:p.author_profile_id}));
  state.events=(events||[]).map(e=>({id:e.id,emoji:'🎉',title:e.title,sub:e.event_date + ' · ' + e.event_type}));
  state.mergeRequests=(merges||[]).map(r=>({id:r.id,a:peopleById[r.source_person_id]?.full_name||r.source_person_id,b:peopleById[r.target_person_id]?.full_name||r.target_person_id,keptId:r.target_person_id,removedId:r.source_person_id,status:r.status==='completed'?'Merged':'Pending'}));
  state.connections=(conns||[]).map(c=>({id:c.id,name:peopleById[c.person_id]?.full_name||'Family member',relation:peopleById[c.person_id]?deriveRelationship(people.find(p=>p.claimed_by===user.id)?.id,c.person_id).label:'Family member',status:c.status==='approved'?'connected':'pending',requestId:c.id}));
  state.reels=(reels||[]).map(r=>({id:r.id,author:'Family Member',initials:'FM',caption:r.caption||'',likes:0,comments:0,grad:'linear-gradient(160deg,#3a2f66,#1b1224 60%,#5c3a30)'}));
  state.tickets=(tickets||[]).map(t=>({id:t.ticket_code,subject:t.subject,category:t.category,priority:t.priority[0].toUpperCase()+t.priority.slice(1),status:t.status.replace('_',' '),messages:[]}));
  activeTicketId=state.tickets[0]?.id||null;
  try { const ic = await supabase.rpc('my_incoming_claims'); state.incomingClaims = ic.error ? [] : (ic.data || []); } catch (e) { state.incomingClaims = []; }
  try { const inc = await supabase.rpc('my_incoming_connections'); state.incoming = inc.error ? [] : (inc.data || []); } catch (e) { state.incoming = []; }
  if (state.incoming.length) setTimeout(() => toast(`You have ${state.incoming.length} connection request${state.incoming.length === 1 ? "" : "s"} — see Connections & Sharing`), 600);
}

supabase?.auth.onAuthStateChange((event) => {
  if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') setTimeout(bootAuthenticatedApp, 0);
  if (event === 'SIGNED_OUT') { loggedIn=false; render(); }
});

bootAuthenticatedApp();
