// The owner's Orders page (names PDF shop, migration 019): how an order's status reads, the revenue totals and the
// filter. Pure and client-safe.

export type OrderStatus = "pending" | "paid" | "failed" | "expired";
export const ORDER_STATUSES: readonly OrderStatus[] = ["paid", "pending", "expired", "failed"];

export interface OrderRow {
  id: string;
  created_at: string;
  buyer_name: string;
  email: string;
  fb_name: string | null;
  product: "girl" | "boy" | "both";
  amount: number;
  currency: string;
  status: OrderStatus;
  paid_at: string | null;
  downloads: number;
  emailed_at: string | null;
  email_error: string | null;
}

/** An unpaid order older than a day is over (the database marks it on the next order; the page shows it at once). */
export function displayStatus(o: Pick<OrderRow, "status" | "created_at">, now: Date): OrderStatus {
  if (o.status === "pending" && now.getTime() - new Date(o.created_at).getTime() > 24 * 3600_000) return "expired";
  return o.status;
}

/** The calendar day / month of a moment in the shop's time zone ("2026-10-11" / "2026-10"). */
export function dayIn(d: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

/** Paid totals (smallest unit) for today and this month in the shop's time zone, and their order counts. */
export function revenueTotals(rows: readonly Pick<OrderRow, "status" | "paid_at" | "amount">[], now: Date, timeZone = "Asia/Manila") {
  const today = dayIn(now, timeZone);
  const month = today.slice(0, 7);
  const out = { today: 0, todayCount: 0, month: 0, monthCount: 0 };
  for (const r of rows) {
    if (r.status !== "paid" || !r.paid_at) continue;
    const day = dayIn(new Date(r.paid_at), timeZone);
    if (day.slice(0, 7) === month) { out.month += r.amount; out.monthCount += 1; }
    if (day === today) { out.today += r.amount; out.todayCount += 1; }
  }
  return out;
}

export const isOrderStatus = (v: unknown): v is OrderStatus => typeof v === "string" && (ORDER_STATUSES as readonly string[]).includes(v);

/** The list as filtered on the page ("all" or one status, as displayed). */
export function filterOrders<T extends Pick<OrderRow, "status" | "created_at">>(rows: readonly T[], filter: OrderStatus | "all", now: Date): T[] {
  return filter === "all" ? [...rows] : rows.filter((r) => displayStatus(r, now) === filter);
}
