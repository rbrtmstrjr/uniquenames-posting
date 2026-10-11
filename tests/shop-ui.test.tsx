// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { packById } from "@/packs";
import { OrderForm, type ShopProductOption } from "@/components/shop/order-form";
import { ShopView } from "@/components/shop/shop-view";
import { GALLERY_COLUMNS, MIN_TILES, galleryColumns, galleryImages } from "@/components/shop/shop-gallery";
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
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
  it("test mode (owner only): a banner says only you can see it", () => {
    render(<ShopView {...base} open testMode />);
    expect(screen.getByText(/Test mode — only you can see this/)).toBeTruthy();
    cleanup();
    render(<ShopView {...base} open />);
    expect(screen.queryByText(/Test mode/)).toBeNull();
  });
  it("closed: 'Coming soon', no form", () => {
    render(<ShopView {...base} open={false} />);
    expect(screen.getByText("Coming soon")).toBeTruthy();
    expect(screen.queryByRole("radio")).toBeNull();
  });
});

describe("ShopView photo wall + phone order bar", () => {
  const gallery = galleryImages(UN.shop.gallery);
  const base = {
    brandName: "Unique Names", logo: null, copy: UN.shop.copy, inside: ["200 girl names and 150 boy names."], products: PRODUCTS,
    previews: UN.shop.previews, messenger: "https://m.me/example", cancelled: false, open: true, fromPrice: "₱50",
  };

  it("Unique Names ships 28 small WebP photos (each <= 40 KB) listed in its manifest; Name Nest has none", () => {
    expect(gallery).toHaveLength(28);
    for (const g of gallery) {
      expect(g.src).toMatch(/^\/packs\/unique-names\/shop-gallery\/baby-\d{2}\.webp$/);
      expect(statSync(join(process.cwd(), "public", g.src)).size).toBeLessThanOrEqual(40 * 1024);
    }
    expect(UN.shop.gallery?.alt).toBe("Baby photoshoot sample");
    expect(galleryImages(packById("name-nest").shop.gallery)).toEqual([]);
  });

  it("only plain public paths become image URLs", () => {
    const one = { src: "a.webp", width: 10, height: 10 };
    expect(galleryImages({ dir: "/x/y", alt: "", images: [one] })).toEqual([{ ...one, src: "/x/y/a.webp" }]);
    expect(galleryImages({ dir: "https://evil.example", alt: "", images: [one] })).toEqual([]);
    expect(galleryImages({ dir: "/x/../y", alt: "", images: [one] })).toEqual([]);
    expect(galleryImages({ dir: "/x", alt: "", images: [{ ...one, src: "../a.webp" }, { ...one, src: "a.svg" }, { ...one, width: 0 }] })).toEqual([]);
    expect(galleryImages(null)).toEqual([]);
  });

  it("columns: round robin, each at least MIN_TILES long (one set taller than a phone screen)", () => {
    const cols = galleryColumns(Array.from({ length: 28 }, (_, i) => i));
    expect(cols).toHaveLength(GALLERY_COLUMNS);
    expect(cols[0].slice(0, 3)).toEqual([0, 5, 10]);
    for (const c of cols) expect(c.length).toBeGreaterThanOrEqual(MIN_TILES);
    expect(galleryColumns([7], 3, 4)).toEqual([[7, 7, 7, 7], [7, 7, 7, 7], [7, 7, 7, 7]]);
    expect(galleryColumns([])).toEqual([]);
  });

  it("the wall is decorative: hidden from screen readers, empty alts, lazy + low priority, each column's set twice", () => {
    render(<ShopView {...base} gallery={gallery} />);
    const wall = screen.getByTestId("shop-gallery");
    expect(wall.getAttribute("aria-hidden")).toBe("true");
    const imgs = wall.querySelectorAll("img");
    expect(imgs.length).toBe(GALLERY_COLUMNS * MIN_TILES * 2);
    for (const img of imgs) {
      expect(img.getAttribute("alt")).toBe("");
      expect(img.getAttribute("loading")).toBe("lazy");
      expect(img.getAttribute("fetchpriority")).toBe("low");
    }
    const strips = wall.querySelectorAll(".shop-drift");
    expect(strips[0].className).toContain("shop-drift-up");
    expect(strips[1].className).toContain("shop-drift-down");
    // nothing on the wall is reachable by the screen reader's image list; the hero cover still is
    expect(screen.getAllByRole("img").map((i) => i.getAttribute("alt"))).toEqual(["A sample page of names with their meanings", `The cover of ${UN.shop.copy.eyebrow}`]);
    expect(screen.getByAltText(/cover/).getAttribute("fetchpriority")).toBe("high");
  });

  it("no photos: no wall (plain background)", () => {
    render(<ShopView {...base} gallery={[]} />);
    expect(screen.queryByTestId("shop-gallery")).toBeNull();
  });

  it("reduced motion stops the drift, the fade-in and the entrance (globals.css)", () => {
    const css = readFileSync(join(process.cwd(), "app", "globals.css"), "utf8");
    const reduced = [...css.matchAll(/@media \(prefers-reduced-motion: reduce\)\s*\{([\s\S]*?)\r?\n\}/g)].map((m) => m[1]).join("\n");
    for (const cls of [".shop-drift", ".shop-gallery", ".shop-rise"]) expect(reduced).toContain(cls);
    expect(reduced).toMatch(/animation: none !important/);
  });

  it("open: a hero order button with the lowest price, and the phone bar (hidden until the hero button scrolls away)", () => {
    render(<ShopView {...base} />);
    const hero = document.getElementById("hero-cta")!;
    expect(hero.getAttribute("href")).toBe("#order");
    expect(screen.getByText("from ₱50")).toBeTruthy();
    const bar = screen.getByTestId("sticky-order-bar");
    expect(bar.getAttribute("aria-hidden")).toBe("true"); // jsdom has no IntersectionObserver: it stays hidden
    expect(bar.querySelector("a")!.getAttribute("href")).toBe("#order");
    expect(document.getElementById("order")).not.toBeNull();
    cleanup();
    render(<ShopView {...base} open={false} />);
    expect(screen.queryByTestId("sticky-order-bar")).toBeNull();
    expect(document.getElementById("hero-cta")).toBeNull();
  });
});

describe("ShopView Facebook page (avatar with the blue ring + verified badge)", () => {
  const base = {
    brandName: "Unique Names", logo: "/packs/unique-names/logo.svg", copy: UN.shop.copy, inside: ["x"], products: PRODUCTS,
    previews: null, messenger: null, cancelled: false, open: true,
  };

  it("Unique Names: avatar, verified, 136K followers and the tagline in its pack; Name Nest has none", () => {
    expect(UN.shop.facebookPage).toEqual({ avatar: "/packs/unique-names/avatar.webp", verified: true, followers: "136K", tagline: "Every name is a blessing ✨" });
    expect(statSync(join(process.cwd(), "public", UN.shop.facebookPage!.avatar)).size).toBeGreaterThan(0);
    expect(packById("name-nest").shop.facebookPage).toBeNull();
  });

  it("the hero shows the page like Facebook: photo, ring (decorative), labelled verified badge, name, followers, tagline", () => {
    render(<ShopView {...base} facebookPage={UN.shop.facebookPage} />);
    const hero = screen.getByRole("region", { name: UN.shop.copy.title });
    const photo = within(hero).getByAltText("Unique Names Facebook page");
    expect(photo.getAttribute("src")).toBe("/packs/unique-names/avatar.webp");
    const avatar = photo.closest("[data-fb-avatar]")!;
    expect(avatar.querySelector("[data-fb-ring]")!.getAttribute("aria-hidden")).toBe("true");
    expect(within(hero).getByRole("img", { name: "Verified Facebook page" })).toBeTruthy();
    expect(within(hero).getByText("Unique Names")).toBeTruthy();
    expect(within(hero).getByText(/136K followers/)).toBeTruthy();
    expect(within(hero).getByText(/Verified page/)).toBeTruthy();
    expect(within(hero).getByText("Every name is a blessing ✨")).toBeTruthy();
    // the header shows the small photo (decorative next to the page name) instead of the generic logo
    const header = document.querySelector("header")!;
    expect(header.querySelector("img")!.getAttribute("src")).toBe("/packs/unique-names/avatar.webp");
    expect(header.querySelector("img")!.getAttribute("alt")).toBe("");
  });

  it("not verified: no badge and no 'Verified page'; no page: no avatar, the logo in the header", () => {
    render(<ShopView {...base} facebookPage={{ ...UN.shop.facebookPage!, verified: false, followers: null, tagline: null }} />);
    expect(screen.queryByRole("img", { name: "Verified Facebook page" })).toBeNull();
    expect(screen.queryByText(/Verified page/)).toBeNull();
    expect(screen.queryByText(/followers/)).toBeNull();
    cleanup();
    render(<ShopView {...base} facebookPage={null} />);
    expect(screen.queryByAltText("Unique Names Facebook page")).toBeNull();
    expect(document.querySelector("header img")!.getAttribute("src")).toBe("/packs/unique-names/logo.svg");
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
