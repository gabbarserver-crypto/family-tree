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
- **V9** — Connections & Sharing: share Person ID, invite relatives, accept connections
- **V10** — Admin & Safety: moderation queue, admin roles, security audit log
- **V11** — Support Center (staff ticket queue + chat) and user-facing "Create Ticket"
- **V11** — Production Dashboard: system health & release pipeline

Roles (member / support / admin) come from the `admin_roles` and `support_staff` tables after login.

## New UI
- Design tokens in `style.css`: plum + marigold gold + sage palette, Fraunces
  (display) + Inter (body), organic branch-style tree connectors as the
  signature visual element.
- Responsive: sidebar nav on desktop, bottom tab bar on mobile.
- The original standalone demo files are not included in this package; their
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
SQL files are in `supabase/`. Run order: your earlier V7–V11 migrations (not in this zip — keep them in your repo), then `supabase-chat.sql`, `supabase-remove-link.sql`, `supabase-hardening.sql`, `supabase-join-tree.sql`, `supabase-admin-claim.sql`.
Review all RLS policies before going live.
The app also expects `person-memories.sql`, `claim-existing-profile.sql` and `supabase-v11-support.sql` — these are NOT in this zip.

Create a private Storage bucket:
`support-attachments`

Then add Storage RLS policies.

## Privacy
Support staff are not family members. Support access must be limited to the ticket and information needed to resolve it.


## Security notes
- Staff/admin screens are hidden client-side only. Real protection must come from Supabase Row Level Security on `support_tickets`, `merge_requests`, `admin_roles`, `support_staff`, etc.
- All user-entered text rendered via `innerHTML` must go through `esc()` (now escapes `& < > " '`).
- TODO: make merge approval a single atomic Supabase RPC instead of delete + per-row upsert from the browser.

## Setup
```bash
npm install
cp .env.example .env.local   # fill VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY
npm run dev
```
Static assets live in `public/assets/` (served at `/assets/*`).

## Changelog (review pass)
- Fixed stored XSS: names in the Relationship Finder path are now escaped.
- GEDCOM import: O(1) person lookup; local-file photo paths are no longer used as image URLs (kept in `details.photo_file`).
- Chat: sender name is set server-side by trigger; per-user rate limit (`supabase-hardening.sql`).
- Added `.gitignore`, `.env.example`, `vite.config.js`; consolidated assets; moved SQL to `supabase/`; removed the unused Next.js example.

## Join a family tree (new)
Run `supabase/supabase-join-tree.sql` once in the Supabase SQL editor (after your earlier migrations).
- New user searches their name -> **"Ye main hu"** -> sees the tree (names/years only) + the list of tree admins -> **Join**.
- **Pending**: can only ADD new profiles/links. No edit/delete of anything that existed before (enforced in the database by `join_sync` / `join_remove_person`).
- **Approved** by an owner/admin: can also edit old *unclaimed* profiles.
- **Rejected / cancelled**: every profile, link and membership that person added to that tree is rolled back (soft-deleted).
- Owners/admins see requests (with how many profiles the person already added) in *Connections & Sharing*.

## Chart view (new)
Tree page now has a **🌿 Branch / 🧬 Chart** switch in the top bar (choice is remembered).
Chart view is an iMeUsWe-style top-down chart: white portrait cards, coloured initials or photo, green ring for registered members,
spouse line with a hollow circle, bus line down to the children. Starts from the top of *your* family line; a dropdown lets you start from
another family line. Tap a card for the profile, drag to pan, ＋/－/Fit to zoom (Ctrl+wheel also works). Built from the same relationship graph.

## Admin by claim, admin management, profile transfer (new)
Run `supabase/supabase-admin-claim.sql` once (after `supabase-join-tree.sql`).
- **Claiming a profile makes that user an admin** of the tree (add + edit). Claiming stays optional; unclaimed profiles are managed by admins.
- An admin stays admin until **another admin removes them** (Members page). Removing admin does not unclaim the profile.
- **Any admin can add or remove admins**; the target must be a claimed profile. The tree owner can never be removed, so a tree always has an admin.
- **Transfer profile**: a claimed (non-owner) profile can be handed to another account with a single-use 48h code (stored hashed). The receiver enters it under "Transfer code hai?" on the first-login screen, becomes the claimant + admin, and the sender stays in the tree as admin with a fresh empty card (same name, no contact details) until another admin removes them.
- **Another email for an already-claimed profile**: can't take it over. They join with a new profile; when an admin approves (with a confirm warning) they become admin.
- Everything is logged in `tree_admin_log`.
- Optional backfill (commented in the SQL) makes already-claimed members admins too.

## Changelog (mobile fix pass)
- Header: `.topbar-center` now uses `flex:1 1 100%` on tablets/phones (it was squeezed to ~75px, clipping search and the Tree/Wall/Chat + Branch/Chart switches).
- Merge page no longer overflows the screen on phones (long option labels widened the form); bottom nav no longer disappears there.
- Stat cards in grids align; stacked blocks get consistent spacing.
- Chat: no extra card padding, chat first and Members below on phones.
- People list: styled search/sort, stable row layout, icon-only delete on small screens. Native inputs/selects/textareas without a class now get the app look.
- Bottom nav: Home, Tree, Members, Wall, Chat + **More** (opens a sheet with every page, incl. Connections, Support, Relationship, Admin).
- Fixed: `setTreeStyle`, `chart*` and `setPrivacy` handlers were never exported to `window`, so the Branch/Chart switch, the Chart toolbar and the Privacy dropdown did nothing.
- Packaging: removed unused duplicate `assets/`, root `logo.png`, duplicate root SQL files and the stale `supabase-client-example.js`; added `.gitignore` and `.env.example`.

## Person wall (new)
Run `supabase/supabase-person-wall.sql` once in Supabase (SQL editor).
- Card click -> profile popup -> **📝 Wall**: shows what family members wrote on that person's wall.
- Write a **new post**, **🏷 tag** people from the tree, **❤️ like** and **💬 comment**. Authors (and the wall owner) can delete posts/comments.
- Who can see/write: the tree owner and anyone whose claimed profile is a member of a tree that contains that person (same rule as Family Chat).
- **Wall tab** = family feed: everyone's posts in the tree, newest first (with ❤️ / 💬 / tags). **＋ New post** writes on *your own* wall. Re-run `supabase-person-wall.sql` after updating (it adds `list_wall_feed`).

## Wall photos & videos (new)
Run `supabase/supabase-wall-media.sql` once in Supabase (after `supabase-person-wall.sql`). It adds a `media` column, a **private** `wall-media` storage bucket with policies, and replaces `add_person_wall_post`, `list_person_wall`, `list_wall_feed`.
- Composer has **📎 Photo / Video**: up to 4 files per post; photos are shrunk to 1600px JPEG in the browser, videos (MP4/MOV/WebM) max 40 MB (Supabase free plan allows 50 MB per file, 1 GB storage total).
- Files are shown through 1-hour signed URLs, so only people who can view that wall can see them.
- Deleting a post also removes its files when the uploader deletes it; if a wall owner deletes someone else's post the files stay in storage (clean up from the dashboard if needed).

## Support desk (how messages are checked)
1. Run `supabase/supabase-support.sql` once (RLS policies + auto status trigger).
2. Make a person staff (SQL editor): `insert into support_staff (profile_id, role, active) select id,'agent',true from profiles where lower(email)=lower('their-login-email');`
3. That person logs in -> **Support** page becomes the Support Center: queue (tickets waiting for a reply shown first with 🔔), open a ticket to read the whole conversation, Reply / Assign to me / Resolve. The list refreshes every 60s and via the Refresh button.
4. Users see the staff reply under Support -> My Tickets -> "View reply" and can answer; writing on a resolved ticket re-opens it.

## Games tab + smarter Add Relative
- Sidebar/“More” has a **🎮 Games** tab and the dashboard has a **Games ↗** button; both open https://games.1infinity.online/games/auth.html?redirect=index.html in a new tab.
- Add Relative form now shows **Gender** and **Married** fields, pre-filled from the relationship: Wife → Female + Married, Husband → Male + Married, Son → Male, Daughter → Female (changing the relationship dropdown re-applies them). Linking anyone as a spouse also marks the existing card as Married.

## State → City dropdown
Profile edit and Add Relative now have a State dropdown and a City dropdown that lists the cities of the chosen state
(`public/data/india-cities.json`, 4,242 places, loaded on demand). Pick **Other (type manually)…** for villages not in the list.
Existing free-text cities are kept. Data source/licence: `public/data/india-cities-SOURCE.txt` (ODbL — keep the attribution).

## Wall post location (new)
Run `supabase/supabase-wall-location.sql` once in the Supabase SQL editor (after `supabase-wall-media.sql`), (no npm install needed: the map library loads from a CDN).
In "New post" tap 📍 Location: type a place name and/or lat/lng, use GPS, search by name, paste a Google Maps link, or tap/drag a pin on the map.

## Post reactions (new)
Run `supabase/supabase-wall-reactions.sql` once in the Supabase SQL editor (after `supabase-wall-location.sql`). Replaces the single like with 👍 ❤️ 😂 😢 🙏 🙌 (one reaction per person per post; old likes become ❤️).

- Members page: tabs are **Admins · ALL · Unlinked · Duplicates**. Duplicates opens the merge page (no separate sidebar item anymore).
