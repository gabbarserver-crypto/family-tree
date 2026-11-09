-- Wall posts with an optional LOCATION (place name and/or latitude+longitude).
-- Run once in the Supabase SQL editor AFTER supabase-wall-media.sql.

alter table public.person_wall_posts add column if not exists place_name text;
alter table public.person_wall_posts add column if not exists lat double precision;
alter table public.person_wall_posts add column if not exists lng double precision;
alter table public.person_wall_posts drop constraint if exists person_wall_posts_place_chk;
alter table public.person_wall_posts add constraint person_wall_posts_place_chk check (
  (place_name is null or char_length(place_name) <= 160)
  and ((lat is null and lng is null) or (lat between -90 and 90 and lng between -180 and 180))
);

drop function if exists public.add_person_wall_post(uuid, text, uuid[], jsonb);
drop function if exists public.list_person_wall(uuid);
drop function if exists public.list_wall_feed(uuid);


create or replace function public.add_person_wall_post(
  p_person_id uuid, p_body text, p_tagged uuid[] default '{}', p_media jsonb default '[]'::jsonb,
  p_place_name text default null, p_lat double precision default null, p_lng double precision default null)
returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_tags uuid[]; v_body text := btrim(coalesce(p_body, '')); v_media jsonb := coalesce(p_media, '[]'::jsonb);
  v_place text := nullif(btrim(coalesce(p_place_name, '')), '');
begin
  if auth.uid() is null or not public.can_view_person_wall(p_person_id) then
    raise exception 'No access to this wall';
  end if;
  if jsonb_typeof(v_media) <> 'array' or jsonb_array_length(v_media) > 4 then raise exception 'Invalid media (max 4 files)'; end if;
  if exists (
    select 1 from jsonb_array_elements(v_media) e
    where coalesce(e->>'type', '') not in ('image', 'video')
       or coalesce(e->>'path', '') !~ ('^' || auth.uid()::text || '/[A-Za-z0-9._-]+$')
  ) then raise exception 'Invalid media'; end if;
  if char_length(v_body) > 2000 then raise exception 'Post must be at most 2000 characters'; end if;
  if char_length(v_body) = 0 and jsonb_array_length(v_media) = 0 then raise exception 'Write something or add a photo/video'; end if;
  if char_length(coalesce(v_place, '')) > 160 then raise exception 'Place name too long'; end if;
  if (p_lat is null) <> (p_lng is null) or p_lat not between -90 and 90 or p_lng not between -180 and 180 then raise exception 'Invalid location'; end if;
  select coalesce(array_agg(distinct tm.person_id), '{}') into v_tags
  from public.tree_members tm
  where tm.person_id = any (coalesce(p_tagged, '{}'))
    and tm.tree_id in (select tree_id from public.tree_members where person_id = p_person_id);
  insert into public.person_wall_posts (person_id, author_id, author_name, body, tagged_person_ids, media, place_name, lat, lng)
  values (p_person_id, auth.uid(), public._wall_author_name(), v_body, v_tags, v_media, v_place, p_lat, p_lng)
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.list_person_wall(p_person_id uuid)
returns table (
  id uuid, author_id uuid, author_name text, body text, created_at timestamptz,
  tagged jsonb, like_count bigint, liked_by_me boolean, comment_count bigint, can_delete boolean, media jsonb,
  place_name text, lat double precision, lng double precision
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
    w.media, w.place_name, w.lat, w.lng
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
  place_name text, lat double precision, lng double precision
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
    w.media, w.place_name, w.lat, w.lng
  from public.person_wall_posts w
  join public.persons wp on wp.id = w.person_id
  where exists (select 1 from public.tree_members tm where tm.tree_id = p_tree_id and tm.person_id = w.person_id)
  order by w.created_at desc
  limit 100;
end $$;

grant execute on function public.add_person_wall_post(uuid, text, uuid[], jsonb, text, double precision, double precision) to authenticated;
grant execute on function public.list_person_wall(uuid) to authenticated;
grant execute on function public.list_wall_feed(uuid) to authenticated;
