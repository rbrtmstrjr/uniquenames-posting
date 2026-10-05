// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import type { ThemeRow } from "@/lib/db/types";
import { polyfillRadix } from "./helpers/radix-jsdom";

vi.mock("@/components/shell/app-shell", () => ({ useWorkerContext: () => ({ health: "ready", lastSeen: "now", row: null }) }));
vi.mock("@/lib/realtime/use-table", () => ({ useRealtimeRows: (_t: string, initial: unknown[]) => [initial] }));
vi.mock("@/lib/realtime/signed-urls", () => ({ useSignedUrls: () => () => undefined }));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({}) }));
vi.mock("@/lib/actions/themes", () => ({
  makePreviewAction: vi.fn(), moveThemeNextAction: vi.fn(), reorderThemesAction: vi.fn(), setArchivedAction: vi.fn(), saveThemeAction: vi.fn(), approveThemesAction: vi.fn(), rejectThemesAction: vi.fn(),
}));
vi.mock("@/lib/actions/call", () => ({ callAction: vi.fn(async () => ({ ok: true })), optimistic: vi.fn(async () => ({ ok: true })) }));
vi.mock("@/lib/actions/suggest", () => ({ suggestThemesAction: vi.fn() }));
const { ThemeList } = await import("@/components/themes/theme-list");

beforeAll(polyfillRadix);
afterEach(cleanup);

const now = "2026-10-05T00:00:00Z";
const theme = (title: string, status: ThemeRow["status"], sort_order = 1): ThemeRow => ({
  id: title, title, gender: "boy", backdrop: "cream backdrop", outfit: "knit romper", props: "basket", lighting: "soft", palette: "cream",
  status, sort_order, used_on: null, preview_card_id: null, created_at: now, updated_at: now,
});

describe("Themes page: pending suggestions", () => {
  it("keeps pending themes out of Up next and lists them under Pending", () => {
    render(<ThemeList themes={[theme("Suggested Sky", "pending", 0), theme("Boho", "available", 1)]} previews={[]} />);
    const upNext = screen.getByRole("heading", { name: /Up next · 1 left/ }).parentElement!;
    expect(within(upNext).getByText("Boho")).toBeTruthy();
    expect(within(upNext).queryByText("Suggested Sky")).toBeNull();
    const pending = screen.getByRole("region", { name: /Pending approval · 1/ });
    expect(within(pending).getByText("Suggested Sky")).toBeTruthy();
  });
  it("shows no Pending section while nothing is pending", () => {
    render(<ThemeList themes={[theme("Boho", "available")]} previews={[]} />);
    expect(screen.queryByRole("region", { name: /Pending/ })).toBeNull();
  });
});
