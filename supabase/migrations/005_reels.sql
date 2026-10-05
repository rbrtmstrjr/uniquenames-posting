-- Unique Names posting: Reels (Knitted Doll reels made on the PC). Paste the whole file into the Supabase SQL editor and run it.
-- Safe to run more than once. Needs 004_subject_age.sql first. A fresh project gets all of this from supabase/schema.sql already.
-- A reel = a script (title, the two-doll cast, one scene per narration line) that the PC turns into a video:
-- voice -> timing (word times) -> one image per scene -> render. Cards always go first: the PC's GPU makes one thing at a time.

-- ---------------------------------------------------------------- settings
alter table public.settings add column if not exists reel_max_images int not null default 40;
alter table public.settings drop constraint if exists settings_reel_max_images_check;
alter table public.settings add constraint settings_reel_max_images_check check (reel_max_images between 10 and 40);
-- a 5-10 s reference clip in the reels bucket; null = Chatterbox's built-in voice
alter table public.settings add column if not exists reel_voice_path text;

-- ---------------------------------------------------------------- tables
create table if not exists public.reels (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  topic text,
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

do $$ declare t text; begin
  foreach t in array array['reels', 'reel_scenes'] loop
    execute format('drop trigger if exists touch on public.%I', t);
    execute format('create trigger touch before update on public.%I for each row execute function public.touch_updated_at()', t);
  end loop;
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
alter table public.reels enable row level security;
alter table public.reel_scenes enable row level security;
do $$ declare t text; begin
  foreach t in array array['reels', 'reel_scenes'] loop
    execute format('drop policy if exists owner_all on public.%I', t);
    execute format('create policy owner_all on public.%I for all to authenticated using (true) with check (true)', t);
  end loop;
end $$;
grant select, insert, update, delete on public.reels, public.reel_scenes to authenticated, service_role;
revoke all on public.reels, public.reel_scenes from anon;

revoke execute on function public.claim_next_reel_step() from public, anon, authenticated;
revoke execute on function public.requeue_stuck_reels() from public, anon, authenticated;
grant execute on function public.claim_next_reel_step() to service_role;
grant execute on function public.requeue_stuck_reels() to service_role;

-- ---------------------------------------------------------------- storage (preview MP4s, voice WAVs, scene images)
insert into storage.buckets (id, name, public) values ('reels', 'reels', false) on conflict (id) do nothing;
drop policy if exists reels_read on storage.objects;
create policy reels_read on storage.objects for select to authenticated using (bucket_id = 'reels');
drop policy if exists reels_delete on storage.objects;
create policy reels_delete on storage.objects for delete to authenticated using (bucket_id = 'reels');

-- ---------------------------------------------------------------- realtime
alter table public.reels replica identity full;
alter table public.reel_scenes replica identity full;
do $$ declare t text; begin
  foreach t in array array['reels', 'reel_scenes'] loop
    begin execute format('alter publication supabase_realtime add table public.%I', t);
    exception when duplicate_object then null; end;
  end loop;
end $$;
-- @supabase-only end
