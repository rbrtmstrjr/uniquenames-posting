"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, CheckCircle2, Copy, Eye, Mail, XCircle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Panel } from "@/components/ui/panel";
import { Switch } from "@/components/ui/shadcn/switch";
import { callAction } from "@/lib/actions/call";
import { linkShopKeyAction, resendOrderEmailAction, revealOrderPasswordAction, setShopEnabledAction } from "@/lib/actions/shop";
import { displayStatus, filterOrders, ORDER_STATUSES, type OrderRow, type OrderStatus } from "@/lib/shop/orders";
import { cn } from "@/lib/utils/cn";

// Orders (names PDF shop, migration 019): revenue today / this month, the shop's setup checklist and on/off switch,
// and every order: buyer, edition, amount, status, paid time, downloads, email, password on demand, resend email.

export interface ShopSetup {
  packSells: boolean;
  keys: boolean;
  mode: "test" | "live" | null;
  webhookSecret: boolean;
  linked: boolean;
  email: boolean;
  enabled: boolean;
  unsorted: number;
  shopUrl: string;
  webhookUrl: string;
}

const PRODUCT: Record<OrderRow["product"], string> = { girl: "Girl", boy: "Boy", both: "Girl & Boy" };
const STATUS_STYLE: Record<OrderStatus, string> = {
  paid: "bg-ok/15 text-ok", pending: "bg-accent-soft text-accent", expired: "bg-surface-2 text-muted", failed: "bg-bad/10 text-bad",
};
const when = (iso: string) => new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "Asia/Manila" });

export function OrdersAdmin({ orders, totals, setup, money, now }: {
  orders: OrderRow[] | null;
  totals: { today: string; todayCount: number; month: string; monthCount: number };
  setup: ShopSetup;
  money: Record<string, string>;
  now: string;
}) {
  const router = useRouter();
  const [filter, setFilter] = useState<OrderStatus | "all">("all");
  const [shown, setShown] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const at = new Date(now);

  const run = async (key: string, fn: () => Promise<{ ok: boolean; error?: string }>, done?: string) => {
    setBusy(key);
    const r = await fn();
    setBusy(null);
    if (r.ok) { if (done) toast.success(done); router.refresh(); } else toast.error(r.error ?? "Something went wrong.");
    return r;
  };
  const reveal = async (id: string) => {
    setBusy(`pw-${id}`);
    const r = await callAction(() => revealOrderPasswordAction(id));
    setBusy(null);
    if (r.ok) setShown((s) => ({ ...s, [id]: r.password })); else toast.error(r.error);
  };
  const copy = async (text: string, what: string) => {
    try { await navigator.clipboard.writeText(text); toast.success(`${what} copied`); } catch { toast.error("Could not copy. Select it and copy it by hand."); }
  };

  const checks: { ok: boolean; label: string; hint?: string }[] = [
    { ok: setup.packSells, label: "This page sells the PDF", hint: "Turned off in the pack (packs/<id>/shop.ts)." },
    { ok: setup.keys, label: `PayMongo keys${setup.mode ? ` (${setup.mode} mode)` : ""}`, hint: "Add PAYMONGO_SECRET_KEY and PAYMONGO_PUBLIC_KEY in Vercel." },
    { ok: setup.webhookSecret, label: "PayMongo webhook", hint: `Add a webhook for ${setup.webhookUrl} (event checkout_session.payment.paid) and put its secret in PAYMONGO_WEBHOOK_SECRET.` },
    { ok: setup.linked, label: "Payments linked to the database", hint: "Press Link payments (again after changing the webhook secret)." },
    { ok: setup.email, label: "Email delivery (Gmail)", hint: "Optional: SMTP_USER + SMTP_PASS (an app password). Without it buyers still get the PDF on the page." },
  ];
  const list = orders ? filterOrders(orders, filter, at) : [];

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <Panel title="Today"><p className="font-display text-3xl text-ink">{totals.today}</p><p className="text-sm text-muted">{totals.todayCount} paid order{totals.todayCount === 1 ? "" : "s"}</p></Panel>
        <Panel title="This month"><p className="font-display text-3xl text-ink">{totals.month}</p><p className="text-sm text-muted">{totals.monthCount} paid order{totals.monthCount === 1 ? "" : "s"}</p></Panel>
      </div>

      <Panel title="Shop" action={
        <label className="flex items-center gap-2 text-sm font-semibold text-ink">
          {setup.enabled ? "Open" : "Paused"}
          <Switch checked={setup.enabled} disabled={busy === "toggle" || orders === null}
            onCheckedChange={(on) => void run("toggle", () => callAction(() => setShopEnabledAction(on)), on ? "Shop is open" : "Shop is paused")} aria-label="Shop open" />
        </label>
      }>
        <ul className="space-y-2">
          {checks.map((c) => (
            <li key={c.label} className="flex gap-2 text-sm">
              {c.ok ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-ok" aria-label="Done" /> : <XCircle className="mt-0.5 size-4 shrink-0 text-bad" aria-label="Not yet" />}
              <span><span className="font-semibold text-ink">{c.label}</span>{!c.ok && c.hint ? <span className="block text-muted">{c.hint}</span> : null}</span>
            </li>
          ))}
        </ul>
        {setup.unsorted > 0 && (
          <p className="mt-3 flex gap-2 rounded-xl bg-accent-soft px-3 py-2 text-sm text-ink">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-accent" aria-hidden />
            {setup.unsorted} approved names have no meaning group yet; buyers see them under the last group. Sort them on Names &gt; Export PDF.
          </p>
        )}
        <div className="mt-3 flex flex-wrap gap-2">
          {setup.webhookSecret && !setup.linked && (
            <Button size="sm" loading={busy === "link"} onClick={() => void run("link", () => callAction(() => linkShopKeyAction()), "Payments linked")}>Link payments</Button>
          )}
          <Button size="sm" variant="subtle" onClick={() => void copy(setup.shopUrl, "Shop link")}><Copy className="size-4" aria-hidden /> Copy shop link</Button>
          <Button size="sm" variant="ghost" onClick={() => void copy(setup.webhookUrl, "Webhook URL")}><Copy className="size-4" aria-hidden /> Copy webhook URL</Button>
        </div>
      </Panel>

      <Panel title="Orders">
        {orders === null ? (
          <p className="text-sm text-muted">Run <code>supabase/migrations/019_shop.sql</code> to start selling. Orders appear here.</p>
        ) : (
          <>
            <div className="mb-3 flex flex-wrap gap-1.5" role="group" aria-label="Filter orders">
              {(["all", ...ORDER_STATUSES] as const).map((f) => (
                <button key={f} type="button" onClick={() => setFilter(f)} aria-pressed={filter === f}
                  className={cn("min-h-9 rounded-full px-3 text-sm font-semibold capitalize transition", filter === f ? "bg-accent text-accent-ink" : "bg-surface-2 text-ink")}>
                  {f}
                </button>
              ))}
            </div>
            {list.length === 0 ? <p className="text-sm text-muted">No orders here yet.</p> : (
              <ul className="divide-y divide-line">
                {list.map((o) => {
                  const status = displayStatus(o, at);
                  return (
                    <li key={o.id} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 py-3">
                      <div className="min-w-0 basis-full sm:basis-0 sm:flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="break-words font-semibold text-ink">{o.buyer_name}</span>
                          <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-bold uppercase", STATUS_STYLE[status])}>{status}</span>
                        </div>
                        <div className="break-words text-xs text-muted">
                          {o.email}{o.fb_name ? ` · FB: ${o.fb_name}` : ""} · {PRODUCT[o.product]} · {money[o.id]} · {status === "paid" && o.paid_at ? `paid ${when(o.paid_at)}` : when(o.created_at)}
                          {status === "paid" ? ` · ${o.downloads}/5 downloads · ${o.emailed_at ? "emailed" : o.email_error ? `email failed: ${o.email_error}` : "not emailed"}` : ""}
                        </div>
                      </div>
                      {status === "paid" && (
                        <div className="flex flex-wrap items-center gap-1">
                          {shown[o.id] ? (
                            <>
                              <span className="select-all font-mono text-sm font-semibold text-ink">{shown[o.id]}</span>
                              <Button variant="ghost" size="icon" aria-label={`Copy the password for ${o.buyer_name}`} onClick={() => void copy(shown[o.id], "Password")}><Copy className="size-4" /></Button>
                            </>
                          ) : (
                            <Button variant="ghost" size="sm" loading={busy === `pw-${o.id}`} onClick={() => void reveal(o.id)} aria-label={`Show the password for ${o.buyer_name}`}><Eye className="size-4" aria-hidden /> Password</Button>
                          )}
                          <Button variant="ghost" size="sm" loading={busy === `mail-${o.id}`} aria-label={`Send the email again to ${o.buyer_name}`}
                            onClick={() => void run(`mail-${o.id}`, () => callAction(() => resendOrderEmailAction(o.id)), "Email sent")}><Mail className="size-4" aria-hidden /> Resend</Button>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </>
        )}
      </Panel>
    </div>
  );
}
