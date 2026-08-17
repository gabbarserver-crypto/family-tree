# V7 — Supabase + GitHub + Vercel

## Architecture

User
  ↓
Next.js app
  ↓
Supabase Auth
  ↓
Supabase Postgres
  ↓
Supabase Storage

Deployment:
GitHub → Vercel → Production

## Supabase setup

1. Create a Supabase project.
2. Open SQL Editor.
3. Run `supabase-schema.sql`.
4. Configure Auth providers:
   - Google
   - Facebook
   - Phone/SMS OTP
5. Configure redirect URLs for local and Vercel domains.
6. Create Storage buckets when media implementation is enabled.
7. Enable and verify Row Level Security policies before production.

## GitHub

Push this project to a GitHub repository.

Do NOT commit:
- `.env.local`
- service-role keys
- OAuth client secrets
- SMS provider secrets

## Vercel

Import the GitHub repository into Vercel.

Add:
- NEXT_PUBLIC_SUPABASE_URL
- NEXT_PUBLIC_SUPABASE_ANON_KEY

Then deploy.

## Critical security rule

The anon key is intended for client use with proper RLS. The Supabase service-role key bypasses RLS and must stay server-side only.

## V7 scope

- Supabase schema foundation
- Account/person separation
- Family tree tables
- Relationship tables
- Claim requests
- Duplicate/merge tables
- Posts/events foundation
- Notifications foundation
- Vercel environment configuration
- GitHub deployment notes

V7 does not claim that Google/Facebook/SMS providers are already connected; provider credentials and Supabase dashboard configuration are still required.
