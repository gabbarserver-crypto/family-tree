-- Emoji reactions on wall posts (replaces the single "like"): like, heart, laugh, sad, namaste, highfive.
-- Run once in the Supabase SQL editor AFTER supabase-wall-location.sql.
-- One reaction per person per post. Old likes become the heart reaction.

alter table public.person_wall_likes add column if not exists reaction text not null default 'heart';
alter table public.person_wall_likes drop constraint if exists person_wall_likes_reaction_chk;
alter table public.person_wall_likes add constraint person_wall_likes_reaction_chk
  check (reaction in ('like', 'heart', 'laugh', 'sad', 'namaste', 'highfive'));

-- Set / change / remove my reaction. p_reaction = null, or the same reaction again, removes it.
create or replace function public.set_wall_reaction(p_post_id uuid, p_reaction text)
returns table (my_reaction text, reactions jsonb)
language plpgsql security definer set search_path = public as $$
declare v_person uuid; v_cur text; v_new text;
begin
  select person_id into v_person from public.person_wall_posts where id = p_post_id;
  if v_person is null or auth.uid() is null or not public.can_view_person_wall(v_person) then
    raise exception 'No access to this wall';
  end if;
  if p_reaction is not null and p_reaction not in ('like', 'heart', 'laugh', 'sad', 'namaste', 'highfive') then
    raise exception 'Invalid reaction';
  end if;
  select l.reaction into v_cur from public.person_wall_likes l where l.post_id = p_post_id and l.user_id = auth.uid();
  if p_reaction is null or p_reaction = v_cur then
    delete from public.person_wall_likes where post_id = p_post_id and user_id = auth.uid();
    v_new := null;
  else
    insert into public.person_wall_likes (post_id, user_id, reaction) values (p_post_id, auth.uid(), p_reaction)
    on conflict (post_id, user_id) do update set reaction = excluded.reaction, created_at = now();
    v_new := p_reaction;
  end if;
  return query select v_new,
    coalesce((select jsonb_object_agg(x.reaction, x.c) from (select l.reaction, count(*) c from public.person_wall_likes l where l.post_id = p_post_id group by l.reaction) x), '{}'::jsonb);
end $$;
grant execute on function public.set_wall_reaction(uuid, text) to authenticated;

drop function if exists public.list_person_wall(uuid);
drop function if exists public.list_wall_feed(uuid);

create or replace function public.list_person_wall(p_person_id uuid)
returns table (
  id uuid, author_id uuid, author_name text, body text, created_at timestamptz,
  tagged jsonb, like_count bigint, liked_by_me boolean, comment_count bigint, can_delete boolean, media jsonb,
  place_name text, lat double precision, lng double precision,
  reactions jsonb, my_reaction text
)
language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null or not public.can_view_person_wall(p_person_id) then
    raise exception 'No access to this wall';
  end if;
  return query
  select w.id, w.author_id, w.author_name, w.body, w.created_at,
    coalesce((select jsonb_agg(jsonb_build_object('id', pp.id, 'name', pp.full_name) order by pp.full_name)
              from public.persons pp where pp.id = any (w.tagged_person_ids)), '[]'::jsonb),
    (select count(*) from public.person_wall_likes l where l.post_id = w.id),
    exists (select 1 from public.person_wall_likes l where l.post_id = w.id and l.user_id = auth.uid()),
    (select count(*) from public.person_wall_comments c where c.post_id = w.id),
    (w.author_id = auth.uid()
      or exists (select 1 from public.persons x where x.id = p_person_id and x.claimed_by = auth.uid())),
    w.media, w.place_name, w.lat, w.lng,
    coalesce((select jsonb_object_agg(x.reaction, x.c) from (select l.reaction, count(*) c from public.person_wall_likes l where l.post_id = w.id group by l.reaction) x), '{}'::jsonb),
    (select l.reaction from public.person_wall_likes l where l.post_id = w.id and l.user_id = auth.uid())
  from public.person_wall_posts w
  where w.person_id = p_person_id
  order by w.created_at desc
  limit 100;
end $$;

create or replace function public.list_wall_feed(p_tree_id uuid)
returns table (
  id uuid, person_id uuid, person_name text, on_own_wall boolean,
  author_id uuid, author_name text, body text, created_at timestamptz,
  tagged jsonb, like_count bigint, liked_by_me boolean, comment_count bigint, can_delete boolean, media jsonb,
  place_name text, lat double precision, lng double precision,
  reactions jsonb, my_reaction text
)
language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null or not public.can_view_tree_wall(p_tree_id) then
    raise exception 'No access to this wall';
  end if;
  return query
  select w.id, w.person_id, wp.full_name,
    coalesce(wp.claimed_by = w.author_id, false),
    w.author_id, w.author_name, w.body, w.created_at,
    coalesce((select jsonb_agg(jsonb_build_object('id', pp.id, 'name', pp.full_name) order by pp.full_name)
              from public.persons pp where pp.id = any (w.tagged_person_ids)), '[]'::jsonb),
    (select count(*) from public.person_wall_likes l where l.post_id = w.id),
    exists (select 1 from public.person_wall_likes l where l.post_id = w.id and l.user_id = auth.uid()),
    (select count(*) from public.person_wall_comments c where c.post_id = w.id),
    (w.author_id = auth.uid() or wp.claimed_by = auth.uid()),
    w.media, w.place_name, w.lat, w.lng,
    coalesce((select jsonb_object_agg(x.reaction, x.c) from (select l.reaction, count(*) c from public.person_wall_likes l where l.post_id = w.id group by l.reaction) x), '{}'::jsonb),
    (select l.reaction from public.person_wall_likes l where l.post_id = w.id and l.user_id = auth.uid())
  from public.person_wall_posts w
  join public.persons wp on wp.id = w.person_id
  where exists (select 1 from public.tree_members tm where tm.tree_id = p_tree_id and tm.person_id = w.person_id)
  order by w.created_at desc
  limit 100;
end $$;

grant execute on function public.list_person_wall(uuid) to authenticated;
grant execute on function public.list_wall_feed(uuid) to authenticated;
