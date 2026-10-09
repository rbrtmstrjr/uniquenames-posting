-- Unique Names posting: posts by letter (a normal post where every name starts with one chosen letter, made on Today
-- under "By letter"). Paste the whole file into the Supabase SQL editor and run it. Safe to run more than once. Needs
-- 012_two_styles.sql first. A fresh project gets all of this from supabase/schema.sql already. One new nullable column
-- and no function changes (create_post is untouched; the app writes the letter right after it, and the worker never
-- reads it: no restart). Until this runs, a post by letter is still made, just without its "Letter A" label.

-- posts.letter: the capital letter every name of a post by letter starts with; null on any other post.
alter table public.posts add column if not exists letter text;
alter table public.posts drop constraint if exists posts_letter_check;
alter table public.posts add constraint posts_letter_check check (letter is null or letter ~ '^[A-Z]$');
