# The names PDF shop (PayMongo)

Buyers open your shop page from a link in your Facebook post comments, pay with **GCash, Maya or their bank app (QR Ph)**,
and download their own PDF right away. Nobody has to confirm payments by hand: the PDF unlocks only after PayMongo
confirms the payment. Brief: `.superpowers/sdd/2026-10-11-shop/brief.md`.

| Edition | Price (Unique Names) |
|---|---|
| Girl Names Edition | ₱50 |
| Boy Names Edition | ₱50 |
| Girl & Boy Bundle | ₱100 |

Prices, names and every text live in `packs/unique-names/shop.ts` (Name Nest: `packs/name-nest/shop.ts`, switched off).

## How it works

1. **/shop** (no login): the PDF's cover and a sample page, what's inside (live name counts), the three editions, a form
   (name, email, optional Facebook name), trust notes, FAQ and a "Need help?" Messenger link.
2. **Continue to payment**: the server makes a pending order and a PayMongo checkout at the pack's price (the browser
   never sends a price) and sends the buyer to PayMongo. Your account (Individual) uses **QR Ph**: the buyer saves or
   scans the QR, then in GCash: **Pay QR > Upload QR**.
3. PayMongo calls **`/api/paymongo/webhook`** (`checkout_session.payment.paid`). The server checks PayMongo's signature,
   the amount, the currency, the product and the order, then marks the order paid with a new random PDF password and
   emails the buyer (if email is set up).
4. **/shop/thanks?o=…** waits until the order is really paid (it also asks PayMongo directly every ~15 s, in case the
   webhook is late), then shows **Download PDF** and the password with a **Copy** button.
5. **Download**: the same PDF as Names > Export PDF, with the buyer's name and email on every page and the order's own
   password. The link works for **7 days, up to 5 downloads**.
6. **Orders** (in your app, owner only): revenue today and this month, every order, show a password, resend the email,
   pause or open the shop.

## Owner setup

Do these in order. Test mode first, then live.

### 1. Run migration 019
Supabase **SQL Editor**: paste and run `supabase/migrations/019_shop.sql` (safe to run again; needs 018 first; no
worker restart). Until it runs, /shop shows **Coming soon**.

### 2. PayMongo keys in Vercel (test first)
PayMongo dashboard > **Developers > API keys** (test mode). In Vercel > Settings > Environment Variables
(Production, mark them **Sensitive**):
- `PAYMONGO_PUBLIC_KEY` = `pk_test_…`
- `PAYMONGO_SECRET_KEY` = `sk_test_…`

### 3. The webhook
PayMongo dashboard > **Developers > Webhooks > Add endpoint**:
- URL: **`https://<your site>/api/paymongo/webhook`** (Orders > **Copy webhook URL** gives you the exact one)
- Event: **`checkout_session.payment.paid`**

PayMongo then shows the webhook's secret (`whsk_…`). Add it in Vercel as `PAYMONGO_WEBHOOK_SECRET`.
Optional: `SHOP_BASE_URL` = your site's `https://` address (default: Vercel's production address).
Redeploy (push to GitHub or press Redeploy).

### 4. Link payments
Open **Orders** in the app and press **Link payments**. This stores a fingerprint (hash) of a key made from the
webhook secret in the database, so only your server can mark orders paid. Press it again whenever you change the
webhook secret (for example test > live). The checklist on Orders turns green.

### 5. Email (optional, recommended)
Google account > Security > 2-Step Verification > **App passwords** > create one (for "Mail"). In Vercel:
- `SMTP_USER` = your Gmail address
- `SMTP_PASS` = the 16-letter app password (not your Gmail password)
- `SMTP_FROM` = optional, the From address (default `SMTP_USER`)

Without these, buyers still get the download and password on the thanks page; Orders shows "not emailed".

### 6. Help link
The "Need help?" link opens Messenger with your page: `https://m.me/61572452954153` (your page id; the page has no
username), set in `packs/unique-names/shop.ts`. `SHOP_MESSENGER_URL` in Vercel overrides it.

### 7. Test in test mode
Open `/shop`, pick an edition, use your own email and pay on PayMongo's test checkout. The thanks page should switch
to **Download PDF** within seconds; Orders shows the order as **paid**.

### 8. Go live
PayMongo: switch to live, copy the **live** keys and add a **live** webhook (same URL, same event). In Vercel replace
`PAYMONGO_PUBLIC_KEY`, `PAYMONGO_SECRET_KEY` (`sk_live_…`) and `PAYMONGO_WEBHOOK_SECRET` with the live ones, redeploy,
then **Orders > Link payments** again. Then do one real **₱50** purchase yourself with GCash (Pay QR > Upload QR),
download it, open it with the password, and check the email and the Orders page. Refund it from the PayMongo dashboard
if you like.

## The link to post
`https://<your site>/shop` (Orders > **Copy shop link**). Put it in your post comments, for example:
"Get the full list of our unique names in one PDF, with meanings: <link> (₱50 girl / ₱50 boy / ₱100 both)."

## Refunds and disputes
Everything about money happens in the **PayMongo dashboard**: refunds (Payments > the payment > Refund; QR Ph refunds
follow PayMongo's QR Ph refund process) and disputes. A refund does not lock the PDF the buyer already downloaded.
Payouts go to the bank account in your PayMongo settings.

## Pausing the shop
Orders > the **Open / Paused** switch. Paused (or no keys, or not linked): /shop shows **Coming soon**; orders already
paid can still be downloaded.

## More payment methods later
Your account accepts QR Ph now. When PayMongo enables more (for example direct GCash or Maya), set
`SHOP_PAYMENT_METHODS=qrph,gcash,paymaya` in Vercel (or change `paymentMethods` in the pack) and redeploy.
Messenger delivery: a slot is ready in the pack (`delivery.messenger`), not built yet.

## Security (what keeps it safe)
- The Supabase service-role key is never on Vercel. The public pages use the anon key, which can only call the shop's
  database functions; it cannot read any table (orders, names, the key fingerprint).
- Only a request signed by PayMongo (checked on the exact bytes received, 5-minute window) or the server's own question
  to PayMongo can mark an order paid; the database also demands the server's shop key. The thanks page never trusts
  PayMongo's redirect.
- Prices come from the pack on the server; the paid amount and currency must match the order exactly.
- Every order has a random 96-character link token; PDF passwords are new for every order. Emails and passwords are
  never written to logs.
- Limits: 5 orders an hour per email, 10 per network, 120 in any 10 minutes for the whole shop; a hidden honeypot field
  stops simple bots.
