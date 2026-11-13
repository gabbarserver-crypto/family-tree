-- supabase-v11-support.sql  (RECONSTRUCTED from the live database)
-- Creates the support / admin tables. Run this BEFORE supabase-support.sql (which adds the policies,
-- helper functions and the status trigger on top of these tables).
-- Items marked ASSUMED are not visible in the dump (primary/foreign keys, unique constraints, indexes).

create table if not exists public.admin_roles (
  id         uuid primary key default gen_random_uuid(),
  profile_id uuid not null,
  role       text not null,
  granted_by uuid,
  created_at timestamptz not null default now()
);

create table if not exists public.support_staff (
  id         uuid primary key default gen_random_uuid(),
  profile_id uuid not null,
  role       text not null default 'support',
  active     boolean not null default true,
  created_at timestamptz not null default now()
);
create unique index if not exists support_staff_profile_idx on public.support_staff (profile_id);   -- ASSUMED

create table if not exists public.support_tickets (
  id                   uuid primary key default gen_random_uuid(),
  ticket_code          text not null unique,                    -- ASSUMED unique
  requester_profile_id uuid not null,
  assigned_to          uuid,
  category             text not null default 'other',
  priority             text not null default 'medium',
  subject              text not null,
  description          text,
  status               text not null default 'open',            -- open | in_progress | resolved | closed
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  resolved_at          timestamptz
);
create index if not exists support_tickets_requester_idx on public.support_tickets (requester_profile_id, created_at desc);  -- ASSUMED
create index if not exists support_tickets_status_idx    on public.support_tickets (status, updated_at desc);                 -- ASSUMED

create table if not exists public.support_messages (
  id                uuid primary key default gen_random_uuid(),
  ticket_id         uuid not null references public.support_tickets(id) on delete cascade,   -- ASSUMED fk
  sender_profile_id uuid not null,
  message           text not null,
  created_at        timestamptz not null default now(),
  read_at           timestamptz
);
create index if not exists support_messages_ticket_idx on public.support_messages (ticket_id, created_at);   -- ASSUMED

create table if not exists public.support_attachments (
  id            uuid primary key default gen_random_uuid(),
  ticket_id     uuid not null references public.support_tickets(id) on delete cascade,        -- ASSUMED fk
  message_id    uuid,
  uploaded_by   uuid not null,
  storage_path  text not null,
  original_name text,
  mime_type     text,
  created_at    timestamptz not null default now()
);

create table if not exists public.support_ticket_events (
  id               uuid primary key default gen_random_uuid(),
  ticket_id        uuid not null references public.support_tickets(id) on delete cascade,    -- ASSUMED fk
  actor_profile_id uuid,
  event_type       text not null,
  metadata         jsonb not null default '{}'::jsonb,
  created_at       timestamptz not null default now()
);

-- Row Level Security must be ON for every table. The policies themselves are in supabase-support.sql.
-- admin_roles has no policy on purpose: it is read only inside SECURITY DEFINER functions (is_support_staff).
alter table public.admin_roles           enable row level security;
alter table public.support_staff         enable row level security;
alter table public.support_tickets       enable row level security;
alter table public.support_messages      enable row level security;
alter table public.support_attachments   enable row level security;
alter table public.support_ticket_events enable row level security;

-- Storage: create a PRIVATE bucket named  support-attachments  (Dashboard -> Storage), then add storage policies.
