# FamilyTree — Unified App (V1–V11 integrated, redesigned UI)

This package merges every previously separate demo (V1 core app + the
V3–V11 feature demos) into **one single-page app** (`index.html` /
`app.js` / `style.css`) with a redesigned, consistent visual identity —
instead of one basic app plus a pile of disconnected standalone HTML demos.

## What's integrated into the one app
- **V1** — Login (Google/Facebook/OTP demo), dashboard, add person
- **V3** — **Real family graph.** Relationships are stored as edges (`state.relationships`: `parent` / `spouse`), not hard-coded text. A BFS-based kinship engine derives every label (Father, Grandmother, Aunt, 1st cousin, Sister-in-law, etc.) and the full relationship path live from the graph. The tree view lays itself out by generation from the graph and re-centers on any person you tap; Add Person creates real parent/spouse/child/sibling edges; merging two profiles reassigns and de-duplicates their graph edges instead of leaving broken links.
- **V4** — Duplicate detection & merge request flow with a field-by-field comparison
- **V5** — Full person profile: photo, about, privacy setting, photo albums
- **V6** — Family Wall: posts, likes, upcoming family events
- **V8** — Reels: vertical snap-scroll video feed demo
- **V9** — Connections & Sharing: share Person ID, invite relatives, accept connections
- **V10** — Admin & Safety: moderation queue, admin roles, security audit log
- **V11** — Support Center (staff ticket queue + chat) and user-facing "Create Ticket"
- **V11** — Production Dashboard: system health & release pipeline

A **"View as" role switch** in the top bar lets you preview the Member,
Support, and Admin experiences in this demo without a real auth backend.

## New UI
- Design tokens in `style.css`: plum + marigold gold + sage palette, Fraunces
  (display) + Inter (body), organic branch-style tree connectors as the
  signature visual element.
- Responsive: sidebar nav on desktop, bottom tab bar on mobile.
- All original demo files (`v3-tree-demo.html`, `v4-merge-demo.html`, etc.)
  are kept in this package for reference but are no longer needed — their
  functionality now lives inside `app.js`.

## Added (from the original V11 Support package)
- Supabase support ticket tables
- Support staff roles
- Ticket messages/chat
- Attachments foundation
- Ticket events/audit history
- Support dashboard demo
- User ticket creation demo
- Updated V11 roadmap

## Supabase
Run `supabase-v11-support.sql` after the earlier V7/V8/V9/V10 migrations.

Create a private Storage bucket:
`support-attachments`

Then add Storage RLS policies.

## Privacy
Support staff are not family members. Support access must be limited to the ticket and information needed to resolve it.
