-- Unique Names posting: unique captions + rotating hashtags. Paste the whole file into the Supabase SQL editor and run
-- it. Safe to run more than once. Needs 008_reel_playbook.sql first. A fresh project gets all of this from
-- supabase/schema.sql already. Every new column is nullable or has a default, and no function changes, so the app and
-- the worker from before 009 keep working (the worker does not read these columns; no restart needed).

-- settings: the hashtags on every post (at most 2) and the pool one tag a post is rotated from. The old single
-- `hashtags` field stays for older app versions.
alter table public.settings add column if not exists hashtags_always text not null default '#uniquenames';

-- The pool is created (and filled) only once: the default pool + the owner's old hashtags without engagement bait
-- (#fyp..., #follow..., #highlights...), other platforms' tags (#...tiktok, #insta...), the always-tag and repeats
-- (the app's legacyPool() does the same before 009).
do $$
begin
  if not exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'settings' and column_name = 'hashtag_pool') then
    alter table public.settings add column hashtag_pool text not null default
      '#babynames #babygirlnames #babyboynames #uniquebabynames #namemeaning #momlife #newmom #pregnancy #momtobe #babynameideas';
    update public.settings s set hashtag_pool = btrim(s.hashtag_pool || ' ' || coalesce((
      select string_agg(x.tag, ' ' order by x.ord) from (
        select lower(u.t) as tag, min(u.ord) as ord
        from unnest(regexp_split_to_array(btrim(s.hashtags), '[\s,]+')) with ordinality as u(t, ord)
        where lower(u.t) ~ '^#[a-z0-9]{1,23}$'
          and lower(u.t) !~ '^#(fyp|foryou|follow|like4like|likeforlike|l4l|f4f|tagafriend|viral|highlight)'
          and lower(u.t) !~ '(tiktok|instagram|insta|youtube|reelsfb|fbreels|shorts$)'
          and lower(u.t) <> all (regexp_split_to_array(s.hashtag_pool || ' ' || s.hashtags_always, '\s+'))
        group by lower(u.t)
      ) x), ''));
  end if;
end $$;

-- posts: the caption style used (story, spotlight, question, choice, fact, compliment, or template) and the hashtag
-- set, so the next post can pick a different style and never repeat a set from the last 10 posts
alter table public.posts add column if not exists caption_style text;
alter table public.posts add column if not exists hashtag_set text;

-- reels: the post caption (1-3 sentences ending in one genuine question) and its hashtags, written after the script
alter table public.reels add column if not exists caption text;
alter table public.reels add column if not exists hashtags text;
