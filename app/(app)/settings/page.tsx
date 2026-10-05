import Link from "next/link";
import { ChevronRight, Palette } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import type { SettingsRow } from "@/lib/db/types";
import { SettingsForm } from "@/components/settings/settings-form";
import { WorkerCard } from "@/components/settings/worker-card";
import { PageHeader } from "@/components/ui/page-header";
import type { PreviewSample } from "@/components/settings/card-text";

/** The latest finished card's clean photo + text for the text preview (the built-in sample if none). */
async function previewSample(sb: Awaited<ReturnType<typeof createClient>>): Promise<PreviewSample | undefined> {
  const { data } = await sb.from("cards").select("photo_path, name, meaning").eq("status", "done").not("photo_path", "is", null)
    .order("finished_at", { ascending: false }).limit(1).maybeSingle();
  const card = data as { photo_path: string; name: string; meaning: string } | null;
  if (!card) return undefined;
  const { data: signed } = await sb.storage.from("cards").createSignedUrl(card.photo_path, 3600);
  return { photoUrl: signed?.signedUrl ?? null, name: card.name, meaning: card.meaning };
}

export default async function SettingsPage() {
  const sb = await createClient();
  const [{ data, error }, sample] = await Promise.all([
    sb.from("settings").select("*").eq("id", 1).single(),
    previewSample(sb).catch(() => undefined),
  ]);
  if (error || !data) throw new Error("Settings are missing. Run supabase/schema.sql.");
  return (
    <>
      <PageHeader title="Settings" />
      {/* Phones: Themes isn't on the bottom bar, so "More" (this page) leads to it. */}
      <nav aria-label="More pages" className="mb-4 md:hidden">
        <Link href="/themes" className="flex min-h-12 items-center gap-3 rounded-2xl border border-line bg-surface px-4 font-semibold text-ink shadow-soft transition active:scale-[.99]">
          <span className="grid size-8 place-items-center rounded-lg bg-accent-soft text-accent"><Palette className="size-4" aria-hidden /></span>
          Themes
          <ChevronRight className="ml-auto size-4 text-muted" aria-hidden />
        </Link>
      </nav>
      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <SettingsForm initial={data as SettingsRow} sample={sample} />
        <div className="lg:sticky lg:top-20 lg:self-start"><WorkerCard /></div>
      </div>
    </>
  );
}
