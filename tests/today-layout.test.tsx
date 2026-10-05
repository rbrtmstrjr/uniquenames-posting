// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { postSummary, stockLevel } from "@/lib/today/summary";

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

describe("Stock card", () => {
  it("is a Boy | Girl × Two-word | Single table with the counts", () => {
    render(<Stock stock={stock} themes={{ boy: 27, girl: 2 }} max={13} />);
    const table = screen.getByRole("table");
    expect(within(table).getAllByRole("columnheader").map((c) => c.textContent)).toEqual(["", "Boy", "Girl"]);
    expect(within(table).getAllByRole("rowheader").map((c) => c.textContent)).toEqual(["Two-word", "Single"]);
    expect(within(table).getAllByRole("cell").map((c) => c.textContent)).toEqual(["40", "44", "9Low", "0Out"]);
  });

  it("marks low cells warn and empty cells bad", () => {
    render(<Stock stock={stock} themes={{ boy: 27, girl: 2 }} max={13} />);
    const cells = screen.getAllByRole("cell");
    expect(cells[0].getAttribute("data-level")).toBe("ok");
    expect(cells[2].getAttribute("data-level")).toBe("low");
    expect(cells[2].querySelector(".text-warn-text")).toBeTruthy();
    expect(cells[3].getAttribute("data-level")).toBe("out");
    expect(cells[3].querySelector(".text-bad")).toBeTruthy();
  });

  it("highlights the cell for the gender + style picked in New post", () => {
    render(
      <TodaySelectionProvider>
        <Picker />
        <Stock stock={stock} themes={{ boy: 27, girl: 2 }} max={13} />
      </TodaySelectionProvider>,
    );
    const selected = () => screen.getAllByRole("cell").filter((c) => c.getAttribute("aria-current") === "true");
    expect(selected().map((c) => c.textContent)).toEqual(["40"]); // boy · two-word by default
    fireEvent.click(screen.getByRole("button", { name: "pick girl two-word" }));
    expect(selected().map((c) => c.textContent)).toEqual(["44"]);
  });

  it("shows themes left per gender (low warns) and links to manage names and themes", () => {
    render(<Stock stock={stock} themes={{ boy: 27, girl: 2 }} max={13} />);
    const boy = within(screen.getByText("Themes left").parentElement!).getByText("Boy").closest("div")!;
    expect(boy.textContent).toContain("27");
    const girl = within(screen.getByText("Themes left").parentElement!).getByText("Girl").closest("div")!;
    expect(girl.querySelector(".text-warn-text")?.textContent).toBe("2");
    expect(screen.getByRole("link", { name: "Manage names" }).getAttribute("href")).toBe("/names");
    expect(screen.getByRole("link", { name: "Manage themes" }).getAttribute("href")).toBe("/themes");
  });
});
