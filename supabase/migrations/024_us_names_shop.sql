-- Unique Names posting: names skipped as "Not a US name" stay in the shop (spec
-- docs/superpowers/specs/2026-11-24-us-names-design.md, "Owner decisions after the final review"). The Names page's
-- "Check names against the US list" sets names that are not US names to Skip with the note 'Not a US name': they
-- stop being used in posts, but they are still sold. Paste the whole file into the Supabase SQL editor and run it.
-- Safe to run more than once. Run it after 022_autopilot.sql (names.autopilot_note) and 019_shop.sql. A fresh project
-- gets all of this from supabase/schema.sql already. No table changes; grants are kept (create or replace).
-- Until this runs, the shop's name counts and a buyer's PDF just leave those names out.

do $$ begin
  if to_regprocedure('public.shop_info(text)') is null or to_regprocedure('public.download_shop_order(text)') is null
     or not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'names' and column_name = 'autopilot_note') then
    raise exception '024_us_names_shop.sql needs 019_shop.sql and 022_autopilot.sql first';
  end if;
end $$;

-- Is the shop open (the owner's switch on, and the key linked is THIS server's key), and how many approved names each
-- edition has (names skipped only as "Not a US name" count too: they are still sold).
create or replace function public.shop_info(p_secret text) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'enabled', coalesce((select shop_enabled from public.settings where id = 1), false),
    'ready', public.shop_secret_ok(p_secret),
    'counts', jsonb_build_object(
      'girl_single', (select count(*) from public.names where gender = 'girl' and style = 'single' and (status in ('available', 'reserved', 'used') or (status = 'skip' and autopilot_note = 'Not a US name'))),
      'girl_combo', (select count(*) from public.names where gender = 'girl' and style = 'two-word' and (status in ('available', 'reserved', 'used') or (status = 'skip' and autopilot_note = 'Not a US name'))),
      'boy_single', (select count(*) from public.names where gender = 'boy' and style = 'single' and (status in ('available', 'reserved', 'used') or (status = 'skip' and autopilot_note = 'Not a US name'))),
      'boy_combo', (select count(*) from public.names where gender = 'boy' and style = 'two-word' and (status in ('available', 'reserved', 'used') or (status = 'skip' and autopilot_note = 'Not a US name')))));
$$;

-- A buyer's download (the token is the secret): the paid order's names, same rule as the counts above. Each name
-- carries its note, so the PDF keeps the "Not a US name" skips and leaves every other skip out.
create or replace function public.download_shop_order(p_token text) returns jsonb
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare o public.shop_orders%rowtype; v_names jsonb;
begin
  if coalesce(p_token, '') !~ '^[0-9a-f]{96}$' then return jsonb_build_object('status', 'error', 'reason', 'not_found'); end if;
  select * into o from public.shop_orders where token = p_token for update;
  if not found then return jsonb_build_object('status', 'error', 'reason', 'not_found'); end if;
  if o.status <> 'paid' then return jsonb_build_object('status', 'error', 'reason', 'unpaid'); end if;
  if o.paid_at < now() - interval '7 days' then return jsonb_build_object('status', 'error', 'reason', 'expired'); end if;
  if o.downloads >= 5 then return jsonb_build_object('status', 'error', 'reason', 'limit'); end if;
  update public.shop_orders set downloads = downloads + 1, last_download_at = now() where id = o.id;
  -- to_jsonb(n)->>'origin': names.origin exists only after 015_name_nest.sql
  select coalesce(jsonb_agg(jsonb_build_object('name', n.name, 'meaning', n.meaning, 'gender', n.gender, 'style', n.style,
      'status', n.status, 'origin', to_jsonb(n)->>'origin', 'meaning_category', n.meaning_category, 'autopilot_note', n.autopilot_note) order by n.name), '[]'::jsonb)
    into v_names
    from public.names n
    where (n.status in ('available', 'reserved', 'used') or (n.status = 'skip' and n.autopilot_note = 'Not a US name'))
      and (o.product = 'both' or n.gender = o.product);
  return jsonb_build_object('status', 'ok', 'product', o.product, 'buyer_name', o.buyer_name, 'email', o.email,
    'password', o.password, 'pack', o.pack, 'downloads', o.downloads + 1, 'names', v_names);
end $$;
