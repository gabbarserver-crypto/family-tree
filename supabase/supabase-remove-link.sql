-- Run once in Supabase -> SQL Editor.
-- Lets a user remove a WRONG relationship link (both profiles stay; only the link is removed).
-- The link is marked status = 'removed' (not hard-deleted) in the tree that holds it AND in every tree
-- linked to it by an accepted connection request, so it does not come back from the other side.

create or replace function public._linked_trees(p_tree uuid) returns setof uuid
language sql security definer set search_path = public stable as $$
  select distinct l from (
    -- trees of people who accepted a request sent from p_tree
    select (select t.id from public.family_trees t where t.owner_id = p.claimed_by order by t.created_at limit 1) as l
    from public.connection_requests cr
    join public.persons p on p.id = cr.person_id
    where cr.tree_id = p_tree and cr.status::text = 'approved' and p.claimed_by is not null
    union all
    -- trees that sent an accepted request to the owner of p_tree
    select cr.tree_id
    from public.connection_requests cr
    join public.persons p on p.id = cr.person_id
    where cr.status::text = 'approved' and p.claimed_by is not null
      and p_tree = (select t.id from public.family_trees t where t.owner_id = p.claimed_by order by t.created_at limit 1)
  ) x
  where l is not null and l <> p_tree;
$$;
revoke all on function public._linked_trees(uuid) from public;
revoke all on function public._linked_trees(uuid) from authenticated;

create or replace function public.remove_relationship_everywhere(p_relationship_id uuid) returns integer
language plpgsql security definer set search_path = public as $$
declare r record; n integer := 0; t uuid; allowed boolean := false;
begin
  if auth.uid() is null then raise exception 'Please sign in'; end if;
  select * into r from public.relationships where id = p_relationship_id;
  if not found then return 0; end if;

  -- allowed if you own the tree that holds the link, or a tree linked to it
  if exists (select 1 from public.family_trees ft where ft.id = r.tree_id and ft.owner_id = auth.uid()) then
    allowed := true;
  else
    for t in select * from public._linked_trees(r.tree_id) loop
      if exists (select 1 from public.family_trees ft where ft.id = t and ft.owner_id = auth.uid()) then allowed := true; end if;
    end loop;
  end if;
  if not allowed then raise exception 'You are not allowed to remove this link'; end if;

  update public.relationships x set status = 'removed'
  where (x.tree_id = r.tree_id or x.tree_id in (select * from public._linked_trees(r.tree_id)))
    and x.relationship_type = r.relationship_type
    and coalesce(x.status::text, 'active') <> 'removed'
    and ((x.person_a_id = r.person_a_id and x.person_b_id = r.person_b_id)
      or (r.relationship_type = 'spouse' and x.person_a_id = r.person_b_id and x.person_b_id = r.person_a_id));
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.remove_relationship_everywhere(uuid) from public;
grant execute on function public.remove_relationship_everywhere(uuid) to authenticated;
