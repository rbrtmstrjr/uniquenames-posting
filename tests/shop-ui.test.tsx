// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { packById } from "@/packs";
import { OrderForm, type ShopProductOption } from "@/components/shop/order-form";
import { ShopView } from "@/components/shop/shop-view";
import { ThanksStatus, type ThanksView, POLL_MS, CHECK_EVERY } from "@/components/shop/thanks-status";

const UN = packById("unique-names");
const PRODUCTS: ShopProductOption[] = [
  { id: "girl", name: "Girl Names Edition", price: "₱50", blurb: "Girls.", count: 200 },
  { id: "boy", name: "Boy Names Edition", price: "₱50", blurb: "Boys.", count: 150 },
  { id: "both", name: "Girl & Boy Bundle", price: "₱100", blurb: "Both.", badge: "Both lists", count: 350 },
];
const TOKEN = "a".repeat(96);

afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("OrderForm", () => {
  let assign: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    assign = vi.fn();
    Object.defineProperty(window, "location", { value: { ...window.location, assign }, writable: true, configurable: true });
  });

  it("shows the editions with prices; Both is picked first; sends a product id (never a price) and goes to PayMongo", async () => {
    const fetchMock = vi.fn(async () => Response.json({ url: "https://checkout.paymongo.com/cs_test_1" }));
    vi.stubGlobal("fetch", fetchMock);
    render(<OrderForm products={PRODUCTS} heading="Get your copy" payButton="Continue to payment" />);
    expect((screen.getByRole("radio", { name: /Girl & Boy Bundle/ }) as HTMLInputElement).checked).toBe(true);
    expect(screen.getByRole("button", { name: /Continue to payment · ₱100/ })).toBeTruthy();
    fireEvent.click(screen.getByRole("radio", { name: /Girl Names Edition/ }));
    expect(screen.getByRole("button", { name: /₱50/ })).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Your name"), { target: { value: "Maria Santos" } });
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "maria@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: /Continue to payment/ }));
    await waitFor(() => expect(assign).toHaveBeenCalledWith("https://checkout.paymongo.com/cs_test_1"));
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/shop/checkout");
    expect(JSON.parse(String(init.body))).toEqual({ product: "girl", buyerName: "Maria Santos", email: "maria@example.com", fbName: "", website: "" });
  });

  it("shows the server's error and marks the field", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ error: "Type a valid email. We send your PDF there.", field: "email" }, { status: 400 })));
    render(<OrderForm products={PRODUCTS} heading="Get your copy" payButton="Continue to payment" />);
    fireEvent.click(screen.getByRole("button", { name: /Continue to payment/ }));
    expect(await screen.findByText("Type a valid email. We send your PDF there.")).toBeTruthy();
    expect(screen.getByLabelText("Email").getAttribute("aria-invalid")).toBe("true");
    expect(assign).not.toHaveBeenCalled();
  });

  it("never follows a non-https answer", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ url: "javascript:alert(1)" })));
    render(<OrderForm products={PRODUCTS} heading="Get your copy" payButton="Continue to payment" />);
    fireEvent.click(screen.getByRole("button", { name: /Continue to payment/ }));
    expect(await screen.findByText(/Something went wrong/)).toBeTruthy();
    expect(assign).not.toHaveBeenCalled();
  });

  it("the honeypot is hidden from people and screen readers", () => {
    render(<OrderForm products={PRODUCTS} heading="Get your copy" payButton="Pay" />);
    const hp = document.getElementById("website")!;
    expect(hp.closest("[aria-hidden='true']")).not.toBeNull();
    expect(hp.getAttribute("tabindex")).toBe("-1");
  });
});

describe("ShopView", () => {
  const base = {
    brandName: "Unique Names", logo: null, copy: UN.shop.copy, inside: ["200 girl names and 150 boy names."], products: PRODUCTS,
    previews: UN.shop.previews, messenger: "https://m.me/example", cancelled: false,
  };
  it("open: the form, what's inside, trust notes, FAQ about GCash QR Ph, and the help link", () => {
    render(<ShopView {...base} open />);
    expect(screen.getByRole("heading", { level: 1, name: UN.shop.copy.title })).toBeTruthy();
    expect(screen.getByText("200 girl names and 150 boy names.")).toBeTruthy();
    expect(screen.getByText("Secure payment by PayMongo")).toBeTruthy();
    expect(screen.getByText("How do I pay with GCash?")).toBeTruthy();
    expect(screen.getByText(/Upload QR/)).toBeTruthy();
    expect(screen.getByRole("radio", { name: /Girl Names Edition/ })).toBeTruthy();
    expect(screen.getByRole("link", { name: /Message us on Facebook/ }).getAttribute("href")).toBe("https://m.me/example");
    expect(screen.getByAltText(/cover/).getAttribute("src")).toBe("/packs/unique-names/shop/cover.webp");
  });
  it("closed: 'Coming soon', no form", () => {
    render(<ShopView {...base} open={false} />);
    expect(screen.getByText("Coming soon")).toBeTruthy();
    expect(screen.queryByRole("radio")).toBeNull();
  });
});

describe("ThanksStatus", () => {
  const pending: ThanksView = { status: "pending", productName: "Girl Names Edition", password: null, email: "ma•••@example.com", emailed: false, downloads: 0, maxDownloads: 5, expiresAt: null };
  const paid: ThanksView = { ...pending, status: "paid", password: "Kp7m-Xr4d-Tq9w", emailed: true, expiresAt: "2026-10-18T00:00:00Z" };
  const props = { token: TOKEN, copy: UN.shop.copy.thanks, messenger: "https://m.me/example", supportLine: "Need help?" };

  it("waits (no password, no download) until the server says paid; every 5th poll asks PayMongo", async () => {
    vi.useFakeTimers();
    const urls: string[] = [];
    let answer = pending;
    vi.stubGlobal("fetch", vi.fn(async (u: string) => { urls.push(u); return Response.json(answer); }));
    render(<ThanksStatus {...props} initial={pending} />);
    expect(screen.getByText(UN.shop.copy.thanks.waitingTitle)).toBeTruthy();
    expect(screen.queryByTestId("pdf-password")).toBeNull();
    for (let i = 0; i < CHECK_EVERY; i++) await act(async () => { await vi.advanceTimersByTimeAsync(POLL_MS); });
    expect(urls.slice(0, CHECK_EVERY)).toEqual([...Array(CHECK_EVERY - 1).fill(`/api/shop/status?o=${TOKEN}`), `/api/shop/status?o=${TOKEN}&check=1`]);
    answer = paid;
    await act(async () => { await vi.advanceTimersByTimeAsync(POLL_MS); });
    expect(screen.getByTestId("pdf-password").textContent).toContain("Kp7m-Xr4d-Tq9w");
    const n = urls.length;
    await act(async () => { await vi.advanceTimersByTimeAsync(POLL_MS * 3); });
    expect(urls.length).toBe(n); // stops polling once paid
  });

  it("paid: password with Copy, a POST download form to /shop/download/<token>, the emailed note", () => {
    render(<ThanksStatus {...props} initial={paid} />);
    expect(screen.getByRole("heading", { name: UN.shop.copy.thanks.paidTitle })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Copy password/ })).toBeTruthy();
    const form = screen.getByRole("button", { name: /Download PDF/ }).closest("form")!;
    expect(form.getAttribute("method")).toBe("post");
    expect(form.getAttribute("action")).toBe(`/shop/download/${TOKEN}`);
    expect(screen.getByText(/We also sent the link and the password to ma•••@example.com/)).toBeTruthy();
  });

  it("no downloads left, or an expired order: no button", () => {
    render(<ThanksStatus {...props} initial={{ ...paid, downloads: 5 }} />);
    expect(screen.queryByRole("button", { name: /Download PDF/ })).toBeNull();
    cleanup();
    render(<ThanksStatus {...props} initial={{ ...pending, status: "expired" }} />);
    expect(screen.getByText(UN.shop.copy.thanks.expiredTitle)).toBeTruthy();
    expect(screen.queryByTestId("pdf-password")).toBeNull();
  });
});
