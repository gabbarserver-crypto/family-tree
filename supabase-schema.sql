-- FamilyTree V7 Supabase foundation
-- Run this in Supabase SQL Editor after creating a project.
-- Review and test policies before production use.

create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  email text,
  phone text,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.persons (
  id uuid primary key default gen_random_uuid(),
  person_code text not null unique,
  full_name text not null,
  dob date,
  gender text,
  mobile text,
  email text,
  avatar_url text,
  status text not null default 'unclaimed'
    check (status in ('unclaimed','claimed','merged')),
  claimed_by uuid references public.profiles(id) on delete set null,
  merged_into_person_id uuid references public.persons(id) on delete set null,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.family_trees (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.tree_members (
  id uuid primary key default gen_random_uuid(),
  tree_id uuid not null references public.family_trees(id) on delete cascade,
  person_id uuid not null references public.persons(id) on delete cascade,
  added_by uuid references public.profiles(id) on delete set null,
  role text not null default 'member',
  created_at timestamptz not null default now(),
  unique(tree_id, person_id)
);

create table if not exists public.relationships (
  id uuid primary key default gen_random_uuid(),
  tree_id uuid not null references public.family_trees(id) on delete cascade,
  person_a_id uuid not null references public.persons(id) on delete cascade,
  person_b_id uuid not null references public.persons(id) on delete cascade,
  relationship_type text not null,
  created_by uuid references public.profiles(id) on delete set null,
  status text not null default 'active'
    check (status in ('active','removed')),
  created_at timestamptz not null default now(),
  unique(tree_id, person_a_id, person_b_id, relationship_type),
  check(person_a_id <> person_b_id)
);

create table if not exists public.connection_requests (
  id uuid primary key default gen_random_uuid(),
  tree_id uuid references public.family_trees(id) on delete cascade,
  requested_by uuid not null references public.profiles(id) on delete cascade,
  person_id uuid not null references public.persons(id) on delete cascade,
  status text not null default 'pending'
    check (status in ('pending','approved','rejected','cancelled')),
  created_at timestamptz not null default now()
);

create table if not exists public.claim_requests (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references public.persons(id) on delete cascade,
  requested_by uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'pending'
    check (status in ('pending','verified','rejected')),
  verified_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.duplicate_candidates (
  id uuid primary key default gen_random_uuid(),
  person_a_id uuid not null references public.persons(id) on delete cascade,
  person_b_id uuid not null references public.persons(id) on delete cascade,
  confidence numeric(5,2) not null default 0,
  reason text,
  status text not null default 'pending'
    check(status in ('pending','accepted','dismissed')),
  reviewed_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  unique(person_a_id, person_b_id)
);

create table if not exists public.merge_requests (
  id uuid primary key default gen_random_uuid(),
  source_person_id uuid not null references public.persons(id) on delete cascade,
  target_person_id uuid not null references public.persons(id) on delete cascade,
  requested_by uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'pending'
    check(status in ('pending','approved','rejected','completed')),
  reviewed_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  check(source_person_id <> target_person_id)
);

create table if not exists public.merge_audit (
  id uuid primary key default gen_random_uuid(),
  source_person_id uuid not null,
  target_person_id uuid not null,
  performed_by uuid references public.profiles(id) on delete set null,
  selected_fields jsonb,
  relationship_changes jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.posts (
  id uuid primary key default gen_random_uuid(),
  author_profile_id uuid not null references public.profiles(id) on delete cascade,
  tree_id uuid references public.family_trees(id) on delete cascade,
  body text,
  post_type text not null default 'text',
  visibility text not null default 'family'
    check(visibility in ('private','family','selected','public')),
  created_at timestamptz not null default now()
);

create table if not exists public.events (
  id uuid primary key default gen_random_uuid(),
  tree_id uuid references public.family_trees(id) on delete cascade,
  person_id uuid references public.persons(id) on delete cascade,
  title text not null,
  event_type text not null,
  event_date date not null,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_profile_id uuid not null references public.profiles(id) on delete cascade,
  type text not null,
  payload jsonb not null default '{}'::jsonb,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_persons_code on public.persons(person_code);
create index if not exists idx_persons_mobile on public.persons(mobile);
create index if not exists idx_tree_members_tree on public.tree_members(tree_id);
create index if not exists idx_tree_members_person on public.tree_members(person_id);
create index if not exists idx_relationships_tree on public.relationships(tree_id);
create index if not exists idx_posts_tree_created on public.posts(tree_id, created_at desc);
create index if not exists idx_notifications_recipient on public.notifications(recipient_profile_id, created_at desc);

-- IMPORTANT:
-- Enable RLS and write production policies before exposing the database.
-- Do not use the service-role key in browser/client code.
