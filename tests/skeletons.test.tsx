// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { NamesSkeleton, PostDetailSkeleton, PostsSkeleton, SettingsSkeleton, ThemesSkeleton, TodaySkeleton } from "@/components/skeletons/page-skeletons";
import TodayLoading from "@/app/(app)/loading";
import PostsLoading from "@/app/(app)/posts/loading";
import PostLoading from "@/app/(app)/posts/[id]/loading";
import NamesLoading from "@/app/(app)/names/loading";
import ThemesLoading from "@/app/(app)/themes/loading";
import SettingsLoading from "@/app/(app)/settings/loading";

afterEach(cleanup);

const tiles = (c: HTMLElement) => c.querySelectorAll(".aspect-square").length;

describe("route skeletons", () => {
  it.each([
    ["Today", TodaySkeleton, TodayLoading],
    ["Posts", PostsSkeleton, PostsLoading],
    ["post", PostDetailSkeleton, PostLoading],
    ["Names", NamesSkeleton, NamesLoading],
    ["Themes", ThemesSkeleton, ThemesLoading],
    ["Settings", SettingsSkeleton, SettingsLoading],
  ])("%s: loading.tsx renders a busy, labelled skeleton", (label, Skel, Loading) => {
    const a = render(<Loading />);
    const status = screen.getByRole("status");
    expect(status.getAttribute("aria-busy")).toBe("true");
    expect(status.getAttribute("aria-label")).toBe(`Loading ${label}`);
    const html = a.container.innerHTML;
    a.unmount();
    // loading.tsx is exactly the shared skeleton
    expect(render(<Skel />).container.innerHTML).toBe(html);
  });

  it("mirrors the real layouts: Today card grid, 6 post rows of 6 thumbs, post card grid", () => {
    expect(tiles(render(<TodaySkeleton />).container)).toBe(10);
    cleanup();
    const posts = render(<PostsSkeleton />).container;
    expect(posts.querySelectorAll("li").length).toBe(6);
    expect(tiles(posts)).toBe(36);
    cleanup();
    expect(tiles(render(<PostDetailSkeleton />).container)).toBe(8);
  });

  it("only uses shimmer blocks that are hidden from screen readers", () => {
    const { container } = render(<NamesSkeleton />);
    const blocks = container.querySelectorAll(".shimmer");
    expect(blocks.length).toBeGreaterThan(10);
    blocks.forEach((b) => expect(b.getAttribute("aria-hidden")).toBe("true"));
  });
});
