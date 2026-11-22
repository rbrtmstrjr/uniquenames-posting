-- Unique Names posting: the front card (spec docs/superpowers/specs/2026-11-21-front-card-design.md). Every new post
-- opens with a picture from its own photoshoot with the post's title stamped big ("'S' Names" / "for baby boy"). Paste
-- the whole file into the Supabase SQL editor and run it. Safe to run more than once. Run it after 022_autopilot.sql. A
-- fresh project gets all of this from supabase/schema.sql already. No function changes: claim_next_card already hands
-- out every kind of card with all its columns. Restart the PC worker first, once its queue is empty (worker 2.10.0
-- stamps the title; an older worker would stamp it like a name). Until this runs the app makes no front cards.

-- cards: kind 'cover' = the front card, the post's first picture (name = the title's main line, meaning = its second
-- line or ''). It always belongs to a post (the existing check: kind = 'preview' or post_id is not null).
alter table public.cards drop constraint if exists cards_kind_check;
alter table public.cards add constraint cards_kind_check check (kind in ('post', 'preview', 'cta', 'cover'));
-- At most one front card per post (a retried Generate or a double tap never adds a second one).
create unique index if not exists cards_one_cover on public.cards (post_id) where kind = 'cover';
-- Where the front card's title is stamped (null on every other card); stored so a re-stamp keeps it.
alter table public.cards add column if not exists title_pos text;
alter table public.cards drop constraint if exists cards_title_pos_check;
alter table public.cards add constraint cards_title_pos_check check (title_pos is null or title_pos in ('top', 'bottom'));

-- settings: Settings > Front card, on by default.
alter table public.settings add column if not exists cover_enabled boolean not null default true;
