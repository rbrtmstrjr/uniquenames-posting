-- Unique Names posting: database. Paste the whole file into the Supabase SQL editor and run it once.
-- A project created before v2 runs supabase/migrations/002_v2.sql, 003_post_fonts.sql, 004_subject_age.sql then 005_reels.sql instead (this file already includes them).
-- Status 'pending' = an AI-suggested name/theme waiting for approval; nothing here ever plans it (only 'available').

-- ---------------------------------------------------------------- tables
create table if not exists public.settings (
  id int primary key default 1 check (id = 1),
  caption_template text not null default 'Here are some beautiful names you can give to your baby {gender}. 🥰',
  hashtags text not null default '#parenting #uniquenames #fypシ #highlights #follower',
  handle text not null default '@unique_names',
  min_images int not null default 9 check (min_images between 1 and 30),
  max_images int not null default 13 check (max_images between 1 and 30),
  width int not null default 1080 check (width between 512 and 2048),
  height int not null default 1080 check (height between 512 and 2048),
  sound_on boolean not null default true,
  -- card text (v2): font ids from the app's font catalog (checked in app code), sizes in px on a 1080 px card
  title_font text not null default 'poppins' check (btrim(title_font) <> ''),
  meaning_font text not null default 'poppins' check (btrim(meaning_font) <> ''),
  mark_font text not null default 'poppins' check (btrim(mark_font) <> ''),
  title_size int not null default 95 check (title_size between 40 and 180),
  meaning_size int not null default 37 check (meaning_size between 16 and 90),
  mark_size int not null default 21 check (mark_size between 12 and 48),
  text_position text not null default 'auto' check (text_position in (
    'auto', 'top-left', 'top-center', 'top-right', 'middle-left', 'middle-center', 'middle-right',
    'bottom-left', 'bottom-center', 'bottom-right')),
  caption_ai boolean not null default true,
  -- reels (005): max images per reel; a 5-10 s reference clip in the reels bucket (null = Chatterbox's built-in voice)
  reel_max_images int not null default 40 constraint settings_reel_max_images_check check (reel_max_images between 10 and 40),
  reel_voice_path text,
  updated_at timestamptz not null default now(),
  check (min_images <= max_images)
);
insert into public.settings (id) values (1) on conflict do nothing;

create table if not exists public.worker_status (
  id int primary key default 1 check (id = 1),
  last_seen timestamptz,
  comfyui_ok boolean not null default false,
  gpu text,
  current_card_id uuid,
  worker_version text,
  message text,
  updated_at timestamptz not null default now()
);
insert into public.worker_status (id) values (1) on conflict do nothing;

create table if not exists public.themes (
  id uuid primary key default gen_random_uuid(),
  title text not null unique,
  gender text not null check (gender in ('boy', 'girl')),
  backdrop text not null, outfit text not null, props text not null, lighting text not null, palette text not null,
  status text not null default 'available' check (status in ('available', 'used', 'archived', 'pending')),
  sort_order int not null default 0,
  used_on date,
  preview_card_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.posts (
  id uuid primary key default gen_random_uuid(),
  request_id uuid unique,
  post_date date not null,
  gender text not null check (gender in ('boy', 'girl')),
  style text not null check (style in ('two-word', 'single')),
  theme_id uuid not null references public.themes (id),
  caption text not null default '',
  status text not null default 'generating' check (status in ('generating', 'ready', 'posted')),
  posted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- fonts chosen for this post on Today (003); null = use the fonts in settings
  title_font text,
  meaning_font text,
  mark_font text,
  -- the child's age chosen on Today (004): 'random' or 'newborn'/'1'..'7'; null = a post made before ages existed
  subject_age text check (subject_age in ('random', 'newborn', '1', '2', '3', '4', '5', '6', '7'))
);

create table if not exists public.names (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 40),
  meaning text not null check (char_length(meaning) between 1 and 80),
  gender text not null check (gender in ('boy', 'girl')),
  style text not null check (style in ('two-word', 'single')),
  status text not null default 'available' check (status in ('available', 'reserved', 'used', 'skip', 'pending')),
  post_id uuid references public.posts (id) on delete set null,
  position int,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists names_lower_name on public.names (lower(name));

create table if not exists public.cards (
  id uuid primary key default gen_random_uuid(),
  post_id uuid references public.posts (id) on delete cascade,
  theme_id uuid not null references public.themes (id) on delete cascade,
  kind text not null default 'post' check (kind in ('post', 'preview')),
  position int not null default 1,
  name_id uuid references public.names (id) on delete set null,
  name text not null, meaning text not null, shot text not null, prompt text not null,
  seed bigint not null,
  status text not null default 'queued' check (status in ('queued', 'generating', 'restamp', 'done', 'failed')),
  error text,
  photo_path text, card_path text,
  version int not null default 1,
  selected boolean not null default true,
  order_index int not null default 0,
  queued_at timestamptz not null default now(),
  claimed_at timestamptz, started_at timestamptz, finished_at timestamptz,
  attempts int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (kind = 'preview' or post_id is not null)
);
create index if not exists cards_queue on public.cards (status, queued_at) where status in ('queued', 'restamp');
create index if not exists cards_post on public.cards (post_id, position);
-- reels (005): a script the PC turns into a video: voice -> timing -> one image per scene -> render
create table if not exists public.reels (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  topic text,
  stage text,
  doll_cast jsonb not null default '{}'::jsonb,
  status text not null default 'script' check (status in (
    'script', 'queued', 'voicing', 'imaging', 'rendering', 'ready', 'needs_attention', 'failed')),
  error text,
  voice_path text,
  words jsonb,
  preview_path text,
  pc_path text,
  duration_s numeric,
  version int not null default 1,
  claimed_at timestamptz, started_at timestamptz, finished_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists reels_queue on public.reels (created_at) where status in ('queued', 'voicing', 'imaging', 'rendering');

create table if not exists public.reel_scenes (
  id uuid primary key default gen_random_uuid(),
  reel_id uuid not null references public.reels (id) on delete cascade,
  position int not null check (position >= 1),
  beat text not null default '',
  idea text not null default '',
  narration text not null,
  image_prompt text not null,
  seed bigint not null,
  status text not null default 'pending' check (status in ('pending', 'queued', 'generating', 'done', 'failed', 'skipped')),
  photo_path text,
  attempts int not null default 0,
  error text,
  start_s numeric, end_s numeric,
  version int not null default 1,
  claimed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (reel_id, position)
);
alter table public.themes drop constraint if exists themes_preview_fk;
alter table public.themes add constraint themes_preview_fk foreign key (preview_card_id) references public.cards (id) on delete set null;

-- ---------------------------------------------------------------- updated_at
create or replace function public.touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;

do $$ declare t text; begin
  foreach t in array array['settings', 'worker_status', 'themes', 'posts', 'names', 'cards', 'reels', 'reel_scenes'] loop
    execute format('drop trigger if exists touch on public.%I', t);
    execute format('create trigger touch before update on public.%I for each row execute function public.touch_updated_at()', t);
  end loop;
end $$;

-- ---------------------------------------------------------------- post status follows its cards
create or replace function public.refresh_post(p_post uuid) returns void language plpgsql as $$
declare v_status text; v_open int;
begin
  if p_post is null then return; end if;
  select status into v_status from public.posts where id = p_post;
  if not found or v_status = 'posted' then return; end if;
  -- A text-only restamp of a card that already has an image does not block readiness:
  -- the post stays ready (no "Post ready" chime on every text edit) while the text updates.
  -- A post with no cards left (v_open = 0) has nothing to wait for, so it is ready, not stuck generating.
  select count(*) filter (where status <> 'done' and not (status = 'restamp' and card_path is not null))
    into v_open from public.cards where post_id = p_post;
  if v_open = 0 then
    update public.posts set status = 'ready' where id = p_post and status <> 'ready';
    update public.names set status = 'used' where post_id = p_post and status = 'reserved';
  else
    update public.posts set status = 'generating' where id = p_post and status <> 'generating';
  end if;
end $$;

create or replace function public.cards_after_change() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    perform public.refresh_post(old.post_id);
    return old;
  end if;
  perform public.refresh_post(new.post_id);
  if new.kind = 'preview' and new.status = 'done' then
    update public.themes set preview_card_id = new.id where id = new.theme_id and preview_card_id is distinct from new.id;
  end if;
  return new;
end $$;

drop trigger if exists cards_after_change on public.cards;
create trigger cards_after_change after insert or delete or update of status on public.cards
  for each row execute function public.cards_after_change();

-- ---------------------------------------------------------------- create_post
create or replace function public.create_post(p jsonb) returns jsonb language plpgsql as $$
declare
  v_existing uuid; v_post uuid; v_ids uuid[]; v_locked int; v_theme public.themes%rowtype;
  v_theme_id uuid := (p->>'theme_id')::uuid;
begin
  select id into v_existing from public.posts where request_id = (p->>'request_id')::uuid;
  if found then return jsonb_build_object('status', 'ok', 'post_id', v_existing); end if;

  select array_agg((c->>'name_id')::uuid) into v_ids from jsonb_array_elements(p->'cards') c;
  if v_ids is null or array_length(v_ids, 1) = 0 then
    return jsonb_build_object('status', 'error', 'reason', 'The plan has no cards.');
  end if;

  select * into v_theme from public.themes where id = v_theme_id for update;
  if not found or v_theme.status <> 'available' or v_theme.gender <> p->>'gender' then
    return jsonb_build_object('status', 'conflict', 'reason', 'theme');
  end if;

  select count(*) into v_locked from (
    select id from public.names
    where id = any (v_ids) and status = 'available' and gender = p->>'gender' and style = p->>'style'
    for update
  ) s;
  if v_locked <> array_length(v_ids, 1) then
    return jsonb_build_object('status', 'conflict', 'reason', 'names');
  end if;

  insert into public.posts (request_id, post_date, gender, style, theme_id, caption, title_font, meaning_font, mark_font, subject_age)
  values ((p->>'request_id')::uuid, (p->>'post_date')::date, p->>'gender', p->>'style', v_theme_id, coalesce(p->>'caption', ''),
          nullif(btrim(p->>'title_font'), ''), nullif(btrim(p->>'meaning_font'), ''), nullif(btrim(p->>'mark_font'), ''),
          nullif(btrim(p->>'subject_age'), ''))
  returning id into v_post;

  insert into public.cards (post_id, theme_id, kind, position, name_id, name, meaning, shot, prompt, seed, order_index)
  select v_post, v_theme_id, 'post', (c->>'position')::int, (c->>'name_id')::uuid, c->>'name', c->>'meaning',
         c->>'shot', c->>'prompt', (c->>'seed')::bigint, (c->>'position')::int
  from jsonb_array_elements(p->'cards') c;

  update public.names n set status = 'reserved', post_id = v_post, position = (c->>'position')::int
  from jsonb_array_elements(p->'cards') c where n.id = (c->>'name_id')::uuid;

  update public.themes set status = 'used', used_on = (p->>'post_date')::date where id = v_theme_id;

  return jsonb_build_object('status', 'ok', 'post_id', v_post);
exception when unique_violation then
  select id into v_existing from public.posts where request_id = (p->>'request_id')::uuid;
  return jsonb_build_object('status', 'ok', 'post_id', v_existing);
end $$;

-- ---------------------------------------------------------------- add_card
create or replace function public.add_card(p_post uuid, c jsonb) returns jsonb language plpgsql as $$
declare v_post public.posts%rowtype; v_card uuid; v_pos int;
begin
  select * into v_post from public.posts where id = p_post for update;
  if not found then return jsonb_build_object('status', 'error', 'reason', 'Post not found.'); end if;
  perform 1 from public.names
    where id = (c->>'name_id')::uuid and status = 'available' and gender = v_post.gender and style = v_post.style for update;
  if not found then return jsonb_build_object('status', 'conflict'); end if;
  select coalesce(max(position), 0) + 1 into v_pos from public.cards where post_id = p_post;
  insert into public.cards (post_id, theme_id, kind, position, name_id, name, meaning, shot, prompt, seed, order_index)
  values (p_post, v_post.theme_id, 'post', v_pos, (c->>'name_id')::uuid, c->>'name', c->>'meaning', c->>'shot', c->>'prompt',
          (c->>'seed')::bigint, v_pos)
  returning id into v_card;
  update public.names set status = 'reserved', post_id = p_post, position = v_pos where id = (c->>'name_id')::uuid;
  if v_post.status = 'posted' then update public.posts set status = 'generating' where id = p_post; end if;
  return jsonb_build_object('status', 'ok', 'card_id', v_card);
end $$;

-- ---------------------------------------------------------------- deletes (return storage paths for the caller to remove)
create or replace function public.delete_card(p_card uuid) returns jsonb language plpgsql as $$
declare v_paths jsonb; v_name uuid;
begin
  select coalesce(jsonb_agg(x) filter (where x is not null), '[]'::jsonb), max(name_id::text)::uuid
    into v_paths, v_name
  from public.cards, lateral unnest(array[photo_path, card_path]) x where id = p_card;
  update public.names set status = 'available', post_id = null, position = null where id = v_name and status in ('reserved', 'used');
  delete from public.cards where id = p_card;
  return jsonb_build_object('status', 'ok', 'paths', coalesce(v_paths, '[]'::jsonb));
end $$;

create or replace function public.delete_post(p_post uuid) returns jsonb language plpgsql as $$
declare v_paths jsonb; v_theme uuid;
begin
  select theme_id into v_theme from public.posts where id = p_post;
  if not found then return jsonb_build_object('status', 'ok', 'paths', '[]'::jsonb); end if;
  select coalesce(jsonb_agg(x) filter (where x is not null), '[]'::jsonb) into v_paths
  from public.cards, lateral unnest(array[photo_path, card_path]) x where post_id = p_post;
  update public.names set status = 'available', post_id = null, position = null where post_id = p_post;
  delete from public.posts where id = p_post;
  update public.themes set status = 'available', used_on = null
    where id = v_theme and not exists (select 1 from public.posts where theme_id = v_theme);
  return jsonb_build_object('status', 'ok', 'paths', v_paths);
end $$;

-- ---------------------------------------------------------------- worker: claim + stuck recovery
drop function if exists public.claim_next_card();
create or replace function public.claim_next_card(p_restamp_only boolean default false) returns jsonb language plpgsql as $$
declare v_card public.cards%rowtype; v_job text; v_post public.posts%rowtype;
begin
  select * into v_card from public.cards
  where claimed_at is null and status in ('restamp', 'queued')
    and (not p_restamp_only or status = 'restamp')
  order by (status = 'restamp') desc, queued_at
  limit 1 for update skip locked;
  if not found then return null; end if;

  v_job := case when v_card.status = 'restamp' then 'restamp' else 'generate' end;
  update public.cards set
    claimed_at = now(), started_at = now(), error = null,
    status = case when v_job = 'generate' then 'generating' else 'restamp' end,
    attempts = attempts + case when v_job = 'generate' then 1 else 0 end
  where id = v_card.id
  returning * into v_card;

  select * into v_post from public.posts where id = v_card.post_id;
  return jsonb_build_object(
    'job', v_job, 'card', to_jsonb(v_card), 'post_date', v_post.post_date,
    'gender_label', case v_post.gender when 'boy' then 'Boy' when 'girl' then 'Girl' else null end,
    'style_label', case v_post.style when 'two-word' then 'Two-word' when 'single' then 'Single' else null end,
    'fonts', case when v_post.title_font is null and v_post.meaning_font is null and v_post.mark_font is null then null
      else jsonb_build_object('title_font', v_post.title_font, 'meaning_font', v_post.meaning_font, 'mark_font', v_post.mark_font) end);
end $$;

create or replace function public.requeue_stuck_cards() returns int language plpgsql as $$
declare v_n int;
begin
  with stuck as (
    select id, status, attempts from public.cards
    where claimed_at < now() - interval '5 minutes' and status in ('generating', 'restamp')
    for update skip locked
  )
  update public.cards c set
    claimed_at = null, started_at = null,
    status = case when s.status = 'generating' and s.attempts >= 3 then 'failed' when s.status = 'generating' then 'queued' else 'restamp' end,
    error = case when s.status = 'generating' and s.attempts >= 3 then 'Gave up after 3 tries: the PC stopped responding in the middle of this card.' else null end,
    queued_at = now()
  from stuck s where c.id = s.id;
  get diagnostics v_n = row_count;
  return v_n;
end $$;

-- ---------------------------------------------------------------- worker: reel claim + stuck recovery
-- The next unit of reel work: {step: voice|timing|image|render, reel, scene (image only, else null)}, or null.
-- Nothing while a card is waiting or being made (a card claim younger than requeue_stuck_cards' 5 minutes).
-- Oldest reel first; a reel whose next step can't run (a scene failed 3 times, scenes still pending,
-- every image skipped) is passed over. Render only runs when at least one scene is done.
-- WORKER CONTRACT:
--   * after each step, save its result version-guarded AND clear reels.claimed_at (and the scene's claimed_at);
--     until then the reel is not claimable again.
--   * during long sub-steps (Chatterbox chunks, ffmpeg passes) re-touch reels.claimed_at = now() as a heartbeat:
--     requeue_stuck_reels() releases any claim older than 10 minutes.
--   * on an image's 3rd failure set the reel needs_attention; after render set it ready.
create or replace function public.claim_next_reel_step() returns jsonb language plpgsql as $$
declare v_reel public.reels%rowtype; v_scene jsonb; v_step text; v_open int; v_done int; v_id uuid;
begin
  perform 1 from public.cards
    where status in ('queued', 'generating', 'restamp')
      and (claimed_at is null or claimed_at >= now() - interval '5 minutes')
    limit 1;
  if found then return null; end if;

  for v_reel in
    select * from public.reels
    where claimed_at is null and status in ('queued', 'voicing', 'imaging', 'rendering')
    order by created_at, id
    for update skip locked
  loop
    v_step := null; v_scene := null; v_id := null;
    if v_reel.voice_path is null then
      v_step := 'voice';
    elsif v_reel.words is null then
      v_step := 'timing';
    else
      select id into v_id from public.reel_scenes
        where reel_id = v_reel.id and (status = 'queued' or (status = 'failed' and attempts < 3))
        order by position limit 1
        for update skip locked;
      if v_id is not null then
        v_step := 'image';
      else
        select count(*) filter (where status not in ('done', 'skipped')), count(*) filter (where status = 'done')
          into v_open, v_done from public.reel_scenes where reel_id = v_reel.id;
        if v_open = 0 and v_done > 0 and v_reel.preview_path is null then v_step := 'render'; end if;
      end if;
    end if;
    continue when v_step is null;

    update public.reels set
      claimed_at = now(), started_at = coalesce(started_at, now()), error = null,
      status = case v_step when 'image' then 'imaging' when 'render' then 'rendering' else 'voicing' end
    where id = v_reel.id
    returning * into v_reel;
    if v_step = 'image' then
      update public.reel_scenes set status = 'generating', attempts = attempts + 1, claimed_at = now(), error = null
      where id = v_id
      returning to_jsonb(reel_scenes.*) into v_scene;
    end if;
    return jsonb_build_object('step', v_step, 'reel', to_jsonb(v_reel), 'scene', v_scene);
  end loop;
  return null;
end $$;

-- Releases reel and scene claims older than 10 minutes (the PC was switched off mid-step); the worker then
-- resumes at the first unfinished step. A scene stuck on its 3rd try fails and its reel needs attention.
-- Also settles unclaimed reels that can't progress (needs_attention / failed). Returns the rows changed.
create or replace function public.requeue_stuck_reels() returns int language plpgsql as $$
declare v_scenes int; v_reels int; v_flagged int; v_empty int;
  v_gave_up constant text := 'Gave up after 3 tries: the PC stopped responding in the middle of this image.';
begin
  with stuck as (
    select id, attempts from public.reel_scenes
    where claimed_at < now() - interval '10 minutes' and status = 'generating'
    for update skip locked
  )
  update public.reel_scenes s set
    claimed_at = null,
    status = case when k.attempts >= 3 then 'failed' else 'queued' end,
    error = case when k.attempts >= 3 then v_gave_up else null end
  from stuck k where s.id = k.id;
  get diagnostics v_scenes = row_count;

  with stuck as (
    select id from public.reels
    where claimed_at < now() - interval '10 minutes'
    for update skip locked
  ), gave_up as (
    select k.id from stuck k
    where exists (select 1 from public.reel_scenes s where s.reel_id = k.id and s.status = 'failed' and s.attempts >= 3)
  )
  update public.reels r set
    claimed_at = null,
    status = case when r.id in (select id from gave_up) and r.status in ('queued', 'voicing', 'imaging', 'rendering')
      then 'needs_attention' else r.status end,
    error = case when r.id in (select id from gave_up) and r.status in ('queued', 'voicing', 'imaging', 'rendering')
      then v_gave_up else r.error end
  from stuck k where r.id = k.id;
  get diagnostics v_reels = row_count;

  -- Unclaimed working reels that can never move on: an image failed 3 times (the worker didn't flag it) ...
  update public.reels r set status = 'needs_attention', error = 'An image failed 3 times.'
  where r.claimed_at is null and r.status in ('queued', 'voicing', 'imaging', 'rendering')
    and exists (select 1 from public.reel_scenes s where s.reel_id = r.id and s.status = 'failed' and s.attempts >= 3);
  get diagnostics v_flagged = row_count;
  -- ... or, once timed, nothing is left to show (every image skipped, or no scenes at all).
  update public.reels r set status = 'failed', error = 'Every image was skipped.'
  where r.claimed_at is null and r.status in ('queued', 'voicing', 'imaging', 'rendering')
    and r.words is not null and r.preview_path is null
    and not exists (select 1 from public.reel_scenes s where s.reel_id = r.id and s.status <> 'skipped');
  get diagnostics v_empty = row_count;
  return v_scenes + v_reels + v_flagged + v_empty;
end $$;

-- @supabase-only begin
-- ---------------------------------------------------------------- security
alter table public.settings enable row level security;
alter table public.worker_status enable row level security;
alter table public.themes enable row level security;
alter table public.posts enable row level security;
alter table public.names enable row level security;
alter table public.cards enable row level security;
alter table public.reels enable row level security;
alter table public.reel_scenes enable row level security;

do $$ declare t text; begin
  foreach t in array array['settings', 'themes', 'posts', 'names', 'cards', 'reels', 'reel_scenes'] loop
    execute format('drop policy if exists owner_all on public.%I', t);
    execute format('create policy owner_all on public.%I for all to authenticated using (true) with check (true)', t);
  end loop;
end $$;
drop policy if exists owner_read on public.worker_status;
create policy owner_read on public.worker_status for select to authenticated using (true);

-- Explicit grants (idempotent): the app runs as authenticated, the worker as service_role.
-- RLS above still limits what each role can see; anon gets no table access.
grant usage on schema public to authenticated, service_role;
grant select, insert, update, delete on all tables in schema public to authenticated, service_role;
revoke all on all tables in schema public from anon;

revoke execute on function public.claim_next_card(boolean) from public, anon, authenticated;
revoke execute on function public.requeue_stuck_cards() from public, anon, authenticated;
grant execute on function public.claim_next_card(boolean) to service_role;
grant execute on function public.requeue_stuck_cards() to service_role;
revoke execute on function public.claim_next_reel_step() from public, anon, authenticated;
revoke execute on function public.requeue_stuck_reels() from public, anon, authenticated;
grant execute on function public.claim_next_reel_step() to service_role;
grant execute on function public.requeue_stuck_reels() to service_role;
revoke execute on function public.create_post(jsonb) from public, anon;
revoke execute on function public.add_card(uuid, jsonb) from public, anon;
revoke execute on function public.delete_card(uuid) from public, anon;
revoke execute on function public.delete_post(uuid) from public, anon;
revoke execute on function public.refresh_post(uuid) from public, anon;
grant execute on function public.create_post(jsonb), public.add_card(uuid, jsonb), public.delete_card(uuid),
  public.delete_post(uuid), public.refresh_post(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------- storage
insert into storage.buckets (id, name, public) values ('cards', 'cards', false) on conflict (id) do nothing;
drop policy if exists cards_read on storage.objects;
create policy cards_read on storage.objects for select to authenticated using (bucket_id = 'cards');
drop policy if exists cards_delete on storage.objects;
create policy cards_delete on storage.objects for delete to authenticated using (bucket_id = 'cards');
-- reels (005): preview MP4s, voice WAVs, scene images
insert into storage.buckets (id, name, public) values ('reels', 'reels', false) on conflict (id) do nothing;
drop policy if exists reels_read on storage.objects;
create policy reels_read on storage.objects for select to authenticated using (bucket_id = 'reels');
drop policy if exists reels_delete on storage.objects;
create policy reels_delete on storage.objects for delete to authenticated using (bucket_id = 'reels');

-- ---------------------------------------------------------------- realtime
alter table public.cards replica identity full;
alter table public.posts replica identity full;
alter table public.reels replica identity full;
alter table public.reel_scenes replica identity full;
do $$ declare t text; begin
  foreach t in array array['cards', 'posts', 'worker_status', 'themes', 'names', 'reels', 'reel_scenes'] loop
    begin execute format('alter publication supabase_realtime add table public.%I', t);
    exception when duplicate_object then null; end;
  end loop;
end $$;
-- @supabase-only end
