import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { cn } from "@/lib/utils/cn";
import { Skeleton } from "@/components/ui/skeleton";

// shadcn's `accent`/`muted` mean something else than ours (see app/globals.css). Generated files
// must use our classes instead; a fresh `npx shadcn add` would bring the shadcn ones back.
const DIR = join(process.cwd(), "components/ui/shadcn");
const BANNED: [RegExp, string][] = [
  [/\bbg-accent\b(?!-)/, "bg-accent (use bg-surface-2)"],
  [/accent-foreground/, "accent-foreground (use text-ink)"],
  [/\bbg-muted\b(?![-/])/, "bg-muted (use bg-surface-2)"],
  [/muted-foreground/, "muted-foreground (use text-muted)"],
];

describe("shadcn files use our token names", () => {
  const files = readdirSync(DIR).filter((f) => f.endsWith(".tsx"));
  it("finds the shadcn components", () => expect(files.length).toBeGreaterThan(10));
  it.each(files)("%s has no colliding shadcn colour classes", (f) => {
    const src = readFileSync(join(DIR, f), "utf8");
    const hits = BANNED.filter(([re]) => re.test(src)).map(([, why]) => why);
    expect(hits).toEqual([]);
  });
});

describe("cn knows our animations", () => {
  it("animate-shimmer replaces animate-pulse", () => {
    expect(cn("animate-pulse rounded-md", "animate-shimmer")).toBe("rounded-md animate-shimmer");
  });
  it("our Skeleton renders the shimmer, not shadcn's pulse", () => {
    const html = renderToStaticMarkup(createElement(Skeleton, { className: "h-4" }));
    expect(html).toContain("animate-shimmer");
    expect(html).not.toContain("animate-pulse");
  });
});
