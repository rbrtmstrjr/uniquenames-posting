-- The sellable names PDF (Names > Export PDF, brief .superpowers/sdd/2026-10-11-names-pdf): every approved name sorted
-- by what its meaning is about, and a log of every PDF made for a buyer. Paste the whole file into the Supabase SQL
-- editor and run it. Safe to run more than once. Needs 017_initials_posts.sql first (015_name_nest.sql is not needed).
-- A fresh project gets all of this from supabase/schema.sql already. Nothing the worker reads (no restart).
-- * names.meaning_category: the meaning group a name is listed under in the PDF ('nature' = Nature & Flowers, …,
--   'more' = More Beautiful Names); the AI sorts each name once, the owner can change it on the Names page. null =
--   not sorted yet.
-- * exports: one row per PDF made: the buyer it was made for, the gender, how many names, its password (kept so the
--   owner can send it again), the file name and the page (pack). Owner only.
-- Until this runs, Export PDF still works: names are sorted in memory for that one PDF, and the PDF is not logged.

alter table public.names add column if not exists meaning_category text;
alter table public.names drop constraint if exists names_meaning_category_check;
alter table public.names add constraint names_meaning_category_check check (meaning_category is null or meaning_category in
  ('nature', 'light', 'water', 'strength', 'faith', 'love', 'wisdom', 'royal', 'peace', 'gems', 'earth', 'more'));

create table if not exists public.exports (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  buyer text not null constraint exports_buyer_len check (char_length(buyer) between 1 and 120),
  gender text not null constraint exports_gender_check check (gender in ('girl', 'boy', 'both')),
  name_count int not null constraint exports_name_count_check check (name_count >= 0),
  password text not null constraint exports_password_len check (char_length(password) between 8 and 64),
  file_name text not null constraint exports_file_name_len check (char_length(file_name) between 1 and 200),
  pack text not null constraint exports_pack_len check (char_length(pack) between 1 and 40)
);
create index if not exists exports_created on public.exports (created_at desc);

-- @supabase-only begin
alter table public.exports enable row level security;
drop policy if exists owner_all on public.exports;
create policy owner_all on public.exports for all to authenticated using (true) with check (true);
grant select, insert, update, delete on public.exports to authenticated, service_role;
revoke all on public.exports from anon;
-- @supabase-only end
