-- The names PDF shop (brief .superpowers/sdd/2026-10-11-shop, docs/SHOP.md): buyers pay with PayMongo (QR Ph: GCash,
-- Maya and bank apps) on the public /shop page and download their own password-protected PDF. Paste the whole file
-- into the Supabase SQL editor and run it. Safe to run more than once. Needs 018_names_pdf.sql first. A fresh project
-- gets all of this from supabase/schema.sql already. Nothing the worker reads (no restart).
-- * settings.shop_enabled: the owner's on/off switch for the shop (Orders page). OFF until the owner opens it at go-live;
--   the shop also stays closed until the payment keys are set and linked (shop_secrets). With TEST keys only the
--   signed-in owner can use /shop (the app checks that).
-- * shop_orders: one row per order: the buyer, the product (girl / boy / both), the price, the PayMongo ids, its PDF
--   password (kept so the owner can resend it) and how often it was downloaded. Owner only, like exports.
-- * shop_secrets: the hash of the server's shop key (derived from PAYMONGO_WEBHOOK_SECRET). Nobody can read it, not
--   even the owner's app; only the shop functions below compare against it.
-- * The public pages never read a table: they call these narrow SECURITY DEFINER functions with the anon key
--   (the service-role key is never on Vercel):
--     shop_info(key)                       is the shop open (switch on, THIS server's key linked)? + name counts
--     get_shop_order_status(token)         what the thanks page shows (the password only once paid)
--     download_shop_order(token)           the names for the buyer's PDF: paid, < 7 days, < 5 downloads (reserves one)
--     create_shop_order / attach_shop_checkout / claim_shop_check / mark_shop_order_paid / note_shop_order_email /
--     release_shop_download                the server only: each needs the shop key
--   and two for the owner's app (authenticated): set_shop_secret, shop_secret_matches.
-- Until this runs, /shop shows "Coming soon" and the Orders page explains how to add it.

alter table public.settings add column if not exists shop_enabled boolean not null default false;
alter table public.settings alter column shop_enabled set default false;

create table if not exists public.shop_orders (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  token text not null constraint shop_orders_token_check check (token ~ '^[0-9a-f]{96}$'),
  pack text not null constraint shop_orders_pack_len check (char_length(pack) between 1 and 40),
  product text not null constraint shop_orders_product_check check (product in ('girl', 'boy', 'both')),
  amount int not null constraint shop_orders_amount_check check (amount between 100 and 10000000),
  currency text not null default 'PHP' constraint shop_orders_currency_check check (currency ~ '^[A-Z]{3}$'),
  buyer_name text not null constraint shop_orders_buyer_len check (char_length(buyer_name) between 2 and 80),
  email text not null constraint shop_orders_email_check check (char_length(email) between 6 and 254 and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  fb_name text constraint shop_orders_fb_len check (fb_name is null or char_length(fb_name) between 1 and 80),
  ip_hash text constraint shop_orders_ip_hash_check check (ip_hash is null or ip_hash ~ '^[0-9a-f]{32,64}$'),
  status text not null default 'pending' constraint shop_orders_status_check check (status in ('pending', 'paid', 'failed', 'expired')),
  checkout_id text constraint shop_orders_checkout_len check (checkout_id is null or char_length(checkout_id) between 1 and 100),
  payment_id text constraint shop_orders_payment_len check (payment_id is null or char_length(payment_id) between 1 and 100),
  paid_amount int,
  paid_at timestamptz,
  password text constraint shop_orders_password_len check (password is null or char_length(password) between 8 and 64),
  downloads int not null default 0 constraint shop_orders_downloads_check check (downloads between 0 and 1000),
  last_download_at timestamptz,
  -- the server's own payment check with PayMongo (thanks page): at most one every 10 s, 60 per order
  checks int not null default 0 constraint shop_orders_checks_check check (checks between 0 and 1000),
  last_checked_at timestamptz,
  emailed_at timestamptz,
  email_error text constraint shop_orders_email_error_len check (email_error is null or char_length(email_error) <= 300),
  constraint shop_orders_paid_check check (status <> 'paid' or (paid_at is not null and password is not null and payment_id is not null))
);
alter table public.shop_orders add column if not exists checks int not null default 0 constraint shop_orders_checks_check check (checks between 0 and 1000);
alter table public.shop_orders add column if not exists last_checked_at timestamptz;
create unique index if not exists shop_orders_token on public.shop_orders (token);
create unique index if not exists shop_orders_payment on public.shop_orders (payment_id) where payment_id is not null;
create index if not exists shop_orders_created on public.shop_orders (created_at desc);
create index if not exists shop_orders_email_recent on public.shop_orders (email, created_at desc);
create index if not exists shop_orders_ip_recent on public.shop_orders (ip_hash, created_at desc) where ip_hash is not null;
drop trigger if exists touch on public.shop_orders;
create trigger touch before update on public.shop_orders for each row execute function public.touch_updated_at();

create table if not exists public.shop_secrets (
  id int primary key default 1 constraint shop_secrets_one check (id = 1),
  key_hash bytea not null constraint shop_secrets_hash_len check (octet_length(key_hash) = 32),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------- shop functions
-- earlier drafts of these functions had other arguments
drop function if exists public.shop_info();
drop function if exists public.create_shop_order(text, text, int, text, text, text, text, text);
drop function if exists public.mark_shop_order_paid(uuid, text, text, int, text, text, text);

-- The server's shop key, checked against the stored hash (never callable from outside: the functions below use it).
create or replace function public.shop_secret_ok(p_secret text) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select char_length(coalesce(p_secret, '')) >= 32
    and exists (select 1 from public.shop_secrets where id = 1 and key_hash = sha256(convert_to(p_secret, 'UTF8')));
$$;

-- Is the shop open (the owner's switch on, and the key linked is THIS server's key), and how many approved names each
-- edition has.
create or replace function public.shop_info(p_secret text) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'enabled', coalesce((select shop_enabled from public.settings where id = 1), false),
    'ready', public.shop_secret_ok(p_secret),
    'counts', jsonb_build_object(
      'girl_single', (select count(*) from public.names where gender = 'girl' and style = 'single' and status in ('available', 'reserved', 'used')),
      'girl_combo', (select count(*) from public.names where gender = 'girl' and style = 'two-word' and status in ('available', 'reserved', 'used')),
      'boy_single', (select count(*) from public.names where gender = 'boy' and style = 'single' and status in ('available', 'reserved', 'used')),
      'boy_combo', (select count(*) from public.names where gender = 'boy' and style = 'two-word' and status in ('available', 'reserved', 'used'))));
$$;

-- A pending order, made by our server only (it needs the shop key, so the honeypot and the network limit cannot be
-- skipped by calling this directly). The price comes from the server's pack config (the webhook checks the paid amount
-- against both). p_ignore_pause: the server's owner-only TEST mode may order while the shop switch is off.
-- Rate limits: 5 orders per email and 10 per network (hashed IP) an hour, 120 in any 10 minutes for the whole shop,
-- counted under a lock so calls at the same moment cannot pass them together.
-- Answers {status: ok, id, token} | {status: error, reason: forbidden | closed | invalid | rate_limited | busy}.
create or replace function public.create_shop_order(p_pack text, p_product text, p_amount int, p_currency text,
  p_buyer text, p_email text, p_fb text, p_ip_hash text, p_ignore_pause boolean, p_secret text) returns jsonb
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  v_buyer text := regexp_replace(btrim(coalesce(p_buyer, '')), '\s+', ' ', 'g');
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_fb text := nullif(regexp_replace(btrim(coalesce(p_fb, '')), '\s+', ' ', 'g'), '');
  v_ip text := nullif(lower(btrim(coalesce(p_ip_hash, ''))), '');
  v_token text;
  v_id uuid;
begin
  if not public.shop_secret_ok(p_secret) then return jsonb_build_object('status', 'error', 'reason', 'forbidden'); end if;
  if not coalesce(p_ignore_pause, false) and not coalesce((select shop_enabled from public.settings where id = 1), false) then
    return jsonb_build_object('status', 'error', 'reason', 'closed');
  end if;
  if coalesce(p_product, '') not in ('girl', 'boy', 'both') or p_amount is null or p_amount not between 100 and 10000000
    or coalesce(p_currency, '') !~ '^[A-Z]{3}$' or char_length(coalesce(p_pack, '')) not between 1 and 40
    or char_length(v_buyer) not between 2 and 80 or v_buyer ~ '[[:cntrl:]<>]'
    or char_length(v_email) not between 6 and 254 or v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'
    or (v_fb is not null and (char_length(v_fb) > 80 or v_fb ~ '[[:cntrl:]<>]'))
    or (v_ip is not null and v_ip !~ '^[0-9a-f]{32,64}$') then
    return jsonb_build_object('status', 'error', 'reason', 'invalid');
  end if;
  -- one order at a time from here on (until this transaction ends), so the limits below hold
  perform pg_advisory_xact_lock(hashtext('public.create_shop_order'));
  -- unpaid orders older than a day are over (a PayMongo checkout lasts 24 hours)
  update public.shop_orders set status = 'expired' where status = 'pending' and created_at < now() - interval '1 day';
  if (select count(*) from public.shop_orders where email = v_email and created_at > now() - interval '1 hour') >= 5
    or (v_ip is not null and (select count(*) from public.shop_orders where ip_hash = v_ip and created_at > now() - interval '1 hour') >= 10) then
    return jsonb_build_object('status', 'error', 'reason', 'rate_limited');
  end if;
  if (select count(*) from public.shop_orders where created_at > now() - interval '10 minutes') >= 120 then
    return jsonb_build_object('status', 'error', 'reason', 'busy');
  end if;
  -- 3 random v4 UUIDs = 366 random bits from the server's strong random source, as 96 hex characters
  v_token := replace(gen_random_uuid()::text || gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
  insert into public.shop_orders (token, pack, product, amount, currency, buyer_name, email, fb_name, ip_hash)
    values (v_token, p_pack, p_product, p_amount, p_currency, v_buyer, v_email, v_fb, v_ip)
    returning id into v_id;
  return jsonb_build_object('status', 'ok', 'id', v_id, 'token', v_token);
end $$;

-- What the thanks page shows for a token (null = no such order). The PDF password only once the order is paid.
create or replace function public.get_shop_order_status(p_token text) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare o public.shop_orders%rowtype;
begin
  if coalesce(p_token, '') !~ '^[0-9a-f]{96}$' then return null; end if;
  select * into o from public.shop_orders where token = p_token;
  if not found then return null; end if;
  return jsonb_build_object(
    'id', o.id,
    'status', case when o.status = 'pending' and o.created_at < now() - interval '1 day' then 'expired' else o.status end,
    'product', o.product, 'amount', o.amount, 'currency', o.currency, 'buyer_name', o.buyer_name, 'email', o.email,
    'pack', o.pack, 'created_at', o.created_at, 'paid_at', o.paid_at, 'checkout_id', o.checkout_id,
    'password', case when o.status = 'paid' then o.password end,
    'downloads', o.downloads, 'max_downloads', 5,
    'expires_at', case when o.status = 'paid' then o.paid_at + interval '7 days' end,
    'emailed', o.emailed_at is not null);
end $$;

-- The server keeps the PayMongo checkout session id on its order (needs the shop key).
create or replace function public.attach_shop_checkout(p_order uuid, p_checkout_id text, p_secret text) returns boolean
language plpgsql volatile security definer set search_path = public, pg_temp as $$
begin
  if not public.shop_secret_ok(p_secret) or char_length(coalesce(p_checkout_id, '')) not between 1 and 100 then return false; end if;
  update public.shop_orders set checkout_id = p_checkout_id where id = p_order and status = 'pending' and checkout_id is null;
  return found;
end $$;

-- The thanks page's own check with PayMongo: allowed at most once every 10 seconds and 60 times per pending order
-- (needs the shop key). true = go ahead and ask PayMongo now.
create or replace function public.claim_shop_check(p_token text, p_secret text) returns boolean
language plpgsql volatile security definer set search_path = public, pg_temp as $$
begin
  if not public.shop_secret_ok(p_secret) or coalesce(p_token, '') !~ '^[0-9a-f]{96}$' then return false; end if;
  update public.shop_orders set checks = checks + 1, last_checked_at = now()
    where token = p_token and status = 'pending' and checks < 60
      and (last_checked_at is null or last_checked_at < now() - interval '10 seconds');
  return found;
end $$;

-- PayMongo says the order is paid (webhook, or the server's own check of the checkout session): needs the shop key,
-- the order's exact amount, currency and product, and its checkout session. Idempotent: a paid order answers already = true
-- and keeps its first password (the email goes out once). A late payment of an expired / failed order still counts.
-- Answers {status: ok, already, id, token, email, buyer_name, product, password, pack} |
-- {status: error, reason: forbidden | not_found | mismatch | invalid | duplicate_payment}.
create or replace function public.mark_shop_order_paid(p_order uuid, p_checkout_id text, p_payment_id text, p_amount int,
  p_currency text, p_product text, p_password text, p_secret text) returns jsonb
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare o public.shop_orders%rowtype;
begin
  if not public.shop_secret_ok(p_secret) then return jsonb_build_object('status', 'error', 'reason', 'forbidden'); end if;
  select * into o from public.shop_orders where id = p_order for update;
  if not found then return jsonb_build_object('status', 'error', 'reason', 'not_found'); end if;
  if o.status <> 'paid' then
    if p_amount is distinct from o.amount or upper(coalesce(p_currency, '')) is distinct from o.currency or p_product is distinct from o.product
      or (o.checkout_id is not null and p_checkout_id is distinct from o.checkout_id) then
      return jsonb_build_object('status', 'error', 'reason', 'mismatch');
    end if;
    if char_length(coalesce(p_password, '')) not between 8 and 64 or char_length(coalesce(p_payment_id, '')) not between 1 and 100 then
      return jsonb_build_object('status', 'error', 'reason', 'invalid');
    end if;
    if exists (select 1 from public.shop_orders where payment_id = p_payment_id and id <> o.id) then
      return jsonb_build_object('status', 'error', 'reason', 'duplicate_payment');
    end if;
    update public.shop_orders set status = 'paid', paid_at = now(), payment_id = p_payment_id, paid_amount = p_amount,
      checkout_id = coalesce(o.checkout_id, p_checkout_id), password = p_password
      where id = o.id returning * into o;
    return jsonb_build_object('status', 'ok', 'already', false, 'id', o.id, 'token', o.token, 'email', o.email,
      'buyer_name', o.buyer_name, 'product', o.product, 'password', o.password, 'pack', o.pack);
  end if;
  return jsonb_build_object('status', 'ok', 'already', true, 'id', o.id, 'token', o.token, 'email', o.email,
    'buyer_name', o.buyer_name, 'product', o.product, 'password', o.password, 'pack', o.pack);
end $$;

-- The server notes the delivery email: sent (p_error null) or why it failed (shown on the Orders page).
create or replace function public.note_shop_order_email(p_order uuid, p_error text, p_secret text) returns boolean
language plpgsql volatile security definer set search_path = public, pg_temp as $$
begin
  if not public.shop_secret_ok(p_secret) then return false; end if;
  if p_error is null then
    update public.shop_orders set emailed_at = now(), email_error = null where id = p_order and status = 'paid';
  else
    update public.shop_orders set email_error = left(p_error, 300) where id = p_order and status = 'paid';
  end if;
  return found;
end $$;

-- The buyer's download: only a paid order, within 7 days of payment, at most 5 times. This call reserves one download;
-- the server gives it back (release_shop_download) when the PDF could not be made. Answers
-- {status: ok, product, buyer_name, email, password, pack, downloads, names: [{name, meaning, gender, style, status,
-- origin, meaning_category}]} | {status: error, reason: not_found | unpaid | expired | limit}.
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
      'status', n.status, 'origin', to_jsonb(n)->>'origin', 'meaning_category', n.meaning_category) order by n.name), '[]'::jsonb)
    into v_names
    from public.names n
    where n.status in ('available', 'reserved', 'used') and (o.product = 'both' or n.gender = o.product);
  return jsonb_build_object('status', 'ok', 'product', o.product, 'buyer_name', o.buyer_name, 'email', o.email,
    'password', o.password, 'pack', o.pack, 'downloads', o.downloads + 1, 'names', v_names);
end $$;

-- A reserved download whose PDF could not be made is given back (needs the shop key).
create or replace function public.release_shop_download(p_token text, p_secret text) returns boolean
language plpgsql volatile security definer set search_path = public, pg_temp as $$
begin
  if not public.shop_secret_ok(p_secret) or coalesce(p_token, '') !~ '^[0-9a-f]{96}$' then return false; end if;
  update public.shop_orders set downloads = downloads - 1 where token = p_token and status = 'paid' and downloads > 0;
  return found;
end $$;

-- The owner's app links the server's shop key (Orders > Link payments) and checks it is still the same.
create or replace function public.set_shop_secret(p_secret text) returns boolean
language plpgsql volatile security definer set search_path = public, pg_temp as $$
begin
  if char_length(coalesce(p_secret, '')) < 32 then return false; end if;
  insert into public.shop_secrets (id, key_hash, updated_at) values (1, sha256(convert_to(p_secret, 'UTF8')), now())
    on conflict (id) do update set key_hash = excluded.key_hash, updated_at = now();
  return true;
end $$;

create or replace function public.shop_secret_matches(p_secret text) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select public.shop_secret_ok(p_secret);
$$;

-- @supabase-only begin
alter table public.shop_orders enable row level security;
drop policy if exists owner_all on public.shop_orders;
create policy owner_all on public.shop_orders for all to authenticated using (true) with check (true);
grant select, insert, update, delete on public.shop_orders to authenticated, service_role;
revoke all on public.shop_orders from anon;
-- nobody reads the key hash directly (RLS on, no policy, no grants): only the functions above
alter table public.shop_secrets enable row level security;
revoke all on public.shop_secrets from anon, authenticated;
grant select, insert, update, delete on public.shop_secrets to service_role;

revoke execute on function public.shop_secret_ok(text) from public, anon, authenticated;
revoke execute on function public.shop_info(text) from public;
revoke execute on function public.create_shop_order(text, text, int, text, text, text, text, text, boolean, text) from public;
revoke execute on function public.claim_shop_check(text, text) from public;
revoke execute on function public.release_shop_download(text, text) from public;
revoke execute on function public.get_shop_order_status(text) from public;
revoke execute on function public.attach_shop_checkout(uuid, text, text) from public;
revoke execute on function public.mark_shop_order_paid(uuid, text, text, int, text, text, text, text) from public;
revoke execute on function public.note_shop_order_email(uuid, text, text) from public;
revoke execute on function public.download_shop_order(text) from public;
revoke execute on function public.set_shop_secret(text) from public, anon;
revoke execute on function public.shop_secret_matches(text) from public, anon;
grant execute on function public.shop_info(text), public.create_shop_order(text, text, int, text, text, text, text, text, boolean, text),
  public.get_shop_order_status(text), public.attach_shop_checkout(uuid, text, text), public.claim_shop_check(text, text),
  public.mark_shop_order_paid(uuid, text, text, int, text, text, text, text), public.note_shop_order_email(uuid, text, text),
  public.download_shop_order(text), public.release_shop_download(text, text) to anon, authenticated, service_role;
grant execute on function public.set_shop_secret(text), public.shop_secret_matches(text) to authenticated, service_role;
-- @supabase-only end
