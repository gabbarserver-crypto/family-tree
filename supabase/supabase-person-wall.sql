-- Person Wall: family members write on a person's wall, with likes, comments and tags.
-- Run once in the Supabase SQL editor (after the base schema + supabase-chat.sql).
-- Everything goes through the SECURITY DEFINER functions below; the tables themselves are closed to direct access.

create table if not exists public.person_wall_posts (
  id                uuid primary key default gen_random_uuid(),
  person_id         uuid not null references public.persons(id) on delete cascade,
  author_id         uuid not null references public.profiles(id) on delete cascade,
  author_name       text,
  body              text not null check (char_length(body) between 1 and 2000),
  tagged_person_ids uuid[] not null default '{}',
  created_at        timestamptz not null default now()
);
create index if not exists person_wall_posts_person_idx on public.person_wall_posts (person_id, created_at desc);

create table if not exists public.person_wall_likes (
  post_id    uuid not null references public.person_wall_posts(id) on delete cascade,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);

create table if not exists public.person_wall_comments (
  id          uuid primary key default gen_random_uuid(),
  post_id     uuid not null references public.person_wall_posts(id) on delete cascade,
  author_id   uuid not null references public.profiles(id) on delete cascade,
  author_name text,
  body        text not null check (char_length(body) between 1 and 1000),
  created_at  timestamptz not null default now()
);
create index if not exists person_wall_comments_post_idx on public.person_wall_comments (post_id, created_at);

alter table public.person_wall_posts    enable row level security;
alter table public.person_wall_likes    enable row level security;
alter table public.person_wall_comments enable row level security;
-- (no policies on purpose: only the functions below can read/write these tables)

-- Who may see / write on a person's wall: the owner of a tree that contains the person, or anyone whose
-- claimed profile is a member of such a tree (same rule as the family chat).
create or replace function public.can_view_person_wall(p_person_id uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from public.tree_members tm
    join public.family_trees t on t.id = tm.tree_id
    where tm.person_id = p_person_id
      and (
        t.owner_id = auth.uid()
        or exists (
          select 1 from public.tree_members tm2
          join public.persons pc on pc.id = tm2.person_id
          where tm2.tree_id = tm.tree_id and pc.claimed_by = auth.uid()
        )
      )
  );
$$;

create or replace function public._wall_author_name()
returns text
language sql stable security definer set search_path = public as $$
  select coalesce((select p.full_name from public.persons p where p.claimed_by = auth.uid() limit 1), 'Family member');
$$;

-- Posts on one person's wall (newest first) with like / comment counts and tagged people.
create or replace function public.list_person_wall(p_person_id uuid)
returns table (
  id uuid, author_id uuid, author_name text, body text, created_at timestamptz,
  tagged jsonb, like_count bigint, liked_by_me boolean, comment_count bigint, can_delete boolean
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
      or exists (select 1 from public.persons x where x.id = p_person_id and x.claimed_by = auth.uid()))
  from public.person_wall_posts w
  where w.person_id = p_person_id
  order by w.created_at desc
  limit 100;
end $$;

-- New post. Tags are limited to people who share a tree with the wall's person.
create or replace function public.add_person_wall_post(p_person_id uuid, p_body text, p_tagged uuid[] default '{}')
returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_tags uuid[]; v_body text := btrim(coalesce(p_body, ''));
begin
  if auth.uid() is null or not public.can_view_person_wall(p_person_id) then
    raise exception 'No access to this wall';
  end if;
  if char_length(v_body) = 0 or char_length(v_body) > 2000 then raise exception 'Post must be 1 to 2000 characters'; end if;
  select coalesce(array_agg(distinct tm.person_id), '{}') into v_tags
  from public.tree_members tm
  where tm.person_id = any (coalesce(p_tagged, '{}'))
    and tm.tree_id in (select tree_id from public.tree_members where person_id = p_person_id);
  insert into public.person_wall_posts (person_id, author_id, author_name, body, tagged_person_ids)
  values (p_person_id, auth.uid(), public._wall_author_name(), v_body, v_tags)
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.delete_person_wall_post(p_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare v_person uuid; v_author uuid;
begin
  select person_id, author_id into v_person, v_author from public.person_wall_posts where id = p_id;
  if v_person is null then return; end if;
  if v_author = auth.uid()
     or exists (select 1 from public.persons x where x.id = v_person and x.claimed_by = auth.uid()) then
    delete from public.person_wall_posts where id = p_id;
  else
    raise exception 'You can only delete your own post';
  end if;
end $$;

-- Like / unlike (toggle). Returns the new state.
create or replace function public.toggle_wall_like(p_post_id uuid)
returns table (liked boolean, like_count bigint)
language plpgsql security definer set search_path = public as $$
declare v_person uuid; v_liked boolean;
begin
  select person_id into v_person from public.person_wall_posts where id = p_post_id;
  if v_person is null or auth.uid() is null or not public.can_view_person_wall(v_person) then
    raise exception 'No access to this wall';
  end if;
  if exists (select 1 from public.person_wall_likes where post_id = p_post_id and user_id = auth.uid()) then
    delete from public.person_wall_likes where post_id = p_post_id and user_id = auth.uid();
    v_liked := false;
  else
    insert into public.person_wall_likes (post_id, user_id) values (p_post_id, auth.uid());
    v_liked := true;
  end if;
  return query select v_liked, (select count(*) from public.person_wall_likes l where l.post_id = p_post_id);
end $$;

create or replace function public.list_wall_comments(p_post_id uuid)
returns table (id uuid, author_name text, body text, created_at timestamptz, can_delete boolean)
language plpgsql stable security definer set search_path = public as $$
declare v_person uuid;
begin
  select person_id into v_person from public.person_wall_posts where public.person_wall_posts.id = p_post_id;
  if v_person is null or auth.uid() is null or not public.can_view_person_wall(v_person) then
    raise exception 'No access to this wall';
  end if;
  return query
  select c.id, c.author_name, c.body, c.created_at,
    (c.author_id = auth.uid()
      or exists (select 1 from public.persons x where x.id = v_person and x.claimed_by = auth.uid()))
  from public.person_wall_comments c
  where c.post_id = p_post_id
  order by c.created_at;
end $$;

create or replace function public.add_wall_comment(p_post_id uuid, p_body text)
returns uuid
language plpgsql security definer set search_path = public as $$
declare v_person uuid; v_id uuid; v_body text := btrim(coalesce(p_body, ''));
begin
  select person_id into v_person from public.person_wall_posts where id = p_post_id;
  if v_person is null or auth.uid() is null or not public.can_view_person_wall(v_person) then
    raise exception 'No access to this wall';
  end if;
  if char_length(v_body) = 0 or char_length(v_body) > 1000 then raise exception 'Comment must be 1 to 1000 characters'; end if;
  insert into public.person_wall_comments (post_id, author_id, author_name, body)
  values (p_post_id, auth.uid(), public._wall_author_name(), v_body)
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.delete_wall_comment(p_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare v_person uuid; v_author uuid;
begin
  select p.person_id, c.author_id into v_person, v_author
  from public.person_wall_comments c join public.person_wall_posts p on p.id = c.post_id where c.id = p_id;
  if v_person is null then return; end if;
  if v_author = auth.uid()
     or exists (select 1 from public.persons x where x.id = v_person and x.claimed_by = auth.uid()) then
    delete from public.person_wall_comments where id = p_id;
  else
    raise exception 'You can only delete your own comment';
  end if;
end $$;

revoke all on function public._wall_author_name() from public;
revoke all on function public._wall_author_name() from authenticated;
grant execute on function public.can_view_person_wall(uuid)                   to authenticated;
grant execute on function public.list_person_wall(uuid)                       to authenticated;
grant execute on function public.add_person_wall_post(uuid, text, uuid[])     to authenticated;
grant execute on function public.delete_person_wall_post(uuid)                to authenticated;
grant execute on function public.toggle_wall_like(uuid)                       to authenticated;
grant execute on function public.list_wall_comments(uuid)                     to authenticated;
grant execute on function public.add_wall_comment(uuid, text)                 to authenticated;
grant execute on function public.delete_wall_comment(uuid)                    to authenticated;

-- ===== Family Wall feed: everyone's posts in one list (Wall tab) =====
create or replace function public.can_view_tree_wall(p_tree_id uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.family_trees t where t.id = p_tree_id and t.owner_id = auth.uid())
      or exists (
        select 1 from public.tree_members tm
        join public.persons p on p.id = tm.person_id
        where tm.tree_id = p_tree_id and p.claimed_by = auth.uid()
      );
$$;

create or replace function public.list_wall_feed(p_tree_id uuid)
returns table (
  id uuid, person_id uuid, person_name text, on_own_wall boolean,
  author_id uuid, author_name text, body text, created_at timestamptz,
  tagged jsonb, like_count bigint, liked_by_me boolean, comment_count bigint, can_delete boolean
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
    (w.author_id = auth.uid() or wp.claimed_by = auth.uid())
  from public.person_wall_posts w
  join public.persons wp on wp.id = w.person_id
  where exists (select 1 from public.tree_members tm where tm.tree_id = p_tree_id and tm.person_id = w.person_id)
  order by w.created_at desc
  limit 100;
end $$;

grant execute on function public.can_view_tree_wall(uuid) to authenticated;
grant execute on function public.list_wall_feed(uuid)     to authenticated;
