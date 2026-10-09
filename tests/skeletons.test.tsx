// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { NamesSkeleton, NewReelSkeleton, PostDetailSkeleton, PostsSkeleton, ReelDetailSkeleton, ReelsSkeleton, SettingsSkeleton, ThemesSkeleton, TodaySkeleton } from "@/components/skeletons/page-skeletons";
import TodayLoading from "@/app/(app)/loading";
import PostsLoading from "@/app/(app)/posts/loading";
import PostLoading from "@/app/(app)/posts/[id]/loading";
import NamesLoading from "@/app/(app)/names/loading";
import ThemesLoading from "@/app/(app)/themes/loading";
import SettingsLoading from "@/app/(app)/settings/loading";
import ReelsLoading from "@/app/(app)/reels/loading";
import NewReelLoading from "@/app/(app)/reels/new/loading";
import ReelLoading from "@/app/(app)/reels/[id]/loading";

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
    ["Reels", ReelsSkeleton, ReelsLoading],
    ["New reel", NewReelSkeleton, NewReelLoading],
    ["reel", ReelDetailSkeleton, ReelLoading],
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

  it("mirrors the real layouts: Today card grid (3 × 3 in the right column), 6 post rows of 6 thumbs, post card grid", () => {
    expect(tiles(render(<TodaySkeleton />).container)).toBe(9);
    cleanup();
    const posts = render(<PostsSkeleton />).container;
    expect(posts.querySelectorAll("li").length).toBe(6);
    expect(tiles(posts)).toBe(36);
    cleanup();
    expect(tiles(render(<PostDetailSkeleton />).container)).toBe(8);
  });

  it("reels: 6 list cards with a 9:16 thumb each, a reel page with 10 9:16 image tiles", () => {
    const reels = render(<ReelsSkeleton />).container;
    expect(reels.querySelectorAll("li").length).toBe(6);
    expect(reels.querySelectorAll('[class*="aspect-[9/16]"]').length).toBe(6);
    cleanup();
    expect(render(<ReelDetailSkeleton />).container.querySelectorAll('[class*="aspect-[9/16]"]').length).toBe(10);
  });

  it("only uses shimmer blocks that are hidden from screen readers", () => {
    const { container } = render(<NamesSkeleton />);
    const blocks = container.querySelectorAll(".shimmer");
    expect(blocks.length).toBeGreaterThan(10);
    blocks.forEach((b) => expect(b.getAttribute("aria-hidden")).toBe("true"));
  });
});
