-- Unique Names posting: a closing "follow" card at the end of every post. Paste the whole file into the Supabase SQL
-- editor and run it. Safe to run more than once. Needs 009_captions.sql first. A fresh project gets all of this from
-- supabase/schema.sql already. No function changes: claim_next_card already hands out every kind of card, and a post
-- stays 'generating' until its closing card is done like any other card. Restart the worker afterwards (2.3.0 stamps
-- the message; an older worker would stamp it like a name with an empty meaning). Until this runs the app makes no
-- closing cards.

-- cards: kind 'cta' = the closing card (name = the message, "/" = a line break; meaning = ''). It always belongs to a
-- post (the existing check: kind = 'preview' or post_id is not null).
alter table public.cards drop constraint if exists cards_kind_check;
alter table public.cards add constraint cards_kind_check check (kind in ('post', 'preview', 'cta'));
-- At most one closing card per post (a retried Generate or a double tap never adds a second one).
create unique index if not exists cards_one_cta on public.cards (post_id) where kind = 'cta';

-- settings: closing card on/off and its messages, one per line ({gender} = boy / girl). The app rotates them: the
-- least recently used, never the previous post's. Keep the default in sync with CTA_MESSAGES_DEFAULT (lib/cta/messages.ts).
alter table public.settings add column if not exists cta_enabled boolean not null default true;
alter table public.settings add column if not exists cta_messages text not null default
  E'Follow for more / baby name ideas.\nFollow us for a new / name list every day.\nStill searching? Follow for / more unique names.\nSave this post and follow / for more name ideas.\nMore {gender} names tomorrow. / Follow so you don''t miss them.\nFound a favorite? / Follow for more like it.\nFollow for a fresh list / of unique {gender} names.\nNew names every day. / Follow along!';
