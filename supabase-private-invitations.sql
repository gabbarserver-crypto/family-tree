-- Private Invitation Checklist. Run once in Supabase SQL Editor.
-- Guest names, phone numbers and locations are visible only to the invitation creator.
create table if not exists public.private_invitation_events (
 id uuid primary key default gen_random_uuid(),
 tree_id uuid not null,
 created_by uuid not null references auth.users(id) on delete cascade,
 title text not null check (char_length(title) between 1 and 120),
 invitation_date date not null, venue text, notes text,
 created_at timestamptz not null default now()
);
create table if not exists public.private_invitation_guests (
 id uuid primary key default gen_random_uuid(),
 invitation_id uuid not null references public.private_invitation_events(id) on delete cascade,
 tree_id uuid not null,
 created_by uuid not null references auth.users(id) on delete cascade,
 person_id uuid, family_head_person_id uuid,
 is_family_head boolean not null default false,
 guest_name text not null check (char_length(guest_name) between 1 and 120),
 mobile text, location text,
 age_group text not null default 'adult' check (age_group in ('adult','child')),
 invitation_status text not null default 'pending' check (invitation_status in ('pending','sent','accepted','declined')),
 created_at timestamptz not null default now()
);
create index if not exists private_invitation_events_creator_idx on public.private_invitation_events(created_by,tree_id,invitation_date);
create index if not exists private_invitation_guests_event_idx on public.private_invitation_guests(invitation_id,created_at);
create unique index if not exists private_invitation_guest_person_unique on public.private_invitation_guests(invitation_id,person_id) where person_id is not null;
alter table public.private_invitation_events enable row level security;
alter table public.private_invitation_guests enable row level security;
drop policy if exists "Creators manage private invitation events" on public.private_invitation_events;
create policy "Creators manage private invitation events" on public.private_invitation_events for all using(created_by=auth.uid()) with check(created_by=auth.uid());
drop policy if exists "Creators manage private invitation guests" on public.private_invitation_guests;
create policy "Creators manage private invitation guests" on public.private_invitation_guests for all
using(created_by=auth.uid() and exists(select 1 from public.private_invitation_events e where e.id=invitation_id and e.created_by=auth.uid()))
with check(created_by=auth.uid() and exists(select 1 from public.private_invitation_events e where e.id=invitation_id and e.created_by=auth.uid()));
grant select,insert,update,delete on public.private_invitation_events to authenticated;
grant select,insert,update,delete on public.private_invitation_guests to authenticated;
