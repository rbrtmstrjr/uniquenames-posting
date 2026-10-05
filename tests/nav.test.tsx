// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

let pathname = "/posts";
vi.mock("next/navigation", () => ({ usePathname: () => pathname }));
vi.mock("next/link", () => ({
  default: ({ href, children, onClick, ...rest }: { href: string; children: React.ReactNode; onClick?: (e: React.MouseEvent) => void }) =>
    <a href={href} onClick={(e) => { e.preventDefault(); onClick?.(e); }} {...rest}>{children}</a>,
}));
const { BottomTabs, SideNav } = await import("@/components/shell/nav");

afterEach(() => { cleanup(); pathname = "/posts"; });

const current = () => screen.getAllByRole("link").filter((a) => a.getAttribute("aria-current") === "page").map((a) => a.textContent?.trim());

describe("nav instant feedback", () => {
  it("lights up the tapped tab before the new page arrives, then follows the real path", () => {
    const { rerender } = render(<SideNav />);
    expect(current()).toEqual(["Posts"]);
    fireEvent.click(screen.getByRole("link", { name: /Names/ }));
    expect(current()).toEqual(["Names"]);
    pathname = "/names";
    rerender(<SideNav />);
    expect(current()).toEqual(["Names"]);
  });

  it("ignores ctrl/cmd clicks (they open a new tab)", () => {
    render(<SideNav />);
    fireEvent.click(screen.getByRole("link", { name: /Themes/ }), { ctrlKey: true });
    expect(current()).toEqual(["Posts"]);
  });

  it("sidebar lists every page incl. Reels; the phone bar keeps 5 tabs with Reels, Themes under More", () => {
    render(<SideNav />);
    expect(screen.getAllByRole("link").map((a) => a.textContent?.trim())).toEqual(["Today", "Posts", "Reels", "Names", "Themes", "Settings"]);
    cleanup();
    pathname = "/themes";
    render(<BottomTabs />);
    expect(screen.getAllByRole("link").map((a) => a.textContent?.trim())).toEqual(["Today", "Posts", "Reels", "Names", "More"]);
    expect(current()).toEqual(["More"]);
  });
});
