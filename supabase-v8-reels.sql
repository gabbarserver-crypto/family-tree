-- V8 Supabase additions
create table if not exists public.reels (
  id uuid primary key default gen_random_uuid(),
  author_profile_id uuid not null references public.profiles(id) on delete cascade,
  tree_id uuid references public.family_trees(id) on delete cascade,
  storage_path text not null,
  thumbnail_path text,
  caption text,
  duration_seconds integer,
  visibility text not null default 'family'
    check(visibility in ('private','family','selected','public')),
  status text not null default 'active'
    check(status in ('active','hidden','deleted')),
  created_at timestamptz not null default now()
);

create table if not exists public.reel_reactions (
  id uuid primary key default gen_random_uuid(),
  reel_id uuid not null references public.reels(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  reaction_type text not null default 'like',
  created_at timestamptz not null default now(),
  unique(reel_id, profile_id)
);

create table if not exists public.reel_comments (
  id uuid primary key default gen_random_uuid(),
  reel_id uuid not null references public.reels(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  body text not null,
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists public.reel_reports (
  id uuid primary key default gen_random_uuid(),
  reel_id uuid not null references public.reels(id) on delete cascade,
  reported_by uuid not null references public.profiles(id) on delete cascade,
  reason text not null,
  status text not null default 'pending'
    check(status in ('pending','reviewed','dismissed')),
  reviewed_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists idx_reels_tree_created
on public.reels(tree_id, created_at desc);

create index if not exists idx_reel_comments_reel
on public.reel_comments(reel_id, created_at);

-- Create private Storage buckets from the Supabase dashboard:
-- family-reels
-- family-reel-thumbnails
--
-- Add Storage RLS policies before production.
