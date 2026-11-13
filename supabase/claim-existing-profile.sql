-- claim-existing-profile.sql  (RECONSTRUCTED from the live database)
-- Lets a new user claim an existing unclaimed profile; the profile creator / tree owner approves.
-- Run after persons, tree_members, family_trees, profiles exist.
-- Items marked ASSUMED are not visible in the dump (constraints/indexes).

create table if not exists public.profile_claims (
  id           uuid primary key default gen_random_uuid(),
  person_id    uuid not null references public.persons(id) on delete cascade,   -- ASSUMED fk
  requester_id uuid not null,
  status       text not null default 'pending',   -- pending | approved | rejected | cancelled
  created_at   timestamptz not null default now(),
  reviewed_by  uuid,
  reviewed_at  timestamptz
);
-- ASSUMED: request_profile_claim() uses "on conflict do nothing", so one open claim per person+user
create unique index if not exists profile_claims_one_pending
  on public.profile_claims (person_id, requester_id) where status = 'pending';

alter table public.profile_claims enable row level security;
drop policy if exists cr_select_own on public.profile_claims;
create policy cr_select_own on public.profile_claims for select to authenticated using (requester_id = auth.uid());

-- ===== helpers =====
CREATE OR REPLACE FUNCTION public.ft_like(x text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
AS $function$
  select '%' || replace(replace(replace(trim(x), '\', '\\'), '%', '\%'), '_', '\_') || '%'
$function$;

CREATE OR REPLACE FUNCTION public.ft_can_approve_claim(p_person uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (select 1 from persons p where p.id = p_person and p.created_by = auth.uid())
      or exists (select 1 from tree_members tm join family_trees ft on ft.id = tm.tree_id
                 where tm.person_id = p_person and ft.owner_id = auth.uid());
$function$;

-- ===== claim flow =====
CREATE OR REPLACE FUNCTION public.request_profile_claim(p_person_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare rid uuid;
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  if exists (select 1 from persons where claimed_by = auth.uid()) then
    raise exception 'You already have a profile';
  end if;
  if not exists (select 1 from persons where id = p_person_id and claimed_by is null
                 and coalesce(status,'unclaimed') = 'unclaimed') then
    raise exception 'This profile is not available to claim';
  end if;
  insert into profile_claims (person_id, requester_id) values (p_person_id, auth.uid())
  on conflict do nothing returning id into rid;
  if rid is null then
    select id into rid from profile_claims
    where person_id = p_person_id and requester_id = auth.uid() and status = 'pending';
  end if;
  return rid;
end $function$;

CREATE OR REPLACE FUNCTION public.approve_profile_claim(p_request_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare req profile_claims;
begin
  select * into req from profile_claims where id = p_request_id and status = 'pending' for update;
  if not found then raise exception 'Request not found or already handled'; end if;
  if not ft_can_approve_claim(req.person_id) then raise exception 'Only the person who added this profile can approve'; end if;
  if exists (select 1 from persons where claimed_by = req.requester_id) then
    raise exception 'This user already has a profile';
  end if;
  update persons set claimed_by = req.requester_id, status = 'claimed'
  where id = req.person_id and claimed_by is null;
  if not found then raise exception 'This profile was already claimed'; end if;
  update profile_claims set status = 'approved', reviewed_by = auth.uid(), reviewed_at = now() where id = req.id;
  update profile_claims set status = 'rejected', reviewed_by = auth.uid(), reviewed_at = now()
  where person_id = req.person_id and status = 'pending';
end $function$;

CREATE OR REPLACE FUNCTION public.reject_profile_claim(p_request_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare req profile_claims;
begin
  select * into req from profile_claims where id = p_request_id and status = 'pending';
  if not found then return; end if;
  if not ft_can_approve_claim(req.person_id) then raise exception 'Not allowed'; end if;
  update profile_claims set status = 'rejected', reviewed_by = auth.uid(), reviewed_at = now() where id = req.id;
end $function$;

CREATE OR REPLACE FUNCTION public.cancel_profile_claim(p_request_id uuid)
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  update profile_claims set status = 'cancelled', reviewed_at = now()
  where id = p_request_id and requester_id = auth.uid() and status = 'pending';
$function$;

CREATE OR REPLACE FUNCTION public.my_incoming_claims()
 RETURNS TABLE(request_id uuid, person_id uuid, person_name text, requester_name text, created_at timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select c.id, p.id, p.full_name,
         (select pr.display_name from profiles pr where pr.id = c.requester_id),
         c.created_at
  from profile_claims c join persons p on p.id = c.person_id
  where c.status = 'pending' and ft_can_approve_claim(p.id)
  order by c.created_at desc;
$function$;

CREATE OR REPLACE FUNCTION public.my_pending_claims()
 RETURNS TABLE(request_id uuid, person_name text, created_at timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select c.id, p.full_name, c.created_at
  from profile_claims c join persons p on p.id = c.person_id
  where c.requester_id = auth.uid() and c.status = 'pending'
  order by c.created_at desc;
$function$;

CREATE OR REPLACE FUNCTION public.search_unclaimed_profiles(p_name text, p_father text DEFAULT NULL::text, p_mother text DEFAULT NULL::text, p_spouse text DEFAULT NULL::text, p_sibling text DEFAULT NULL::text)
 RETURNS TABLE(person_id uuid, person_code text, full_name text, current_place text, birth_year integer, added_by_name text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  if p_name is null or length(trim(p_name)) < 3 then return; end if;

  return query
  select p.id, p.person_code, p.full_name, p.current_place,
         extract(year from p.dob)::int,
         (select pr.display_name from profiles pr where pr.id = p.created_by)
  from persons p
  where p.claimed_by is null
    and coalesce(p.status, 'unclaimed') = 'unclaimed'
    and coalesce(p.details->>'deleted', 'false') <> 'true'
    -- every word of the typed name must appear in the profile name
    and not exists (select 1 from unnest(regexp_split_to_array(trim(p_name), '\s+')) w
                    where p.full_name not ilike ft_like(w))
    -- father
    and (nullif(trim(p_father), '') is null or exists (
          select 1 from relationships r join persons f on f.id = r.person_a_id
          where r.relationship_type = 'parent' and r.status = 'active' and r.person_b_id = p.id
            and (f.gender is null or lower(f.gender) = 'male') and f.full_name ilike ft_like(p_father)))
    -- mother
    and (nullif(trim(p_mother), '') is null or exists (
          select 1 from relationships r join persons m on m.id = r.person_a_id
          where r.relationship_type = 'parent' and r.status = 'active' and r.person_b_id = p.id
            and (m.gender is null or lower(m.gender) = 'female') and m.full_name ilike ft_like(p_mother)))
    -- husband / wife
    and (nullif(trim(p_spouse), '') is null or exists (
          select 1 from relationships r
          join persons s on s.id = case when r.person_a_id = p.id then r.person_b_id else r.person_a_id end
          where r.relationship_type = 'spouse' and r.status = 'active'
            and p.id in (r.person_a_id, r.person_b_id) and s.full_name ilike ft_like(p_spouse)))
    -- brother / sister (shares a parent)
    and (nullif(trim(p_sibling), '') is null or exists (
          select 1 from relationships r1
          join relationships r2 on r2.person_a_id = r1.person_a_id and r2.person_b_id <> r1.person_b_id
                               and r2.relationship_type = 'parent' and r2.status = 'active'
          join persons sb on sb.id = r2.person_b_id
          where r1.relationship_type = 'parent' and r1.status = 'active' and r1.person_b_id = p.id
            and sb.full_name ilike ft_like(p_sibling)))
  order by p.full_name
  limit 10;
end $function$;

-- only signed-in users may call these
revoke execute on function public.request_profile_claim(uuid)  from public, anon;
revoke execute on function public.approve_profile_claim(uuid)  from public, anon;
revoke execute on function public.reject_profile_claim(uuid)   from public, anon;
revoke execute on function public.cancel_profile_claim(uuid)   from public, anon;
revoke execute on function public.my_incoming_claims()         from public, anon;
revoke execute on function public.my_pending_claims()          from public, anon;
revoke execute on function public.search_unclaimed_profiles(text, text, text, text, text) from public, anon;
grant  execute on function public.request_profile_claim(uuid)  to authenticated;
grant  execute on function public.approve_profile_claim(uuid)  to authenticated;
grant  execute on function public.reject_profile_claim(uuid)   to authenticated;
grant  execute on function public.cancel_profile_claim(uuid)   to authenticated;
grant  execute on function public.my_incoming_claims()         to authenticated;
grant  execute on function public.my_pending_claims()          to authenticated;
grant  execute on function public.search_unclaimed_profiles(text, text, text, text, text) to authenticated;
