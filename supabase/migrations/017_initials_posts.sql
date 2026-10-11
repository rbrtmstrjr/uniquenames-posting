-- Unique Names posting: posts by initials (Today > Initials: two-word names whose first name starts with one chosen
-- letter and whose middle name starts with another, like "A·R" for Arjay Royce). Paste the whole file into the
-- Supabase SQL editor and run it. Safe to run more than once. Needs 016_swap_card_name.sql first (015_name_nest.sql is
-- not needed). A fresh project gets all of this from supabase/schema.sql already. One new nullable column and four
-- new functions; nothing the worker reads (no restart). Until this runs, a post by initials is still made from the
-- unused names and new AI names only (no names used before), without its "A·R" label.
--
-- The owner's rule: an initials post MAY reuse names used before, but new names always come first, in this order:
--   1. 'available' names with those initials, 2. fresh AI names (inserted here as the post's names), 3. names used
--   before ('used', or 'reserved' when not on a post being made), least recently used first (the app picks).
-- A reused name keeps its names row as it is (it stays on its first post): its card simply carries the name's text
-- with name_id null, so deleting or editing the new card never frees or renames the old post's name.

-- posts.initials: the two capital letters of a post by initials ('AR'); null on any other post.
alter table public.posts add column if not exists initials text;
alter table public.posts drop constraint if exists posts_initials_check;
alter table public.posts add constraint posts_initials_check check (initials is null or initials ~ '^[A-Z]{2}$');

-- set_name_origin: a fresh two-word name's origin ("Latin · Irish", the Name Nest card's chip; no US rank for a pair).
-- Only when the names.origin column exists (015_name_nest.sql): a project without it simply has no origins.
create or replace function public.set_name_origin(p_name uuid, p_origin text) returns void language plpgsql as $$
begin
  if nullif(btrim(coalesce(p_origin, '')), '') is null then return; end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'names' and column_name = 'origin') then
    return;
  end if;
  execute 'update public.names set origin = $1 where id = $2' using left(btrim(p_origin), 40), p_name;
end $$;

-- create_initials_post: a whole post by initials in ONE transaction, idempotent per request_id (a double press makes one
-- post). Each card says where its name comes from: source 'available' (name_id: locked, reserved like create_post),
-- 'new' (a fresh AI name: inserted into names as a reserved two-word name of the post) or 'used' (name_id: a name used
-- before, re-checked and locked, left as it is; the card gets name_id null). Answers {status: ok, post_id} |
-- {status: conflict, reason: theme | names} (the app re-plans) | {status: error, reason}.
create or replace function public.create_initials_post(p jsonb) returns jsonb language plpgsql as $$
declare
  v_req uuid := (p->>'request_id')::uuid;
  v_gender text := p->>'gender';
  v_theme_id uuid := (p->>'theme_id')::uuid;
  v_theme public.themes%rowtype;
  v_existing uuid; v_post uuid; v_avail uuid[]; v_used uuid[]; v_c jsonb; v_name uuid; v_pos int;
begin
  select id into v_existing from public.posts where request_id = v_req;
  if found then return jsonb_build_object('status', 'ok', 'post_id', v_existing); end if;

  if coalesce(p->>'initials', '') !~ '^[A-Z]{2}$' then
    return jsonb_build_object('status', 'error', 'reason', 'Pick two initials, A to Z.');
  end if;
  if jsonb_typeof(p->'cards') is distinct from 'array' or jsonb_array_length(p->'cards') = 0 then
    return jsonb_build_object('status', 'error', 'reason', 'The plan has no cards.');
  end if;
  if exists (select 1 from jsonb_array_elements(p->'cards') c
             where coalesce(c->>'source', '') not in ('available', 'new', 'used')
                or nullif(btrim(c->>'name'), '') is null or nullif(btrim(c->>'meaning'), '') is null
                or (c->>'source' <> 'new' and c->>'name_id' is null)) then
    return jsonb_build_object('status', 'error', 'reason', 'A card of the plan is not valid.');
  end if;
  if (select count(distinct lower(btrim(c->>'name'))) from jsonb_array_elements(p->'cards') c) <> jsonb_array_length(p->'cards') then
    return jsonb_build_object('status', 'error', 'reason', 'A name is in the plan twice.');
  end if;
  select array_agg((c->>'name_id')::uuid) filter (where c->>'source' = 'available'),
         array_agg((c->>'name_id')::uuid) filter (where c->>'source' = 'used')
    into v_avail, v_used from jsonb_array_elements(p->'cards') c;

  select * into v_theme from public.themes where id = v_theme_id for update;
  -- A twin request that held the theme lock until it committed: its post is visible now, so answer with it.
  select id into v_existing from public.posts where request_id = v_req;
  if found then return jsonb_build_object('status', 'ok', 'post_id', v_existing); end if;
  if v_theme.id is null or v_theme.status <> 'available' or v_theme.gender <> v_gender then
    return jsonb_build_object('status', 'conflict', 'reason', 'theme');
  end if;

  if v_avail is not null and (select count(*) from (
      select id from public.names where id = any (v_avail) and status = 'available' and gender = v_gender and style = 'two-word'
      for update) s) <> array_length(v_avail, 1) then
    return jsonb_build_object('status', 'conflict', 'reason', 'names');
  end if;
  if v_used is not null and (select count(*) from (
      select n.id from public.names n
      where n.id = any (v_used) and n.gender = v_gender and n.style = 'two-word'
        and (n.status = 'used' or (n.status = 'reserved'
             and not exists (select 1 from public.posts q where q.id = n.post_id and q.status = 'generating')))
      for update) s) <> array_length(v_used, 1) then
    return jsonb_build_object('status', 'conflict', 'reason', 'names');
  end if;
  if exists (select 1 from jsonb_array_elements(p->'cards') c join public.names n on lower(n.name) = lower(btrim(c->>'name'))
             where c->>'source' = 'new') then
    return jsonb_build_object('status', 'conflict', 'reason', 'names');
  end if;

  insert into public.posts (request_id, post_date, gender, style, theme_id, caption, title_font, meaning_font, mark_font, subject_age,
                            caption_style, hashtag_set, initials)
  values (v_req, (p->>'post_date')::date, v_gender, 'two-word', v_theme_id, coalesce(p->>'caption', ''),
          nullif(btrim(p->>'title_font'), ''), nullif(btrim(p->>'meaning_font'), ''), nullif(btrim(p->>'mark_font'), ''),
          nullif(btrim(p->>'subject_age'), ''), nullif(btrim(p->>'caption_style'), ''), nullif(btrim(p->>'hashtag_set'), ''),
          p->>'initials')
  returning id into v_post;

  for v_c in select value from jsonb_array_elements(p->'cards') loop
    v_pos := (v_c->>'position')::int;
    v_name := null;
    if v_c->>'source' = 'new' then
      insert into public.names (name, meaning, gender, style, status, post_id, position)
      values (btrim(v_c->>'name'), btrim(v_c->>'meaning'), v_gender, 'two-word', 'reserved', v_post, v_pos)
      returning id into v_name;
      perform public.set_name_origin(v_name, v_c->>'origin');
    elsif v_c->>'source' = 'available' then
      v_name := (v_c->>'name_id')::uuid;
      update public.names set status = 'reserved', post_id = v_post, position = v_pos where id = v_name;
    end if;
    insert into public.cards (post_id, theme_id, kind, position, name_id, name, meaning, shot, prompt, seed, order_index)
    values (v_post, v_theme_id, 'post', v_pos, v_name, btrim(v_c->>'name'), btrim(v_c->>'meaning'),
            v_c->>'shot', v_c->>'prompt', (v_c->>'seed')::bigint, v_pos);
  end loop;

  update public.themes set status = 'used', used_on = (p->>'post_date')::date where id = v_theme_id;

  return jsonb_build_object('status', 'ok', 'post_id', v_post);
exception when unique_violation then
  -- The same request committed meanwhile (answer with its post), or a fresh name was just added elsewhere (re-plan).
  select id into v_existing from public.posts where request_id = v_req;
  if v_existing is null then return jsonb_build_object('status', 'conflict', 'reason', 'names'); end if;
  return jsonb_build_object('status', 'ok', 'post_id', v_existing);
end $$;

-- add_initials_card: "Add card" on a post by initials, with the same three sources as create_initials_post. The name
-- must not be on the post already. Answers {status: ok, card_id} | {status: conflict} (re-plan) | {status: error, reason}.
create or replace function public.add_initials_card(p_post uuid, c jsonb) returns jsonb language plpgsql as $$
declare v_post public.posts%rowtype; v_card uuid; v_pos int; v_name uuid; v_src text := c->>'source';
begin
  select * into v_post from public.posts where id = p_post for update;
  if not found then return jsonb_build_object('status', 'error', 'reason', 'Post not found.'); end if;
  if v_post.initials is null then return jsonb_build_object('status', 'error', 'reason', 'This post is not a post by initials.'); end if;
  if coalesce(v_src, '') not in ('available', 'new', 'used') or nullif(btrim(c->>'name'), '') is null
     or nullif(btrim(c->>'meaning'), '') is null or (v_src <> 'new' and c->>'name_id' is null) then
    return jsonb_build_object('status', 'error', 'reason', 'The card is not valid.');
  end if;
  if exists (select 1 from public.cards where post_id = p_post and kind = 'post' and lower(name) = lower(btrim(c->>'name'))) then
    return jsonb_build_object('status', 'conflict');
  end if;
  if v_src = 'available' then
    perform 1 from public.names
      where id = (c->>'name_id')::uuid and status = 'available' and gender = v_post.gender and style = 'two-word' for update;
    if not found then return jsonb_build_object('status', 'conflict'); end if;
  elsif v_src = 'used' then
    perform 1 from public.names n
      where n.id = (c->>'name_id')::uuid and n.gender = v_post.gender and n.style = 'two-word'
        and (n.status = 'used' or (n.status = 'reserved'
             and not exists (select 1 from public.posts q where q.id = n.post_id and q.status = 'generating')))
      for update;
    if not found then return jsonb_build_object('status', 'conflict'); end if;
  elsif exists (select 1 from public.names where lower(name) = lower(btrim(c->>'name'))) then
    return jsonb_build_object('status', 'conflict');
  end if;

  select coalesce(max(position), 0) + 1 into v_pos from public.cards where post_id = p_post;
  if v_src = 'new' then
    insert into public.names (name, meaning, gender, style, status, post_id, position)
    values (btrim(c->>'name'), btrim(c->>'meaning'), v_post.gender, 'two-word', 'reserved', p_post, v_pos)
    returning id into v_name;
    perform public.set_name_origin(v_name, c->>'origin');
  elsif v_src = 'available' then
    v_name := (c->>'name_id')::uuid;
    update public.names set status = 'reserved', post_id = p_post, position = v_pos where id = v_name;
  end if;
  insert into public.cards (post_id, theme_id, kind, position, name_id, name, meaning, shot, prompt, seed, order_index)
  values (p_post, v_post.theme_id, 'post', v_pos, v_name, btrim(c->>'name'), btrim(c->>'meaning'), c->>'shot', c->>'prompt',
          (c->>'seed')::bigint, v_pos)
  returning id into v_card;
  if v_post.status = 'posted' then update public.posts set status = 'generating' where id = p_post; end if;
  return jsonb_build_object('status', 'ok', 'card_id', v_card);
exception when unique_violation then
  return jsonb_build_object('status', 'conflict');
end $$;

-- swap_initials_card_name: the card dialog's "My names" on a post by initials. Like swap_card_name (016), but the name
-- may also be one used before: an available name is reserved for the post (name_id set); a reusable used name is left
-- as it is and the card takes its text with name_id null. The card's old name goes back to 'available' when it came
-- from the names table and no other card uses it. Answers like swap_card_name: ok | stale | taken | error.
create or replace function public.swap_initials_card_name(p_card uuid, p_name uuid, p_version int, p_meaning text, p_mode text, p_seed bigint)
returns jsonb language plpgsql as $$
declare v_card public.cards%rowtype; v_post public.posts%rowtype; v_name public.names%rowtype; v_new uuid; v_meaning text;
begin
  if p_mode not in ('restamp', 'regenerate') then
    return jsonb_build_object('status', 'error', 'reason', 'Unknown mode.');
  end if;
  select * into v_card from public.cards where id = p_card for update;
  if not found then return jsonb_build_object('status', 'error', 'reason', 'Card not found.'); end if;
  if v_card.kind <> 'post' or v_card.post_id is null then
    return jsonb_build_object('status', 'error', 'reason', 'Only the name cards of a post take a name.');
  end if;
  select * into v_post from public.posts where id = v_card.post_id for update;
  if not found then return jsonb_build_object('status', 'error', 'reason', 'Post not found.'); end if;
  if v_post.initials is null then return jsonb_build_object('status', 'error', 'reason', 'This post is not a post by initials.'); end if;
  select * into v_name from public.names where id = p_name;
  if not found then return jsonb_build_object('status', 'taken'); end if;
  -- Calling it again after it succeeded answers ok.
  if v_card.name_id = p_name or (v_card.name_id is null and lower(v_card.name) = lower(v_name.name)) then
    return jsonb_build_object('status', 'ok', 'mode', p_mode);
  end if;
  if v_card.version <> p_version or v_card.status = 'generating' then return jsonb_build_object('status', 'stale'); end if;

  select * into v_name from public.names n
    where n.id = p_name and n.gender = v_post.gender and n.style = 'two-word'
      and (n.status in ('available', 'used') or (n.status = 'reserved'
           and not exists (select 1 from public.posts q where q.id = n.post_id and q.status = 'generating')))
    for update;
  if not found then return jsonb_build_object('status', 'taken'); end if;
  if exists (select 1 from public.cards where post_id = v_card.post_id and id <> p_card and kind = 'post' and lower(name) = lower(v_name.name)) then
    return jsonb_build_object('status', 'taken');
  end if;

  if v_card.name_id is not null then
    update public.names set status = 'available', post_id = null, position = null
      where id = v_card.name_id and status in ('reserved', 'used')
        and not exists (select 1 from public.cards where name_id = v_card.name_id and id <> p_card);
  end if;
  v_meaning := coalesce(nullif(btrim(p_meaning), ''), v_name.meaning);
  if v_name.status = 'available' then
    v_new := p_name;
    update public.names
      set status = case when v_post.status = 'posted' then 'used' else 'reserved' end,
          post_id = v_card.post_id, position = v_card.position, meaning = v_meaning
      where id = p_name;
  end if;

  if p_mode = 'restamp' then
    update public.cards set name = v_name.name, meaning = v_meaning, name_id = v_new,
      status = 'restamp', claimed_at = null, error = null, version = v_card.version + 1, queued_at = now()
      where id = p_card;
  else
    update public.cards set name = v_name.name, meaning = v_meaning, name_id = v_new,
      status = 'queued', claimed_at = null, started_at = null, finished_at = null, error = null, attempts = 0,
      version = v_card.version + 1, seed = p_seed, queued_at = now()
      where id = p_card;
  end if;
  return jsonb_build_object('status', 'ok', 'mode', p_mode);
end $$;

-- @supabase-only begin
revoke execute on function public.set_name_origin(uuid, text) from public, anon;
revoke execute on function public.create_initials_post(jsonb) from public, anon;
revoke execute on function public.add_initials_card(uuid, jsonb) from public, anon;
revoke execute on function public.swap_initials_card_name(uuid, uuid, int, text, text, bigint) from public, anon;
grant execute on function public.set_name_origin(uuid, text), public.create_initials_post(jsonb), public.add_initials_card(uuid, jsonb),
  public.swap_initials_card_name(uuid, uuid, int, text, text, bigint) to authenticated, service_role;
-- @supabase-only end
