-- Unique Names posting: Reels visual themes (with a preview picture each) and per-line emotion + motion. Paste the
-- whole file into the Supabase SQL editor and run it. Safe to run more than once. Needs 006_reel_voices.sql first.
-- A fresh project gets all of this from supabase/schema.sql already. Any order with the worker restart is safe:
-- claim_next_reel_step is unchanged, and only a worker that knows about theme previews ever calls
-- claim_next_theme_preview (the 006 worker never does).
-- Themes: 8 fixed, positive-only style blocks (from the PC spike). Re-running this file refreshes their wording
-- (label, emoji, blurb, style, faces, grayscale, sort) but never touches a theme's preview (preview_*).
-- Motion: every line gets a camera move (no AI video this round).

-- ---------------------------------------------------------------- themes
create table if not exists public.reel_themes (
  id text primary key,               -- knitted | animated3d | watercolor | clay | papercraft | anime | sketch | cinematic
  label text not null,
  emoji text not null default '',
  blurb text not null default '',
  style text not null,               -- the positive-only style block put in front of every image prompt
  faces boolean not null default true,      -- expressive faces (false: feelings show through pose only)
  grayscale boolean not null default false, -- the worker turns the picture grey after Z-Image (sketch)
  sort int not null default 0,
  preview_path text,                 -- themes/<id>/preview-v<version>.jpg in the reels bucket
  preview_status text not null default 'missing' check (preview_status in ('missing', 'queued', 'making', 'ready', 'failed')),
  error text,
  version int not null default 1,
  claimed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
insert into public.reel_themes as t (id, label, emoji, blurb, faces, grayscale, sort, style) values
  ('knitted', 'Knitted Doll', '🧶', 'Soft crocheted wool dolls in a felt and yarn world; feelings show through pose.', false, false, 1,
   'Handmade amigurumi doll scene: every character is a soft crocheted wool doll, captured as premium handcrafted toy photography. A tight, clearly visible crochet stitch grid covers the whole face and body, with fine fuzzy wool fibres on every surface; a slightly oversized round head and soft chubby rounded limbs. Large glossy round black bead eyes with a small bright catchlight, a tiny stitched nose bump, a simple curved embroidered smile, thin embroidered eyebrows, and hair made of loose chunky yarn strands, each strand individually visible and softly fuzzy. The whole world is sewn and knitted by hand: every setting is built from felt and linen — felt walls or felt sky, felt ground and floors, felt furniture and shelves, knitted blankets, stitched felt props and yarn details, with small charming irregularities in the stitching. Soft diffused warm daylight from the front and a little to the side, gentle low contrast, soft contact shadows, gentle highlights on the wool fibres and the bead eyes. Palette: warm beige, cream, oatmeal and natural linen with mustard yellow, warm orange, rust and sage accents. Soft rounded edges everywhere, cozy and tender.'),
  ('animated3d', '3D Animated', '🎬', 'Family-movie 3D with big, expressive faces and warm window light.', true, false, 2,
   'Stylized 3D animated feature-film still: characters with appealing rounded proportions, slightly oversized heads and large expressive eyes with bright catchlights, soft smooth skin with a subtle warm glow, rich and clearly readable facial expressions with expressive brows and mouths, softly sculpted hair. Polished family-movie rendering with global illumination, soft volumetric window light, a warm rim light, gentle bounce light and soft ambient shadows. A cozy, richly detailed home set with rounded furniture and tactile fabrics. Palette: warm cream, honey gold, soft peach and terracotta with teal accents. Shallow depth of field, heartwarming and full of life.'),
  ('watercolor', 'Storybook Watercolor', '🎨', 'Hand-painted washes and fine ink lines, like a picture-book page.', true, false, 3,
   'Storybook watercolor illustration painted by hand on textured cold-press paper: soft transparent washes, gentle wet-in-wet blooms and pigment granulation, visible paper grain, delicate fine ink and pencil linework around the figures, soft painted edges. Characters drawn with simple, gentle rounded features, rosy cheeks and warm expressive faces. Warm light painted as luminous washes of pale yellow and peach. Palette: soft peach, warm ochre, rose, sage green and sky blue on warm ivory paper. Airy and tender, a classic children''s picture-book page.'),
  ('clay', 'Clay Stop-motion', '🏺', 'Sculpted matte clay figures on a tiny handmade set.', true, false, 4,
   'Handmade clay stop-motion animation still: every character and object is sculpted from smooth matte modelling clay with subtle fingerprints and tool marks, soft rounded chunky forms, slightly oversized heads, small glossy bead eyes and sculpted expressive mouths and brows. A miniature handcrafted set built from clay, painted card and fabric, with tiny clay props. Soft warm light from the window, gentle soft shadows, miniature tabletop scale with a shallow depth of field. Palette: warm cream, terracotta, mustard, soft teal and dusty pink. Charming, tactile and playful.'),
  ('papercraft', 'Paper Craft', '✂️', 'A layered cut-paper diorama with real depth and soft shadows.', false, false, 5,
   'Handmade layered paper-craft diorama, photographed up close as a real tabletop paper model: every character, object and wall is cut from thick coloured cardstock and textured craft paper, built in many stacked layers that stand apart with real depth and soft shadows between them, crisp hand-cut edges with tiny white paper cores showing, visible paper fibre texture, gentle folds and curls. Characters are cut-paper figures made of simple layered paper shapes, with cut-paper hair, small dot eyes and curved paper smiles, posed with clear expressive gestures. A cozy paper room with a layered paper window, paper curtains and paper sunbeams. Soft warm light from the side casting gentle depth shadows between the layers. Palette: warm cream, coral, mustard, teal and soft pink paper. Handmade, whimsical and tactile.'),
  ('anime', 'Soft Anime', '🌸', 'Gentle slice-of-life anime: clean lines, soft shading, sunlit rooms.', true, false, 6,
   'Soft anime illustration in a gentle slice-of-life film style: clean confident line art, smooth cel shading with soft gradient shadows, large expressive eyes with layered highlights, a delicate blush on the cheeks, softly flowing hair drawn in clean shapes. A painterly, detailed background of a cozy sunlit home, warm afternoon light streaming in with a soft bloom and glowing dust motes. Palette: warm cream, soft peach, butter yellow, sky blue and leafy green. Tender, heartfelt and luminous.'),
  ('sketch', 'Pencil Sketch (B&W)', '✏️', 'A black-and-white graphite drawing on sketchbook paper.', true, true, 7,
   'Black-and-white grayscale pencil drawing, a colourless graphite study made by hand on white sketchbook paper: the whole picture is pure greyscale, drawn entirely in shades of pencil grey, so every garment, skin tone, hair colour and object reads only as a lighter or darker graphite grey, from soft silver to deep charcoal black, on white paper. Confident graphite line work, expressive loose strokes, soft cross-hatching and smudged tonal shading, visible paper texture, the brightest highlights left as bare white paper, the drawing filling the whole page. Faces drawn with care and clear, readable expressions. Gentle light from the window rendered with soft shading. Intimate, artistic and timeless, a classic monochrome pencil study.'),
  ('cinematic', 'Cinematic Real', '📷', 'Real people, golden-hour light and a 35mm film look.', true, false, 8,
   'Cinematic real-life photograph, a still from a modern drama film: real people with natural skin texture, fine hair detail and genuine, readable emotion. 35mm film look with soft natural grain, shallow depth of field and creamy background bokeh. Warm golden-hour sunlight streaming through the window, a soft haze in the light, a gentle rim light on the hair, rich natural colour grading with warm highlights and soft teal shadows. A lived-in, cozy home with real textures. Intimate, emotional and true to life.')
on conflict (id) do update set
  label = excluded.label, emoji = excluded.emoji, blurb = excluded.blurb, faces = excluded.faces,
  grayscale = excluded.grayscale, sort = excluded.sort, style = excluded.style
where (t.label, t.emoji, t.blurb, t.faces, t.grayscale, t.sort, t.style)
  is distinct from (excluded.label, excluded.emoji, excluded.blurb, excluded.faces, excluded.grayscale, excluded.sort, excluded.style);

drop trigger if exists touch on public.reel_themes;
create trigger touch before update on public.reel_themes for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------- settings, reels, scenes
-- the default theme (a real foreign key: a typo can't be saved); reels.theme_id null = this default
alter table public.settings add column if not exists reel_theme_id text not null default 'knitted' references public.reel_themes (id);
alter table public.reels add column if not exists theme_id text references public.reel_themes (id) on delete set null;
-- per line (filled by the script engine): the feeling, the body language + hands, the framing, a key moment
-- (gets the 'punch' emphasis) and the camera move the render uses (null = the render picks one)
alter table public.reel_scenes add column if not exists emotion text;
alter table public.reel_scenes add column if not exists action text;
alter table public.reel_scenes add column if not exists shot text;
alter table public.reel_scenes add column if not exists key_moment boolean not null default false;
alter table public.reel_scenes add column if not exists motion text;
alter table public.reel_scenes drop constraint if exists reel_scenes_motion_check;
alter table public.reel_scenes add constraint reel_scenes_motion_check
  check (motion in ('push_in', 'pull_out', 'pan_left', 'pan_right', 'tilt_up', 'tilt_down', 'punch'));

-- ---------------------------------------------------------------- worker: theme previews + stuck recovery
-- claim_next_reel_step and reel_next_step are unchanged (006): the theme only changes the image prompts, which the
-- app writes before the reel is queued.
-- The next theme preview to make: {theme: reel_themes row} or null. Lowest priority of all GPU work: no card waiting
-- or being made, no reel step in progress (claim younger than 10 minutes) or runnable (with ComfyUI), and no voice
-- sample waiting (queued with a reference clip, or the built-in voice) or being made. Oldest queued theme -> 'making'.
-- Call it only while ComfyUI is up (Z-Image needs it).
-- WORKER CONTRACT: Z-Image with the theme's style + the fixed preview moment (grayscale themes are turned grey
-- after), write themes/<id>/preview-v<version>.jpg, then save preview_path, preview_status 'ready', claimed_at null
-- WHERE id and version match the claimed row (the app bumps version when it re-queues a preview; a mismatch means
-- the work is stale: discard it). On failure: preview_status 'failed', error, claimed_at null.
-- requeue_stuck_reels() puts a 'making' preview claimed more than 10 minutes ago back in the queue.
create or replace function public.claim_next_theme_preview() returns jsonb language plpgsql as $$
declare v_theme public.reel_themes%rowtype; v_reel public.reels%rowtype;
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

  perform 1 from public.reel_voices
    where (sample_status = 'queued' and (ref_path is not null or id = 'builtin'))
       or (sample_status = 'making' and claimed_at >= now() - interval '10 minutes')
    limit 1;
  if found then return null; end if;

  select * into v_theme from public.reel_themes
    where preview_status = 'queued'
    order by updated_at, sort, id
    limit 1
    for update skip locked;
  if not found then return null; end if;
  update public.reel_themes set preview_status = 'making', claimed_at = now(), error = null
  where id = v_theme.id
  returning * into v_theme;
  return jsonb_build_object('theme', to_jsonb(v_theme));
end $$;

-- Releases reel and scene claims older than 10 minutes (the PC was switched off mid-step); the worker then
-- resumes at the first unfinished step. A scene stuck on its 3rd try fails and its reel needs attention.
-- Also settles unclaimed reels that can't progress (needs_attention / failed) and puts voice samples stuck in
-- 'making' for 10 minutes back in the queue; 007: theme previews too. Returns the rows changed.
create or replace function public.requeue_stuck_reels() returns int language plpgsql as $$
declare v_scenes int; v_reels int; v_flagged int; v_empty int; v_samples int; v_previews int;
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

  update public.reel_themes set preview_status = 'queued', claimed_at = null
  where preview_status = 'making' and claimed_at < now() - interval '10 minutes';
  get diagnostics v_previews = row_count;
  return v_scenes + v_reels + v_flagged + v_empty + v_samples + v_previews;
end $$;

-- @supabase-only begin
-- ---------------------------------------------------------------- security
-- Storage needs nothing new: the PC worker uploads themes/<id>/preview-v<n>.jpg to the reels bucket with the service
-- role, and the owner already reads (and deletes) anything in that bucket (005).
alter table public.reel_themes enable row level security;
drop policy if exists owner_all on public.reel_themes;
create policy owner_all on public.reel_themes for all to authenticated using (true) with check (true);
grant select, insert, update, delete on public.reel_themes to authenticated, service_role;
revoke all on public.reel_themes from anon;

revoke execute on function public.claim_next_theme_preview() from public, anon, authenticated;
revoke execute on function public.requeue_stuck_reels() from public, anon, authenticated;
grant execute on function public.claim_next_theme_preview() to service_role;
grant execute on function public.requeue_stuck_reels() to service_role;

-- ---------------------------------------------------------------- realtime
alter table public.reel_themes replica identity full;
do $$ begin
  begin alter publication supabase_realtime add table public.reel_themes;
  exception when duplicate_object then null; end;
end $$;
-- @supabase-only end
