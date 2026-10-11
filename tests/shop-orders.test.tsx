// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { displayStatus, filterOrders, revenueTotals, type OrderRow } from "@/lib/shop/orders";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
const reveal = vi.fn(async (_id: string) => ({ ok: true as const, password: "Kp7m-Xr4d-Tq9w" }));
vi.mock("@/lib/actions/shop", () => ({
  revealOrderPasswordAction: (id: string) => reveal(id),
  resendOrderEmailAction: vi.fn(async () => ({ ok: true })),
  setShopEnabledAction: vi.fn(async () => ({ ok: true })),
  linkShopKeyAction: vi.fn(async () => ({ ok: true })),
}));
const { OrdersAdmin } = await import("@/components/shop/orders-admin");

afterEach(cleanup);

const NOW = new Date("2026-10-11T04:00:00Z"); // 12:00 in Manila
const row = (o: Partial<OrderRow>): OrderRow => ({
  id: crypto.randomUUID(), created_at: "2026-10-11T03:00:00Z", buyer_name: "Maria Santos", email: "maria@example.com", fb_name: null, product: "girl",
  amount: 5000, currency: "PHP", status: "pending", paid_at: null, downloads: 0, emailed_at: null, email_error: null, ...o,
});

describe("order status, totals and filter", () => {
  it("an unpaid order older than a day reads 'expired'", () => {
    expect(displayStatus(row({}), NOW)).toBe("pending");
    expect(displayStatus(row({ created_at: "2026-10-09T03:00:00Z" }), NOW)).toBe("expired");
    expect(displayStatus(row({ created_at: "2026-10-09T03:00:00Z", status: "paid" }), NOW)).toBe("paid");
  });

  it("revenue today and this month in Manila time, paid orders only", () => {
    const rows = [
      row({ status: "paid", paid_at: "2026-10-11T01:00:00Z", amount: 5000 }), // 09:00 today
      row({ status: "paid", paid_at: "2026-10-10T17:00:00Z", amount: 10000 }), // 01:00 today in Manila (still the 10th in UTC)
      row({ status: "paid", paid_at: "2026-10-10T15:00:00Z", amount: 5000 }), // 23:00 yesterday
      row({ status: "paid", paid_at: "2026-09-30T16:30:00Z", amount: 5000 }), // Oct 1 00:30 Manila
      row({ status: "paid", paid_at: "2026-09-30T15:00:00Z", amount: 5000 }), // Sept 30 23:00 Manila
      row({ status: "pending", amount: 10000 }),
    ];
    expect(revenueTotals(rows, NOW)).toEqual({ today: 15000, todayCount: 2, month: 25000, monthCount: 4 });
  });

  it("filters by displayed status", () => {
    const rows = [row({ status: "paid", paid_at: NOW.toISOString() }), row({}), row({ created_at: "2026-10-01T00:00:00Z" })];
    expect(filterOrders(rows, "all", NOW)).toHaveLength(3);
    expect(filterOrders(rows, "expired", NOW)).toHaveLength(1);
    expect(filterOrders(rows, "pending", NOW)).toHaveLength(1);
  });
});

describe("OrdersAdmin", () => {
  const setup = {
    packSells: true, keys: true, mode: "test" as const, webhookSecret: true, linked: false, email: false, enabled: true, unsorted: 12,
    shopUrl: "https://x.example/shop", webhookUrl: "https://x.example/api/paymongo/webhook",
  };
  it("lists orders, reveals a paid order's password on demand, and shows what setup is missing", async () => {
    const paid = row({ status: "paid", paid_at: NOW.toISOString(), downloads: 2, emailed_at: NOW.toISOString(), fb_name: "Maria S." });
    const pending = row({ buyer_name: "Jo Cruz", email: "jo@example.com" });
    render(<OrdersAdmin orders={[paid, pending]} setup={setup} money={{ [paid.id]: "₱50", [pending.id]: "₱50" }} now={NOW.toISOString()}
      totals={{ today: "₱50", todayCount: 1, month: "₱50", monthCount: 1 }} />);
    expect(screen.getByText("Maria Santos")).toBeTruthy();
    expect(screen.getByText(/2\/5 downloads · emailed/)).toBeTruthy();
    expect(screen.getByText(/FB: Maria S\./)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Link payments" })).toBeTruthy();
    expect(screen.getByText(/12 approved names have no meaning group yet/)).toBeTruthy();
    expect(screen.queryByText("Kp7m-Xr4d-Tq9w")).toBeNull();
    // only the paid order has a password / resend
    expect(screen.getAllByRole("button", { name: /Show the password/ })).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: /Show the password for Maria Santos/ }));
    expect(await screen.findByText("Kp7m-Xr4d-Tq9w")).toBeTruthy();
    expect(reveal).toHaveBeenCalledWith(paid.id);
    fireEvent.click(screen.getByRole("button", { name: "paid" }));
    expect(screen.queryByText("Jo Cruz")).toBeNull();
  });

  it("before migration 019: says how to start", () => {
    render(<OrdersAdmin orders={null} setup={{ ...setup, enabled: false }} money={{}} now={NOW.toISOString()} totals={{ today: "₱0", todayCount: 0, month: "₱0", monthCount: 0 }} />);
    expect(screen.getByText(/019_shop\.sql/)).toBeTruthy();
  });
});
