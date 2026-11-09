-- Tree owner / admins may change the profile photo of ANY person in their tree (including claimed profiles).
-- Run once in the Supabase SQL editor. Needs public._is_tree_admin() from supabase-admin-claim.sql.
create or replace function public.set_person_avatar(p_person_id uuid, p_avatar_url text) returns void
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); ok boolean;
begin
  if uid is null then raise exception 'Please sign in'; end if;
  select exists (
    select 1 from tree_members tm
    where tm.person_id = p_person_id and public._is_tree_admin(tm.tree_id)
  ) into ok;
  if not ok then raise exception 'Only a tree owner or admin can change this photo'; end if;
  update persons set avatar_url = p_avatar_url where id = p_person_id;
end $$;
revoke all on function public.set_person_avatar(uuid, text) from public;
grant execute on function public.set_person_avatar(uuid, text) to authenticated;
