-- Unique Names posting: two reel styles from the owner's prompt guides (docs/reference/crayon-parenting-prompt.md and
-- red-thread-parenting-prompt.md). Paste the whole file into the Supabase SQL editor and run it. Safe to run more than
-- once. Needs 007_reel_themes.sql and 008_reel_playbook.sql first. A fresh project gets all of this from
-- supabase/schema.sql already.
-- * Two new themes, Crayon (the new default) and Red Thread; the 8 themes of 007 stay (inactive) so old reels can still
--   re-render and redo their images, but the pickers only offer the active ones.
-- * Red Thread: the worker keeps only strong reds (the thread) and turns everything else grey (keep_red).
-- * Each new theme carries its whole preview prompt (the guide's example scene), which the worker uses verbatim.
-- * Per line: the guide's "The feeling is …" phrase and Red Thread's thread state (both null on older lines).
-- Every new column is nullable or has a default, so the app and the worker from before 012 keep working; then restart
-- the worker (Red Thread colours + the guide previews) and press Settings > Theme > Make previews.

-- ---------------------------------------------------------------- themes
alter table public.reel_themes add column if not exists active boolean not null default true;
alter table public.reel_themes add column if not exists keep_red boolean not null default false;
alter table public.reel_themes add column if not exists preview_prompt text;

-- Re-running refreshes the wording (label, emoji, blurb, style, flags, sort, preview prompt) but never a preview (preview_*).
insert into public.reel_themes as t (id, label, emoji, blurb, faces, grayscale, keep_red, active, sort, style, preview_prompt) values
  ('crayon', 'Crayon', '🖍️', 'A rough wax crayon drawing on white paper: bold colours, big feelings, paper grain showing through.', true, false, false, true, 9,
   'A rough wax crayon drawing on white paper, drawn by hand with heavy pressure. Thick waxy crayon strokes going in visible directions, streaky uneven coloring, white paper grain showing through the gaps between strokes, coloring slightly outside the lines, scribbly cross-hatching for shading, and bold wobbly dark crayon outlines around every shape. Looks like a real crayon artwork scanned from paper, not a painting.',
   E'A rough wax crayon drawing on white paper, drawn by hand with heavy pressure. Thick waxy crayon strokes going in visible directions, streaky uneven coloring, white paper grain showing through the gaps between strokes, coloring slightly outside the lines, scribbly cross-hatching for shading, and bold wobbly dark crayon outlines around every shape. Looks like a real crayon artwork scanned from paper, not a painting.\n\nThe scene has depth, with detailed objects in the close foreground, the characters in the middle ground, and a smaller, paler background in the distance.\n\nA young mother with long flowing hair holds a swaddled baby close to her chest, head tilted down, gazing at the baby with a wide joyful smile, eyes crinkled shut from happiness, and bright rosy scribbled cheeks. The baby laughs up at her with a big open-mouth smile and sparkling eyes, one tiny hand reaching toward her face. Tall grass and wildflowers in the foreground, small pale mountains under a sunset sky behind. The feeling is pure love and warmth.\n\nWarm soft light from one side, with a glowing crayon outline along the characters'' hair and shoulders, and darker crayon hatching on the shadow side. Bold saturated colors, expressive emotional storybook crayon style. Not a painting, not smooth, no blending, no gradients, not photorealistic, no crayons or art supplies visible in the image, no text.'),
  ('redthread', 'Red Thread', '🧵', 'Black-and-white storybook line art with one red thread tying parent and child in every picture.', true, false, true, true, 10,
   'A clean black and white ink line illustration in a simple modern storybook style. Smooth confident outlines of even thickness, simple rounded shapes, minimal details, and soft flat grey tones. Light warm grey background with subtle paper texture. The entire image is monochrome grayscale except for one single thin bright red thread, the only color in the image.',
   E'The red thread is the only color in the image. A clean black and white ink line illustration in a simple modern storybook style. Smooth confident outlines of even thickness, simple rounded shapes, minimal details, and soft flat grey tones. Light warm grey background with subtle paper texture. The entire image is monochrome grayscale except for one single thin bright red thread, the only color in the image.\n\nThe scene has depth: the main characters in the foreground with the boldest black outlines, simple furniture in the middle ground with thinner grey lines, and the background faded into pale grey.\n\nA clearly visible thin bright red thread, thick enough to be clearly visible on a phone screen, is tied in a small bow around the mother''s wrist and tied around the baby''s tiny wrist, one continuous thread connecting both wrists, with a short end trailing onto the blanket.\nA young mother sits on a bed holding her newborn baby in her arms, looking down with a soft loving smile and closed curved eyes. The baby sleeps peacefully with a tiny smile.\nThe feeling is a love that just began.\n\nGrayscale everything except the red thread. Not photorealistic, not 3D, no pencil sketch texture, no other colors, no text. The red thread is the only color in the image.')
on conflict (id) do update set
  label = excluded.label, emoji = excluded.emoji, blurb = excluded.blurb, faces = excluded.faces, grayscale = excluded.grayscale,
  keep_red = excluded.keep_red, active = excluded.active, sort = excluded.sort, style = excluded.style, preview_prompt = excluded.preview_prompt
where (t.label, t.emoji, t.blurb, t.faces, t.grayscale, t.keep_red, t.active, t.sort, t.style, t.preview_prompt)
  is distinct from (excluded.label, excluded.emoji, excluded.blurb, excluded.faces, excluded.grayscale, excluded.keep_red, excluded.active,
                    excluded.sort, excluded.style, excluded.preview_prompt);

-- the 8 themes of 007: kept for old reels, no longer offered (a preview still waiting for one is dropped from the line)
update public.reel_themes set active = false
where id in ('knitted', 'animated3d', 'watercolor', 'clay', 'papercraft', 'anime', 'sketch', 'cinematic') and active;
update public.reel_themes set preview_status = case when preview_path is null then 'missing' else 'ready' end
where not active and preview_status = 'queued';

-- ---------------------------------------------------------------- settings: Crayon is the default
alter table public.settings alter column reel_theme_id set default 'crayon';
update public.settings set reel_theme_id = 'crayon'
where reel_theme_id in (select id from public.reel_themes where not active);

-- ---------------------------------------------------------------- per line
alter table public.reel_scenes add column if not exists feeling text;
alter table public.reel_scenes add column if not exists thread text;
alter table public.reel_scenes drop constraint if exists reel_scenes_thread_check;
alter table public.reel_scenes add constraint reel_scenes_thread_check
  check (thread in ('plain', 'tight', 'stretched', 'tangled', 'loose'));
