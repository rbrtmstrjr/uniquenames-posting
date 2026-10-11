-- Name Nest (docs/superpowers/specs/2026-10-10-niche-packs-name-nest-design.md): the columns a US baby-name page needs.
-- Paste the whole file into the Supabase SQL editor and run it. Safe to run more than once. Needs 014_reel_formats.sql
-- first. A fresh project gets all of this from supabase/schema.sql already.
-- * names.origin: the name's origin ("Greek", "Hebrew"), shown on Name Nest cards; null = not known.
-- * names.us_rank / names.us_year: the name's rank for its gender in the official US Social Security (SSA) baby-name
--   data and the year of that list (scripts/import-ssa.ts); null for names not in that list.
-- * settings.card_layout: how the PC stamps a card: 'classic' (today's Unique Names cards) or 'name-nest' (brand
--   colours and a small "#38 in the US · Greek" line under the meaning when the name has a rank or an origin).
-- Every new column is nullable or has a default, so the app and the worker from before 015 keep working, and Unique
-- Names cards stay exactly the same ('classic').

alter table public.names add column if not exists origin text;
alter table public.names add column if not exists us_rank int;
alter table public.names add column if not exists us_year int;
do $$ begin
  alter table public.names add constraint names_origin_len check (origin is null or char_length(origin) between 1 and 40);
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.names add constraint names_us_rank_check check (us_rank is null or us_rank between 1 and 100000);
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.names add constraint names_us_year_check check (us_year is null or us_year between 1880 and 2100);
exception when duplicate_object then null; end $$;

alter table public.settings add column if not exists card_layout text not null default 'classic';
do $$ begin
  alter table public.settings add constraint settings_card_layout_check check (card_layout in ('classic', 'name-nest'));
exception when duplicate_object then null; end $$;
