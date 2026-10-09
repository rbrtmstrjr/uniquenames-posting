import { describe, expect, it, vi } from "vitest";
import { REEL_THEME_IDS } from "@/lib/db/types";
import { fakeSupabase, type Query } from "./helpers/fake-supabase";

let rows: Record<string, unknown>[] = [];
let reelThemeId: string | undefined = "crayon";
const fake = fakeSupabase((q: Query) => {
  if (q.table === "reel_themes") return { data: rows };
  if (q.table === "settings") return { data: { id: 1, ...(reelThemeId === undefined ? {} : { reel_theme_id: reelThemeId }) } };
  return undefined;
});
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => fake.client }));
const { getReelThemes, getThemeChoice } = await import("@/lib/data/reel-themes");

const row = (id: string, sort: number, active?: boolean) => ({ id, sort, ...(active === undefined ? {} : { active }) });

describe("the theme pickers' data (Settings + the review page)", () => {
  it("after 012: only the active styles, in order (the 8 old themes are hidden)", async () => {
    rows = REEL_THEME_IDS.map((id, i) => row(id, id === "crayon" ? 9 : id === "redthread" ? 10 : i, id === "crayon" || id === "redthread"));
    expect((await getReelThemes())!.map((t) => t.id)).toEqual(["crayon", "redthread"]);
    expect(await getThemeChoice()).toMatchObject({ defaultId: "crayon", themes: [{ id: "crayon" }, { id: "redthread" }] });
  });

  it("before 012 (no active column): every theme, as before", async () => {
    rows = [row("clay", 4), row("knitted", 1)];
    reelThemeId = "clay";
    expect((await getReelThemes())!.map((t) => t.id)).toEqual(["knitted", "clay"]);
    expect((await getThemeChoice())!.defaultId).toBe("clay");
  });
});
