import { supabase, supabaseConfigured, signInWithGoogle, sendPhoneOtp, verifyPhoneOtp } from "./supabase.js";

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
let addRelativePhotoFile = null;
let addRelativePersonId = null;
const RELATION_TYPES = {
  wife: { label: "Wife", gender: "Female", edgeType: "spouse" },
  husband: { label: "Husband", gender: "Male", edgeType: "spouse" },
  son: { label: "Son", gender: "Male", edgeType: "child" },
  daughter: { label: "Daughter", gender: "Female", edgeType: "child" },
  father: { label: "Father", gender: "Male", edgeType: "parent" },
  mother: { label: "Mother", gender: "Female", edgeType: "parent" }
};

function save() { return persistState(); }

async function persistState() {
  if (!supabase || !currentUser || !state.treeId) return;
  try {
    const peopleRows = state.people.map(p => ({
      id: p.id, person_code: p.personCode || p.id, full_name: p.name, dob: normalizeDate(p.dob), gender: p.gender || null, mobile: p.mobile || null, email: p.email || null, avatar_url: p.avatar_url || null, status: p.status || 'unclaimed', claimed_by: p.claimed_by || (p.me ? currentUser.id : null), created_by: p.created_by || currentUser.id,
      nickname: p.nickname || null, show_nickname: !!p.showNickname, birth_place: p.birthPlace || null, current_place: p.currentPlace || null, life_status: p.lifeStatus || 'living', details: p.details || {}
    }));
    if (peopleRows.length) { const { error } = await supabase.from('persons').upsert(peopleRows, { onConflict: 'id' }); if (error) throw error; }
    const memberRows = state.people.map(p => ({ tree_id: state.treeId, person_id: p.id, added_by: currentUser.id, role: personTreeRole(p) }));
    if (memberRows.length) { const { error } = await supabase.from('tree_members').upsert(memberRows, { onConflict: 'tree_id,person_id' }); if (error) throw error; }
    const relRows = state.relationships.map(r => ({ id: isUuid(r.id) ? r.id : crypto.randomUUID(), tree_id: state.treeId, person_a_id: r.from, person_b_id: r.to, relationship_type: r.type, created_by: currentUser.id, status: r.status === 'removed' ? 'removed' : 'active' }));
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
  return `<div class="avatar ${cls}" style="background:${bg};color:${fg}">${initials(p.name)}</div>`;
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
function esc(s) { return String(s).replace(/</g, "&lt;"); }
function me() { return state.people.find(p => p.me); }
function isStaff() { return state.account.role === "admin" || state.account.role === "support"; }
function isAdmin() { return state.account.role === "admin"; }
/* Per-tree admin role (distinct from the system-wide isStaff/isAdmin above).
   Owner = created the tree. Admin = promoted by the owner, can add/edit
   relatives in THIS tree only. Member = view-only for role management. */
function personTreeRole(p) { return (p && p.treeRole) || (p && p.me ? "owner" : "member"); }
function myTreeRole() { return personTreeRole(me()); }
function isTreeOwner() { return myTreeRole() === "owner"; }
function canEditTree() { return myTreeRole() === "owner" || myTreeRole() === "admin"; }
/* Anyone can add relatives directly onto their own card, even if they're
   not a tree owner/admin. Everyone else's card still needs edit rights. */
function canAddRelativeTo(targetId) { return canEditTree() || targetId === me().id; }
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
function computeGenerations(rootId) {
  const gen = { [rootId]: 0 };
  const queue = [rootId];
  while (queue.length) {
    const cur = queue.shift();
    const g = gen[cur];
    parentsOf(cur).forEach(id => { if (!(id in gen)) { gen[id] = g - 1; queue.push(id); } });
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
async function logout() { if (supabase) await supabase.auth.signOut(); loggedIn = false; currentUser = null; state = { account: {}, people: [], relationships: [], connections: [], mergeRequests: [], events: [], posts: [], reels: [], tickets: [], audit: [], treeId: null }; location.hash = 'home'; render(); }

/* ---------------- shell ---------------- */
function render() {
  if (!loggedIn) { renderLogin(); return; }
  const page = (location.hash || "#home").slice(1);
  const app = document.getElementById("app");
  const flatNav = NAV.flatMap(g => g.items).filter(([id]) => id !== "add" || canEditTree()).concat(isStaff() ? ADMIN_NAV.items : []);
  app.innerHTML = `<div class="shell">
    <header class="topbar">
      <div class="brand"><img src="/assets/logo.png" alt="FamilyTree" style="height:32px;width:32px;object-fit:contain;vertical-align:middle;margin-right:6px"> Family<em>Tree</em><small>V11</small></div>
      <div class="top-actions">
        
        <span class="muted" style="font-size:13px">${state.account.name}</span>
        <div class="avatar">${initials(state.account.name)}</div>
      </div>
    </header>
    <div class="layout">
      <aside class="sidebar">${navHTML(page)}</aside>
      <main class="content">${pageView(page)}</main>
    </div>
    <nav class="bottomnav">${flatNav.slice(0, 6).map(([id, label, icon]) => navItem(id, label, icon, page)).join("")}</nav>
  </div>`;
  if (page === "tree") requestAnimationFrame(drawTreeConnectors);
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
  <div class="card"><h3>Upcoming</h3>${upcoming.map(e => `<div class="event-chip"><span class="em">${e.emoji}</span><div><strong>${e.title}</strong><div class="muted" style="font-size:12.5px">${e.sub}</div></div></div>`).join("")}
  <button class="ghost" style="margin-top:8px" onclick="go('wall')">See all events →</button></div>`;
}

/* ---------------- V3: tree — rendered live from the relationship graph ---------------- */
let treeCenterId = null; // person the tree is currently focused/centered on
let treeExpanded = new Set(); // person ids currently showing their "add relative" placeholders
function nodeElId(id) { return "node-" + String(id).replace(/[^a-zA-Z0-9_-]/g, "_"); }
function placeholderId(typeKey, targetId) { return "add-" + typeKey + "-" + targetId; }

function tree() {
  const centerId = treeCenterId || me().id;
  const gens = computeGenerations(centerId); // {personId: genIndex}
  const byGen = {};
  Object.entries(gens).forEach(([id, g]) => { (byGen[g] = byGen[g] || []).push(id); });

  // Work out which placeholder nodes to inject per generation, based on
  // which cards are currently "expanded" (their add-badge was tapped).
  const extraByGen = {}; // gen -> [{key,typeKey,targetId}]
  const seenChildFamilies = new Set();
  treeExpanded.forEach(id => {
    if (!(id in gens)) return; // not part of the currently visible tree
    const p = personById(id);
    if (!p) return;
    const g = gens[id];
    if (spousesOf(id).length === 0) {
      (extraByGen[g] = extraByGen[g] || []).push({ typeKey: p.gender === "Female" ? "husband" : "wife", targetId: id });
    }
    if (parentsOf(id).length === 0) {
      (extraByGen[g - 1] = extraByGen[g - 1] || []).push({ typeKey: "father", targetId: id }, { typeKey: "mother", targetId: id });
    }
    const spouse = spousesOf(id)[0];
    const familyKey = spouse ? [id, spouse].sort().join("|") : id;
    if (!seenChildFamilies.has(familyKey)) {
      seenChildFamilies.add(familyKey);
      (extraByGen[g + 1] = extraByGen[g + 1] || []).push({ typeKey: "son", targetId: id }, { typeKey: "daughter", targetId: id });
    }
  });

  const levels = Array.from(new Set([...Object.keys(byGen).map(Number), ...Object.keys(extraByGen).map(Number)])).sort((a, b) => a - b);
  // keep spouses adjacent to their partner within a row
  levels.forEach(g => {
    (byGen[g] || []).sort((a, b) => {
      const aSp = spousesOf(a)[0], bSp = spousesOf(b)[0];
      return (aSp === b ? -1 : bSp === a ? 1 : 0);
    });
  });
  const centerGen = gens[centerId];
  const rows = levels.map(g => {
    const peopleHtml = (byGen[g] || []).map(id => branchNode(personById(id), id === centerId)).join("");
    const extrasHtml = (extraByGen[g] || []).map(n => addRelativeNode(n.typeKey, n.targetId)).join("");
    return `<div class="gen" data-gen="${g}">${peopleHtml}${extrasHtml}</div>`;
  }).join("");
  return `<div class="page-head"><h2>My Family Tree</h2><p class="muted">Built live from the relationship graph — zoom, pan and tap the ＋ badge on any card to add a relative, or the 🌳 badge to re-center.</p></div>
  <div class="tree-toolbar">
    <input id="treeSearch" placeholder="Search by name or Person ID…" style="border:1px solid var(--line);border-radius:10px;padding:9px 12px;min-width:220px" list="treeSearchList" onchange="treeSearch(this.value)">
    <datalist id="treeSearchList">${state.people.map(p => `<option value="${p.name} (${p.id})">`).join("")}</datalist>
    <button class="secondary" onclick="treeZoom(1.15)">＋ Zoom</button>
    <button class="secondary" onclick="treeZoom(0.87)">－ Zoom</button>
    <button class="ghost" onclick="treeReset()">Reset</button>
    <button class="ghost" onclick="treeFocusMe()">🎯 Focus Me</button>
  </div>
  <div class="tree-canvas" id="treeCanvas">
    <div class="tree-stage" id="treeStage" style="position:relative">
      <svg id="treeLines" style="position:absolute;top:0;left:0;pointer-events:none;overflow:visible"></svg>
      ${rows || "<p class='muted'>No relationships recorded yet — tap the ＋ badge on your card to start the graph.</p>"}
    </div>
  </div>`;
}

function addRelativeNode(typeKey, targetId) {
  const t = RELATION_TYPES[typeKey];
  return `<div class="branch-node add-node" id="${nodeElId(placeholderId(typeKey, targetId))}" style="border:2px dashed var(--line,#c9bfa8);background:transparent;display:flex;align-items:center;justify-content:center;cursor:pointer;color:var(--muted,#8a8478);font-size:13px;text-align:center;min-height:64px" onclick="openAddRelative('${targetId}','${typeKey}')">+ Add ${t.label}</div>`;
}

function branchNode(p, isCenter) {
  if (!p) return "";
  const expanded = treeExpanded.has(p.id);
  const badgeBase = "position:absolute;top:-9px;width:22px;height:22px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:12px;cursor:pointer;box-shadow:0 1px 4px rgba(0,0,0,.2);z-index:2;";
  const addBadge = canAddRelativeTo(p.id) ? `<button type="button" title="${expanded ? "Close" : "Add relative"}" style="${badgeBase}left:-9px;border:2px solid #fff;background:${expanded ? "#e0602a" : "#f2793a"};color:#fff" onclick="event.stopPropagation();toggleTreeExpand('${p.id}')">${expanded ? "✕" : "＋"}</button>` : "";
  const centerBadge = `<button type="button" title="Center tree on ${esc(p.name)}" style="${badgeBase}right:-9px;border:2px solid #fff;background:#fff" onclick="event.stopPropagation();centerTree('${p.id}')">🌳</button>`;
  const years = p.dob ? `${new Date(p.dob).getFullYear()} –` : "–";
  return `<div class="branch-node ${p.me ? "me" : ""} ${isCenter && !p.me ? "me" : ""}" id="${nodeElId(p.id)}" style="position:relative" ondblclick="openProfile('${p.id}')">
    ${addBadge}${centerBadge}
    ${avatarHTML(p, "photo")}
    <strong>${p.name}</strong>
    <div class="mini">${years}${p.status === "unclaimed" ? " · Unclaimed" : ""}</div>
    <div class="mini rel">${deriveRelationship(me().id, p.id).label}</div>
  </div>`;
}

function toggleTreeExpand(id) {
  if (treeExpanded.has(id)) treeExpanded.delete(id); else treeExpanded.add(id);
  render();
  requestAnimationFrame(drawTreeConnectors);
}

function centerTree(id) { treeCenterId = id; treeScale = 1; go("tree"); requestAnimationFrame(drawTreeConnectors); }
function treeSearch(val) {
  const idMatch = val.match(/\(([^)]+)\)\s*$/);
  const id = idMatch ? idMatch[1] : (state.people.find(p => p.name.toLowerCase() === val.toLowerCase())?.id);
  if (id && personById(id)) centerTree(id); else toast("Person not found");
}
function treeZoom(n) { treeScale = Math.max(.5, Math.min(2.2, treeScale * n)); document.getElementById("treeStage").style.transform = `scale(${treeScale})`; requestAnimationFrame(drawTreeConnectors); }
function treeReset() { treeScale = 1; const s = document.getElementById("treeStage"); if (s) s.style.transform = "scale(1)"; requestAnimationFrame(drawTreeConnectors); }
function treeFocusMe() { treeCenterId = me().id; treeReset(); go("tree"); requestAnimationFrame(drawTreeConnectors); }

/* Draw the org-chart style connector lines (branch lines + junction dots)
   between rendered tree nodes, using their actual DOM positions so the
   layout always matches whatever the browser/flexbox produced. */
function drawTreeConnectors() {
  const stage = document.getElementById("treeStage");
  const svg = document.getElementById("treeLines");
  if (!stage || !svg) return;
  const LINE = "#c9bfa8", DOT = "#4a2e6b";
  const get = id => document.getElementById(nodeElId(id));
  const rect = el => ({ x: el.offsetLeft, y: el.offsetTop, w: el.offsetWidth, h: el.offsetHeight });
  const parts = [];
  const dot = (x, y) => parts.push(`<circle cx="${x}" cy="${y}" r="4" fill="${DOT}"/>`);
  const line = (x1, y1, x2, y2) => parts.push(`<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${LINE}" stroke-width="2"/>`);

  // 1) direct spouse links (real + placeholder)
  const drawnSpousePairs = new Set();
  state.people.forEach(p => {
    spousesOf(p.id).forEach(sId => {
      const key = [p.id, sId].sort().join("|");
      if (drawnSpousePairs.has(key)) return;
      drawnSpousePairs.add(key);
      const a = get(p.id), b = get(sId);
      if (!a || !b) return;
      const ra = rect(a), rb = rect(b);
      const leftEl = ra.x < rb.x ? ra : rb, rightEl = ra.x < rb.x ? rb : ra;
      const y = leftEl.y + leftEl.h / 2;
      const x1 = leftEl.x + leftEl.w, x2 = rightEl.x;
      line(x1, y, x2, y);
      dot((x1 + x2) / 2, y);
    });
  });
  treeExpanded.forEach(id => {
    if (spousesOf(id).length) return;
    const p = personById(id);
    if (!p) return;
    const phId = placeholderId(p.gender === "Female" ? "husband" : "wife", id);
    const a = get(id), b = get(phId);
    if (!a || !b) return;
    const ra = rect(a), rb = rect(b);
    const leftEl = ra.x < rb.x ? ra : rb, rightEl = ra.x < rb.x ? rb : ra;
    const y = leftEl.y + leftEl.h / 2;
    const x1 = leftEl.x + leftEl.w, x2 = rightEl.x;
    line(x1, y, x2, y);
    dot((x1 + x2) / 2, y);
  });

  // 2) parent -> children family units (real relationships)
  const famUnits = {}; // key(parents) -> {parentIds:[], childIds:Set}
  state.relationships.filter(r => r.type === "parent").forEach(r => {
    if (!get(r.from) || !get(r.to)) return;
    const parentIds = parentsOf(r.to).filter(pid => get(pid));
    const key = [...parentIds].sort().join("|");
    if (!famUnits[key]) famUnits[key] = { parentIds, childIds: new Set() };
    famUnits[key].childIds.add(r.to);
  });
  // 2b) placeholder parent/child family units from expanded cards
  treeExpanded.forEach(id => {
    const p = personById(id);
    if (!p || !get(id)) return;
    if (parentsOf(id).length === 0) {
      const fatherPh = placeholderId("father", id), motherPh = placeholderId("mother", id);
      if (get(fatherPh) && get(motherPh)) {
        const key = "ph:" + fatherPh + "|" + motherPh;
        famUnits[key] = { parentIds: [fatherPh, motherPh], childIds: new Set([id]) };
      }
    }
    const spouse = spousesOf(id)[0];
    const familyKey = spouse ? [id, spouse].sort().join("|") : id;
    const sonPh = placeholderId("son", id), daughterPh = placeholderId("daughter", id);
    if (get(sonPh) && get(daughterPh)) {
      const key = "ph-children:" + familyKey;
      const parentIds = spouse ? [id, spouse] : [id];
      famUnits[key] = { parentIds, childIds: new Set([sonPh, daughterPh]) };
    }
  });

  Object.values(famUnits).forEach(({ parentIds, childIds }) => {
    const parentEls = parentIds.map(get).filter(Boolean);
    const childEls = [...childIds].map(get).filter(Boolean);
    if (!parentEls.length || !childEls.length) return;
    const pRects = parentEls.map(rect);
    const parentY = Math.max(...pRects.map(r => r.y + r.h));
    const parentX = (Math.min(...pRects.map(r => r.x)) + Math.max(...pRects.map(r => r.x + r.w))) / 2;
    const cRects = childEls.map(rect);
    const childY = Math.min(...cRects.map(r => r.y));
    const busY = parentY + (childY - parentY) / 2;
    dot(parentX, parentY);
    line(parentX, parentY, parentX, busY);
    const childXs = cRects.map(r => r.x + r.w / 2);
    const minX = Math.min(parentX, ...childXs), maxX = Math.max(parentX, ...childXs);
    line(minX, busY, maxX, busY);
    childXs.forEach(cx => { line(cx, busY, cx, childY); dot(cx, childY); });
  });

  svg.setAttribute("width", stage.scrollWidth);
  svg.setAttribute("height", stage.scrollHeight);
  svg.innerHTML = parts.join("");
}
window.addEventListener("resize", () => { if ((location.hash || "").slice(1) === "tree") drawTreeConnectors(); });

/* ---------------- add person — creates real graph edges ---------------- */
function add() {
  const opts = state.people.map(p => `<option value="${p.id}" ${p.id === me().id ? "selected" : ""}>${p.name} — ${p.id}</option>`).join("");
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
  addRelativeTargetId = targetId;
  addRelativeTypeKey = typeKey;
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
    <div style="display:flex;align-items:center;gap:14px;margin-bottom:6px">
      <div id="arPhotoPreview" onclick="pickAddRelativePhoto()" style="width:64px;height:64px;border-radius:50%;background:var(--sand,#f1e9d8);display:flex;align-items:center;justify-content:center;cursor:pointer;font-size:22px;color:var(--muted,#8a8478);flex-shrink:0">+</div>
      <button class="ghost" onclick="pickAddRelativePhoto()">Add a profile picture</button>
    </div>
    <div class="field"><label>Relationship type</label>
      <select id="arRelType">${Object.entries(RELATION_TYPES).map(([k, v]) => `<option value="${k}" ${k === addRelativeTypeKey ? "selected" : ""}>${v.label}</option>`).join("")}</select>
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
  <div class="actions" style="margin-top:14px">
    <button class="ghost" onclick="go('tree')">Cancel</button>
    <button class="primary" onclick="saveAddRelative()">Add Relative</button>
  </div>`;
}
async function saveAddRelative() {
  if (!canAddRelativeTo(addRelativeTargetId)) { toast("Only this tree's owner or admins can add relatives to other people"); return; }
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

  if (t.edgeType === "spouse") addEdge(addRelativeTargetId, id, "spouse");
  else if (t.edgeType === "parent") addEdge(id, addRelativeTargetId, "parent"); // new person is parent OF target
  else addEdge(addRelativeTargetId, id, "parent"); // target is parent OF new person (child)

  save();
  toast(`${name} added as ${t.label}`);
  treeCenterId = addRelativeTargetId;
  go("tree");
}

/* ---------------- people ---------------- */
function people() {
  return `<div class="page-head"><h2>People</h2><p class="muted">Everyone connected to your family tree.</p></div>
  <div class="list">${state.people.map(p => `<div class="row" style="cursor:pointer" onclick="openProfile('${p.id}')">
    <div style="display:flex;gap:12px;align-items:center">${avatarHTML(p)}<div><strong>${p.name}</strong><div class="muted" style="font-size:12.5px">${p.me ? "Self" : deriveRelationship(me().id, p.id).label} · ${p.id}</div></div></div>
    <div>${p.status === "unclaimed" ? '<span class="badge">Unclaimed</span>' : '<span class="badge sage">Claimed</span>'}</div>
  </div>`).join("")}</div>`;
}

/* ---------------- V5: profile ---------------- */
function openProfile(id) { activeProfileId = id; go("profile"); }
function profile(id) {
  const p = state.people.find(x => x.id === id) || me();
  return `<div class="page-head"><h2>Profile</h2><p class="muted">Person profile &amp; media.</p></div>
  <div class="card profile-head">
    <div>${avatarHTML(p, "lg " + (p.me ? "gold" : ""))}
      <button class="ghost full" style="margin-top:10px" onclick="changePhoto('${p.id}')">Change Photo</button></div>
    <div>
      <h1 style="font-family:var(--font-display);font-size:24px;margin-bottom:2px">${p.name}</h1>
      <p class="muted">Person ID: <strong>${p.id}</strong> · ${p.status === "unclaimed" ? '<span class="badge">Unclaimed</span>' : '<span class="badge sage">Claimed</span>'}</p>
      <hr class="divider">
      <p><strong>About:</strong> ${p.about || "Family profile information can be shown here."}</p>
      <p><strong>Relation:</strong> ${p.me ? "Self" : deriveRelationship(me().id, p.id).label}${p.dob ? ` · <strong>DOB:</strong> ${p.dob}` : ""}${p.mobile ? ` · <strong>Mobile:</strong> ${p.mobile}` : ""}</p>
      <div class="field" style="max-width:240px;margin-top:10px"><label>Privacy</label>
        <select onchange="setPrivacy('${p.id}',this.value)"><option ${p.privacy === "Family only" || !p.privacy ? "selected" : ""}>Family only</option><option ${p.privacy === "Private" ? "selected" : ""}>Private</option><option ${p.privacy === "Selected family" ? "selected" : ""}>Selected family</option><option ${p.privacy === "Public" ? "selected" : ""}>Public</option></select>
      </div>
    </div>
  </div>
  <div class="card"><h3>Photos &amp; Albums</h3><div class="photo-grid">
    <div class="album">📷</div><div class="album">👨‍👩‍👧</div><div class="album">🎉</div>
  </div>
  <div class="actions" style="margin-top:14px">
    <button class="secondary" onclick="toast('Demo: create album')">+ Create Album</button>
    <button class="secondary" onclick="toast('Demo: upload photo')">Upload Photo</button>
  </div></div>`;
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
function merge() {
  const opts = state.people.map(p => `<option value="${p.id}">${p.name} — ${p.id}</option>`).join("");
  return `<div class="page-head"><h2>Duplicate Merge</h2><p class="muted">Select two profiles to compare and create a merge request.</p></div>
  <div class="card form">
    <div class="field"><label>Profile A</label><select id="ma">${opts}</select></div>
    <div class="field"><label>Profile B</label><select id="mb">${opts}</select></div>
    <button class="secondary" style="justify-self:start" onclick="compareMerge()">Compare Profiles</button>
  </div>
  <div id="mergeCompare"></div>
  <div class="card"><h3>Requests</h3>${state.mergeRequests.length ? state.mergeRequests.map((r, i) => `<div class="row"><span>${r.a} ↔ ${r.b}</span><span class="badge ${r.status === "Merged" ? "sage" : ""}">${r.status}</span>${r.status === "Pending" && isStaff() ? `<button class="secondary" onclick="approveMerge(${i})">Approve &amp; Merge</button>` : ""}</div>`).join("") : "<p class='muted'>No requests yet.</p>"}</div>`;
}
function compareMerge() {
  const a = state.people.find(p => p.id === document.getElementById("ma").value);
  const b = state.people.find(p => p.id === document.getElementById("mb").value);
  const box = document.getElementById("mergeCompare");
  if (a.id === b.id) { box.innerHTML = `<div class="card"><p class="muted">Choose two different profiles.</p></div>`; return; }
  const same = (x, y) => x && y && x === y;
  const rowField = (label, av, bv) => `<div class="row"><span class="muted">${label}</span><span>${av || "—"}</span><span>${bv || "—"}</span></div>`;
  const matches = [], conflicts = [];
  if (same(a.dob, b.dob)) matches.push("DOB"); else if (a.dob || b.dob) conflicts.push("DOB");
  if (same(a.mobile, b.mobile)) matches.push("mobile"); else if (a.mobile || b.mobile) conflicts.push("mobile");
  if (a.name !== b.name) conflicts.push("display name"); else matches.push("name");
  box.innerHTML = `<div class="card">
    <div class="row"><span></span><strong>${a.name}</strong><strong>${b.name}</strong></div>
    ${rowField("DOB", a.dob, b.dob)}${rowField("Mobile", a.mobile, b.mobile)}${rowField("Father", a.father, b.father)}
    ${matches.length ? `<div class="badge sage" style="margin-top:10px">✓ Matching: ${matches.join(", ")}</div>` : ""}
    ${conflicts.length ? `<div class="badge terracotta" style="margin-top:8px;margin-left:6px">! Conflict: ${conflicts.join(", ")}</div>` : ""}
    <hr class="divider">
    <label><input type="radio" name="keepname" value="${a.id}" checked> Keep "${a.name}"</label><br>
    <label><input type="radio" name="keepname" value="${b.id}"> Keep "${b.name}"</label>
    <p class="muted" style="margin-top:8px">All relationship-graph edges will be redirected onto the kept profile and duplicate edges removed.</p>
    <button class="primary" onclick="requestMerge('${a.id}','${b.id}')">Create Merge Request</button>
  </div>`;
}
async function requestMerge(a, b) {
  const keptId = document.querySelector('input[name="keepname"]:checked')?.value || a;
  const removedId = keptId === a ? b : a;
  if (supabase) { const {error}=await supabase.from('merge_requests').insert({source_person_id:removedId,target_person_id:keptId,requested_by:currentUser.id}); if(error) return toast(error.message); await loadProductionState(currentUser); } else state.mergeRequests.push({ a,b,keptId,removedId,status:'Pending' });
  toast("Merge request created for admin review"); go("merge");
}
/* Admin approves a merge request: reassigns graph edges (acceptance test 8), removes the duplicate person. */
async function approveMerge(i) {
  const req = state.mergeRequests[i];
  reassignEdges(req.removedId, req.keptId);
  if (supabase) {
    const {error: re}=await supabase.from('relationships').delete().eq('tree_id',state.treeId).or(`person_a_id.eq.${req.removedId},person_b_id.eq.${req.removedId}`); if(re) return toast(re.message);
    for (const r of state.relationships) { const {error}=await supabase.from('relationships').upsert({id:isUuid(r.id)?r.id:crypto.randomUUID(),tree_id:state.treeId,person_a_id:r.from,person_b_id:r.to,relationship_type:r.type,created_by:currentUser.id,status:'active'}); if(error) return toast(error.message); }
    const {error: pe}=await supabase.from('persons').update({status:'merged',merged_into_person_id:req.keptId}).eq('id',req.removedId); if(pe) return toast(pe.message);
    await supabase.from('merge_requests').update({status:'completed',reviewed_by:currentUser.id}).eq('id',req.id);
  }
  state.people = state.people.filter(p => p.id !== req.removedId); state.mergeRequests[i].status = 'Merged';
  toast(`Merged ${req.removedId} into ${req.keptId}`); await loadProductionState(currentUser); render();
}

/* ---------------- relationship finder — real graph traversal + path ---------------- */
function relationship() {
  const opts = state.people.map(p => `<option value="${p.id}">${p.name}</option>`).join("");
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
    box.innerHTML = `<div class="card" style="margin-top:10px"><strong>${b.name} isn't connected to ${a.name} in the graph yet.</strong><p class="muted" style="margin-top:6px">Add a parent, spouse or child edge to connect them.</p></div>`;
    return;
  }
  box.innerHTML = `<div class="card" style="margin-top:10px">
    <strong>${b.name} is ${a.id === b.id ? "" : `${result.label} of`} ${a.name}${a.id === b.id ? " (same person)" : ""}.</strong>
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
  <div class="card"><h3>Upcoming Family Events</h3>${state.events.map(e => `<div class="event-chip"><span class="em">${e.emoji}</span><div><strong>${e.title}</strong><div class="muted" style="font-size:12.5px">${e.sub}</div></div></div>`).join("")}</div>
  <div class="card" id="feed"><h3>Feed</h3>${state.posts.map(postHTML).join("")}</div>`;
}
function postHTML(p) { return `<div class="post" data-id="${p.id}"><div class="post-head"><div class="avatar">${initials(p.author)}</div><strong>${p.author}</strong></div><p>${esc(p.text)}</p><div class="actions"><button class="ghost" onclick="likePost(${p.id})">❤️ ${p.likes}</button><button class="ghost">💬 ${p.comments}</button></div></div>`; }
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
      <div class="info"><div class="avatar" style="background:#fff;color:var(--plum)">${r.initials}</div><h2 style="color:#fff;margin-top:8px">${r.author}</h2><p>${r.caption}</p><small>${r.likes} likes · ${r.comments} comments</small></div>
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
  const myId = me().id;
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
  <div class="card"><h3>Connections</h3>${state.connections.map((c, i) => `<div class="row"><span><b>${c.name}</b><br><span class="muted" style="font-size:12.5px">${c.relation}</span></span>${c.status === "connected" ? '<span class="muted">Connected</span>' : `<button class="secondary" onclick="acceptConnection(${i})">Accept</button>`}</div>`).join("") || "<p class='muted'>No connections yet.</p>"}</div>
  <div class="card"><h3>Privacy rule</h3><p>🔒 A social connection does not automatically grant access to a private family tree. Access follows the tree's permissions.</p></div>`;
}
function shareId(id) { navigator.clipboard?.writeText(id).catch(() => {}); toast("Person ID copied: " + id); }
function invite() { const x = document.getElementById("inviteContact").value.trim(); if (!x) { toast("Enter mobile or email"); return; } toast("Invite sent to " + x); }
function acceptConnection(i) { state.connections[i].status = "connected"; save(); go("sharing"); }

/* ---------------- V11 Support: tickets ---------------- */
function support() {
  if (isStaff()) return supportDashboard();
  const mine = state.tickets;
  return `<div class="page-head"><h2>Support</h2><p class="muted">Get help from the FamilyTree support team.</p></div>
  <div class="card"><h3>My Tickets</h3>${mine.map(t => `<div class="row"><span><b>${t.id}</b> · ${t.category}<br><small class="muted">${t.subject}</small></span><span class="badge ${t.priority === "Urgent" ? "terracotta" : t.priority === "High" ? "" : "plum"}">${t.priority}</span></div>`).join("")}</div>
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
  <div class="card"><h3>Support Queue</h3>${t.map(x => `<div class="row"><span><b>${x.id}</b> · ${x.category}<br><small class="muted">${x.subject}</small></span><span class="badge ${x.priority === "Urgent" ? "terracotta" : "plum"}">${x.priority}</span><button class="secondary" onclick="openTicket('${x.id}')">Open</button></div>`).join("")}</div>
  ${active ? `<div class="card"><h3 id="ticketTitle">Ticket ${active.id} — ${active.subject}</h3>
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
  <div class="card"><h3>Security Audit</h3>${state.audit.map(a => `<div class="row"><span>${a.text}</span><span class="muted" style="font-size:12.5px">${a.time}</span></div>`).join("")}</div>`;
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

/* Expose functions referenced by inline onclick="..." handlers in the
   rendered HTML. Required because this file is loaded as an ES module
   (type="module"), and top-level function declarations in a module are
   scoped to the module — they are NOT attached to window automatically
   the way classic <script> globals are. */
Object.assign(window, {
  acceptConnection, addRelative, approveMerge, centerTree, changePhoto, compareMerge,
  createPerson, createTicket, findPerson, findRelation, go, googleLogin,
  invite, likePost, likeReel, logout, openAddRelative, openProfile, openTicket,
  phoneLogin, pickAddRelativePhoto, publishPost, requestMerge, resolveTicket,
  reviewItem, saveAddRelative, sendReply, shareId, toast, treeFocusMe,
  treeReset, treeZoom, toggleTreeExpand, treeSearch, setTreeRole
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
    await loadProductionState(user);
    render();
  } catch (e) { console.error(e); toast('Could not load your family data: ' + e.message); render(); }
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
  const treeId = state.treeId;
  const { data: members, error: me } = await supabase.from('tree_members').select('person_id, role').eq('tree_id', treeId); if (me) throw me;
  const memberIds = (members || []).map(x => x.person_id);
  const memberRoleById = Object.fromEntries((members || []).map(x => [x.person_id, x.role]));
  let people = [];
  if (memberIds.length) { const { data, error } = await supabase.from('persons').select('*').in('id', memberIds); if (error) throw error; people = data || []; }
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
  const ids = people.map(p => p.id);
  let relationships=[]; if (ids.length) { const { data, error } = await supabase.from('relationships').select('*').eq('tree_id', treeId); if (error) throw error; relationships=(data||[]).map(r=>({id:r.id,from:r.person_a_id,to:r.person_b_id,type:r.relationship_type,status:r.status})); }
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
  state.people = people.map(p=>({id:p.id,personCode:p.person_code,name:p.full_name,gender:p.gender,status:p.status,dob:p.dob,mobile:p.mobile,email:p.email,avatar_url:p.avatar_url,me:p.claimed_by===user.id,claimed_by:p.claimed_by,created_by:p.created_by,privacy:'Family only',nickname:p.nickname,showNickname:p.show_nickname,birthPlace:p.birth_place,currentPlace:p.current_place,lifeStatus:p.life_status,details:p.details||{},treeRole:memberRoleById[p.id]||(p.claimed_by===user.id?'owner':'member')}));
  state.relationships=relationships;
  state.posts=(posts||[]).map(p=>({id:p.id,author:p.author_profile_id===user.id?state.account.name:'Family Member',text:p.body||'',likes:0,comments:0,author_profile_id:p.author_profile_id}));
  state.events=(events||[]).map(e=>({id:e.id,emoji:'🎉',title:e.title,sub:e.event_date + ' · ' + e.event_type}));
  state.mergeRequests=(merges||[]).map(r=>({id:r.id,a:peopleById[r.source_person_id]?.full_name||r.source_person_id,b:peopleById[r.target_person_id]?.full_name||r.target_person_id,keptId:r.target_person_id,removedId:r.source_person_id,status:r.status==='completed'?'Merged':'Pending'}));
  state.connections=(conns||[]).map(c=>({id:c.id,name:peopleById[c.person_id]?.full_name||'Family member',relation:peopleById[c.person_id]?deriveRelationship(people.find(p=>p.claimed_by===user.id)?.id,c.person_id).label:'Family member',status:c.status==='approved'?'connected':'pending',requestId:c.id}));
  state.reels=(reels||[]).map(r=>({id:r.id,author:'Family Member',initials:'FM',caption:r.caption||'',likes:0,comments:0,grad:'linear-gradient(160deg,#3a2f66,#1b1224 60%,#5c3a30)'}));
  state.tickets=(tickets||[]).map(t=>({id:t.ticket_code,subject:t.subject,category:t.category,priority:t.priority[0].toUpperCase()+t.priority.slice(1),status:t.status.replace('_',' '),messages:[]}));
  activeTicketId=state.tickets[0]?.id||null;
}

supabase?.auth.onAuthStateChange((event) => {
  if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') setTimeout(bootAuthenticatedApp, 0);
  if (event === 'SIGNED_OUT') { loggedIn=false; render(); }
});

bootAuthenticatedApp();
