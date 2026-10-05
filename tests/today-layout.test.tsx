// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { postSummary, postsLeft, stockLevel } from "@/lib/today/summary";

vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }));
const { Stock } = await import("@/components/today/stock");
const { TodaySelectionProvider, useTodaySelection } = await import("@/components/today/selection");

afterEach(cleanup);

describe("postSummary (Today footer line)", () => {
  const base = { count: "10", min: 6, max: 15, gender: "boy", style: "two-word", age: "random", themeTitle: "Modern Realism" } as const;
  it("spells out a fixed count, gender, style, ages and theme", () => {
    expect(postSummary(base)).toBe("10 cards · Boy · Two-word · Random ages · Modern Realism");
  });
  it("Auto shows the card range", () => {
    expect(postSummary({ ...base, count: "auto" })).toBe("6–15 cards · Boy · Two-word · Random ages · Modern Realism");
  });
  it("names a fixed age and drops a missing theme", () => {
    expect(postSummary({ ...base, gender: "girl", style: "single", age: "newborn", themeTitle: undefined })).toBe("10 cards · Girl · Single · Newborn");
    expect(postSummary({ ...base, age: "1" })).toContain("· 1 year old ·");
    expect(postSummary({ ...base, age: "5" })).toContain("· 5 years old ·");
  });
});

describe("stockLevel (low-stock thresholds)", () => {
  it("zero is out, under 15 is low, 15 and up is ok", () => {
    expect(stockLevel(0, 13)).toBe("out");
    expect(stockLevel(14, 13)).toBe("low");
    expect(stockLevel(15, 13)).toBe("ok");
  });
  it("is low below the max card count when that is above 15", () => {
    expect(stockLevel(19, 20)).toBe("low");
    expect(stockLevel(20, 20)).toBe("ok");
  });
});

const stock = [
  { gender: "boy" as const, style: "two-word" as const, count: 40 },
  { gender: "boy" as const, style: "single" as const, count: 9 },
  { gender: "girl" as const, style: "two-word" as const, count: 44 },
  { gender: "girl" as const, style: "single" as const, count: 0 },
];

function Picker() {
  const [, setSel] = useTodaySelection();
  return <button onClick={() => setSel({ gender: "girl", style: "two-word" })}>pick girl two-word</button>;
}

describe("postsLeft (about how many posts a stock covers)", () => {
  it("divides by the average Auto post size", () => {
    expect(postsLeft(40, 6, 15)).toBe(3); // average 11 cards
    expect(postsLeft(10, 6, 15)).toBe(0);
    expect(postsLeft(0, 6, 15)).toBe(0);
    expect(postsLeft(30, 10, 10)).toBe(3);
  });
});

const tile = (label: string) => screen.getByRole("listitem", { name: new RegExp(`^${label}`) });

describe("Stock card", () => {
  it("shows one tile per gender + style with the count and about how many posts it covers", () => {
    render(<Stock stock={stock} themes={{ boy: 27, girl: 2 }} min={6} max={13} />);
    const names = within(screen.getByRole("list", { name: "Names left" })).getAllByRole("listitem");
    expect(names.map((t) => t.getAttribute("aria-label"))).toEqual([
      "Boy two-word: 40 names left", "Boy single: 9 names left", "Girl two-word: 44 names left", "Girl single: 0 names left"]);
    expect(tile("Boy two-word").textContent).toContain("40");
    expect(tile("Boy two-word").textContent).toContain("≈ 4 posts"); // average of 6–13 is 10
    expect(tile("Girl single").textContent).toContain("None left");
  });

  it("marks low tiles warn and empty tiles bad", () => {
    render(<Stock stock={stock} themes={{ boy: 27, girl: 2 }} min={6} max={13} />);
    expect(tile("Boy two-word").getAttribute("data-level")).toBe("ok");
    expect(tile("Boy single").getAttribute("data-level")).toBe("low");
    expect(tile("Boy single").textContent).toContain("Low");
    expect(tile("Boy single").querySelector(".text-warn-text")).toBeTruthy();
    expect(tile("Girl single").getAttribute("data-level")).toBe("out");
    expect(tile("Girl single").querySelector(".text-bad")).toBeTruthy();
  });

  it("highlights the tile for the gender + style picked in New post", () => {
    render(
      <TodaySelectionProvider>
        <Picker />
        <Stock stock={stock} themes={{ boy: 27, girl: 2 }} min={6} max={13} />
      </TodaySelectionProvider>,
    );
    const selected = () => screen.getAllByRole("listitem").filter((c) => c.getAttribute("aria-current") === "true").map((c) => c.getAttribute("aria-label"));
    expect(selected()).toEqual(["Boy two-word: 40 names left"]); // boy · two-word by default
    fireEvent.click(screen.getByRole("button", { name: "pick girl two-word" }));
    expect(selected()).toEqual(["Girl two-word: 44 names left"]);
  });

  it("shows themes left per gender (low warns) and links to manage names and themes", () => {
    render(<Stock stock={stock} themes={{ boy: 27, girl: 2 }} min={6} max={13} />);
    const themes = within(screen.getByRole("list", { name: "Themes left" })).getAllByRole("listitem");
    expect(themes.map((t) => t.getAttribute("aria-label"))).toEqual(["Boy: 27 themes left", "Girl: 2 themes left"]);
    expect(themes[0].textContent).toContain("27 posts");
    expect([...themes[1].querySelectorAll(".text-warn-text")].map((e) => e.textContent)).toEqual(["Low", "2"]);
    expect(screen.getByRole("link", { name: "Manage names" }).getAttribute("href")).toBe("/names");
    expect(screen.getByRole("link", { name: "Manage themes" }).getAttribute("href")).toBe("/themes");
  });
});
