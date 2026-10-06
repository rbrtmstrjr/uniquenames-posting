-- Unique Names posting: Reels narrator voices, speed and background music. Paste the whole file into the Supabase SQL
-- editor and run it. Safe to run more than once. Needs 005_reels.sql first. A fresh project gets all of this from
-- supabase/schema.sql already. Restart the PC worker right after running it (the old worker doesn't know the music step).
-- Voices: 30 Gemini voices cloned by Chatterbox from a reference clip (voices/<id>/ref.wav in the reels bucket)
-- + Chatterbox's built-in voice. Music: one ACE-Step bed per reel (<reelId>/music-v<n>.flac), mixed under the voice.

-- ---------------------------------------------------------------- voices
create table if not exists public.reel_voices (
  id text primary key,               -- the Gemini voice name in lower case, or 'builtin'
  label text not null,
  tone text not null default '',     -- Gemini's descriptor ("Warm", "Firm", ...)
  gender text check (gender in ('female', 'male')),
  ref_path text,                     -- voices/<id>/ref.wav (null for builtin, or until Set up voices made it)
  sample_path text,                  -- voices/<id>/sample-v<version>.wav
  sample_status text not null default 'missing' check (sample_status in ('missing', 'queued', 'making', 'ready', 'failed')),
  sample_key text,                   -- the calm/speed settings the sample was made with (stale when they change)
  error text,
  version int not null default 1,
  claimed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
insert into public.reel_voices (id, label, tone) values
  ('zephyr', 'Zephyr', 'Bright'), ('puck', 'Puck', 'Upbeat'), ('charon', 'Charon', 'Informative'),
  ('kore', 'Kore', 'Firm'), ('fenrir', 'Fenrir', 'Excitable'), ('leda', 'Leda', 'Youthful'),
  ('orus', 'Orus', 'Firm'), ('aoede', 'Aoede', 'Breezy'), ('callirrhoe', 'Callirrhoe', 'Easy-going'),
  ('autonoe', 'Autonoe', 'Bright'), ('enceladus', 'Enceladus', 'Breathy'), ('iapetus', 'Iapetus', 'Clear'),
  ('umbriel', 'Umbriel', 'Easy-going'), ('algieba', 'Algieba', 'Smooth'), ('despina', 'Despina', 'Smooth'),
  ('erinome', 'Erinome', 'Clear'), ('algenib', 'Algenib', 'Gravelly'), ('rasalgethi', 'Rasalgethi', 'Informative'),
  ('laomedeia', 'Laomedeia', 'Upbeat'), ('achernar', 'Achernar', 'Soft'), ('alnilam', 'Alnilam', 'Firm'),
  ('schedar', 'Schedar', 'Even'), ('gacrux', 'Gacrux', 'Mature'), ('pulcherrima', 'Pulcherrima', 'Forward'),
  ('achird', 'Achird', 'Friendly'), ('zubenelgenubi', 'Zubenelgenubi', 'Casual'), ('vindemiatrix', 'Vindemiatrix', 'Gentle'),
  ('sadachbia', 'Sadachbia', 'Lively'), ('sadaltager', 'Sadaltager', 'Knowledgeable'), ('sulafat', 'Sulafat', 'Warm'),
  ('builtin', 'Built-in', 'Default')
on conflict (id) do nothing;

drop trigger if exists touch on public.reel_voices;
create trigger touch before update on public.reel_voices for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------- settings + reels
-- the default narrator (a real foreign key: a typo can't be saved); reels.voice_id null = this default
alter table public.settings add column if not exists reel_voice_id text not null default 'gacrux' references public.reel_voices (id);
alter table public.settings add column if not exists reel_speed numeric(3,2) not null default 1.12;
alter table public.settings drop constraint if exists settings_reel_speed_check;
alter table public.settings add constraint settings_reel_speed_check check (reel_speed between 1.00 and 1.25);
alter table public.settings add column if not exists reel_music boolean not null default true;
alter table public.settings add column if not exists reel_music_volume int not null default 18;
alter table public.settings drop constraint if exists settings_reel_music_volume_check;
alter table public.settings add constraint settings_reel_music_volume_check check (reel_music_volume between 5 and 40);
alter table public.reels add column if not exists voice_id text references public.reel_voices (id) on delete set null;
-- null = not made yet; '' = the music step failed (the reel goes on with the voice only); else the FLAC path
alter table public.reels add column if not exists music_path text;

-- ---------------------------------------------------------------- worker: reel claim + stuck recovery
-- The next step of one reel: {step, scene_id} or null when it can't move on right now. Shared by
-- claim_next_reel_step (which claims it) and claim_next_voice_sample (samples only run when no reel step can).
-- p_music: the worker can make music (an older worker passes nothing: no music step at all, never waits for one).
drop function if exists public.reel_next_step(public.reels, boolean);  -- the first 006 draft: keep one signature
create or replace function public.reel_next_step(p_reel public.reels, p_no_comfy boolean, p_music boolean) returns jsonb language plpgsql stable as $$
declare v_id uuid; v_open int; v_done int; v_music boolean;
begin
  if p_reel.voice_path is null then
    if not p_no_comfy then return jsonb_build_object('step', 'voice', 'scene_id', null); end if;
    return null;
  end if;
  if p_reel.words is null then return jsonb_build_object('step', 'timing', 'scene_id', null); end if;
  select coalesce(reel_music, true) into v_music from public.settings where id = 1;
  if p_music and coalesce(v_music, true) and p_reel.music_path is null and p_reel.preview_path is null then
    if not p_no_comfy then return jsonb_build_object('step', 'music', 'scene_id', null); end if;
    return null;  -- wait for ComfyUI: never render without the bed when music is on
  end if;
  if not p_no_comfy then
    select id into v_id from public.reel_scenes
      where reel_id = p_reel.id and (status = 'queued' or (status = 'failed' and attempts < 3))
      order by position limit 1;
    if v_id is not null then return jsonb_build_object('step', 'image', 'scene_id', v_id); end if;
  end if;
  select count(*) filter (where status not in ('done', 'skipped')), count(*) filter (where status = 'done')
    into v_open, v_done from public.reel_scenes where reel_id = p_reel.id;
  if v_open = 0 and v_done > 0 and p_reel.preview_path is null then return jsonb_build_object('step', 'render', 'scene_id', null); end if;
  return null;
end $$;

-- The next unit of reel work: {step: voice|timing|music|image|render, reel, scene (image only, else null)}, or null.
-- Nothing while a card is waiting or being made (a card claim younger than requeue_stuck_cards' 5 minutes).
-- Oldest reel first; a reel whose next step can't run (a scene failed 3 times, scenes still pending,
-- every image skipped) is passed over. Render only runs when at least one scene is done.
-- Music (006): after timing, before the images, while settings.reel_music is on and reels.music_path is null, and
-- only for a worker that passes p_music = true (the 006 worker does; an older worker never sees a music step).
-- It runs under the existing 'voicing' status (no new status: the app shows it as part of the audio).
-- WORKER CONTRACT:
--   * after each step, save its result version-guarded AND clear reels.claimed_at (and the scene's claimed_at);
--     until then the reel is not claimable again.
--   * during long sub-steps (Chatterbox chunks, ACE-Step, ffmpeg passes) re-touch reels.claimed_at = now() as a
--     heartbeat: requeue_stuck_reels() releases any claim older than 10 minutes.
--   * on an image's 3rd failure set the reel needs_attention; after render set it ready.
--   * music: on success music_path = '<reelId>/music-v<version>.flac'; on failure music_path = '' (not retried, the
--     reel is NOT failed) and the render uses the voice only. The render mixes music only when settings.reel_music
--     is on AND music_path is non-empty. Whoever clears voice_path (a new voice) clears music_path too.
-- p_no_comfy: ComfyUI is closed on the PC, so only the steps that don't need it (timing, render) are handed out;
-- a reel waiting for its music waits for ComfyUI.
drop function if exists public.claim_next_reel_step();  -- the first 005 draft had no argument: keep one signature
drop function if exists public.claim_next_reel_step(boolean);  -- 005's signature: 006 adds p_music
create or replace function public.claim_next_reel_step(p_no_comfy boolean default false, p_music boolean default false) returns jsonb language plpgsql as $$
declare v_reel public.reels%rowtype; v_next jsonb; v_scene jsonb; v_step text; v_id uuid;
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
    v_next := public.reel_next_step(v_reel, p_no_comfy, p_music);
    continue when v_next is null;
    v_step := v_next ->> 'step';
    v_id := (v_next ->> 'scene_id')::uuid;
    v_scene := null;

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

-- The next voice sample to make: {voice: reel_voices row} or null. Only when the GPU has nothing better to do:
-- no card waiting or being made, no reel step in progress (claim younger than 10 minutes) and no reel step
-- runnable (with ComfyUI). Oldest queued voice that has a reference clip (or the built-in voice) -> 'making'.
-- Call it only while ComfyUI is up (Chatterbox needs it).
-- WORKER CONTRACT: write voices/<id>/sample-v<version>.wav, then save sample_path, sample_key, sample_status 'ready',
-- claimed_at null WHERE id and version match the claimed row (the app bumps version when it re-queues a sample; a
-- mismatch means the work is stale: discard it). On failure: sample_status 'failed', error, claimed_at null.
-- requeue_stuck_reels() puts a 'making' sample claimed more than 10 minutes ago back in the queue.
create or replace function public.claim_next_voice_sample() returns jsonb language plpgsql as $$
declare v_voice public.reel_voices%rowtype; v_reel public.reels%rowtype;
begin
  perform 1 from public.cards
    where status in ('queued', 'generating', 'restamp')
      and (claimed_at is null or claimed_at >= now() - interval '5 minutes')
    limit 1;
  if found then return null; end if;

  perform 1 from public.reels
    where status in ('queued', 'voicing', 'imaging', 'rendering') and claimed_at >= now() - interval '10 minutes'
    limit 1;
  if found then return null; end if;
  for v_reel in
    select * from public.reels where claimed_at is null and status in ('queued', 'voicing', 'imaging', 'rendering')
  loop
    if public.reel_next_step(v_reel, false, true) is not null then return null; end if;
  end loop;

  select * into v_voice from public.reel_voices
    where sample_status = 'queued' and (ref_path is not null or id = 'builtin')
    order by updated_at, id
    limit 1
    for update skip locked;
  if not found then return null; end if;
  update public.reel_voices set sample_status = 'making', claimed_at = now(), error = null
  where id = v_voice.id
  returning * into v_voice;
  return jsonb_build_object('voice', to_jsonb(v_voice));
end $$;

-- Releases reel and scene claims older than 10 minutes (the PC was switched off mid-step); the worker then
-- resumes at the first unfinished step. A scene stuck on its 3rd try fails and its reel needs attention.
-- Also settles unclaimed reels that can't progress (needs_attention / failed) and puts voice samples stuck in
-- 'making' for 10 minutes back in the queue. Returns the rows changed.
create or replace function public.requeue_stuck_reels() returns int language plpgsql as $$
declare v_scenes int; v_reels int; v_flagged int; v_empty int; v_samples int;
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

  update public.reel_voices set sample_status = 'queued', claimed_at = null
  where sample_status = 'making' and claimed_at < now() - interval '10 minutes';
  get diagnostics v_samples = row_count;
  return v_scenes + v_reels + v_flagged + v_empty + v_samples;
end $$;

-- @supabase-only begin
-- ---------------------------------------------------------------- security
alter table public.reel_voices enable row level security;
drop policy if exists owner_all on public.reel_voices;
create policy owner_all on public.reel_voices for all to authenticated using (true) with check (true);
grant select, insert, update, delete on public.reel_voices to authenticated, service_role;
revoke all on public.reel_voices from anon;

revoke execute on function public.reel_next_step(public.reels, boolean, boolean) from public, anon, authenticated;
revoke execute on function public.claim_next_reel_step(boolean, boolean) from public, anon, authenticated;
revoke execute on function public.claim_next_voice_sample() from public, anon, authenticated;
revoke execute on function public.requeue_stuck_reels() from public, anon, authenticated;
grant execute on function public.reel_next_step(public.reels, boolean, boolean) to service_role;
grant execute on function public.claim_next_reel_step(boolean, boolean) to service_role;
grant execute on function public.claim_next_voice_sample() to service_role;
grant execute on function public.requeue_stuck_reels() to service_role;

-- ---------------------------------------------------------------- storage (reels bucket from 005)
-- The owner's Set up voices action uploads voices/<id>/ref.wav with the owner's session; everything else
-- (samples, music, voice tracks, images, previews) is uploaded by the PC worker with the service role.
drop policy if exists reels_voice_refs_insert on storage.objects;
create policy reels_voice_refs_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'reels' and name ~ '^voices/[a-z]+/ref\.wav$');

-- ---------------------------------------------------------------- realtime
alter table public.reel_voices replica identity full;
do $$ begin
  begin alter publication supabase_realtime add table public.reel_voices;
  exception when duplicate_object then null; end;
end $$;
-- @supabase-only end
