-- Unique Names posting: v2 database changes. Paste the whole file into the Supabase SQL editor and run it.
-- Safe to run more than once, and safe on existing data (every new column has a default).
-- A fresh project gets all of this from supabase/schema.sql already.

-- ---------------------------------------------------------------- "pending" = suggested by AI, waiting for the owner's approval
-- Pending names/themes are never planned: create_post, add_card and the app only ever pick status = 'available'.
alter table public.names drop constraint if exists names_status_check;
alter table public.names add constraint names_status_check
  check (status in ('available', 'reserved', 'used', 'skip', 'pending'));

alter table public.themes drop constraint if exists themes_status_check;
alter table public.themes add constraint themes_status_check
  check (status in ('available', 'used', 'archived', 'pending'));

-- ---------------------------------------------------------------- card text settings
-- Fonts are ids from the app's font catalog (validated in app code; the catalog may grow).
-- Sizes are pixels on a 1080 px wide card.
alter table public.settings add column if not exists title_font text not null default 'poppins';
alter table public.settings add column if not exists meaning_font text not null default 'poppins';
alter table public.settings add column if not exists mark_font text not null default 'poppins';
alter table public.settings add column if not exists title_size int not null default 95;
alter table public.settings add column if not exists meaning_size int not null default 37;
alter table public.settings add column if not exists mark_size int not null default 21;
alter table public.settings add column if not exists text_position text not null default 'auto';
alter table public.settings add column if not exists caption_ai boolean not null default true;

alter table public.settings drop constraint if exists settings_title_font_check;
alter table public.settings add constraint settings_title_font_check check (btrim(title_font) <> '');
alter table public.settings drop constraint if exists settings_meaning_font_check;
alter table public.settings add constraint settings_meaning_font_check check (btrim(meaning_font) <> '');
alter table public.settings drop constraint if exists settings_mark_font_check;
alter table public.settings add constraint settings_mark_font_check check (btrim(mark_font) <> '');
alter table public.settings drop constraint if exists settings_title_size_check;
alter table public.settings add constraint settings_title_size_check check (title_size between 40 and 180);
alter table public.settings drop constraint if exists settings_meaning_size_check;
alter table public.settings add constraint settings_meaning_size_check check (meaning_size between 16 and 90);
alter table public.settings drop constraint if exists settings_mark_size_check;
alter table public.settings add constraint settings_mark_size_check check (mark_size between 12 and 48);
alter table public.settings drop constraint if exists settings_text_position_check;
alter table public.settings add constraint settings_text_position_check check (text_position in (
  'auto', 'top-left', 'top-center', 'top-right', 'middle-left', 'middle-center', 'middle-right',
  'bottom-left', 'bottom-center', 'bottom-right'));
