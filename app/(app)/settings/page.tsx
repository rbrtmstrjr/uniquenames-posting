import { createClient } from "@/lib/supabase/server";
import type { SettingsRow } from "@/lib/db/types";
import { SettingsForm } from "@/components/settings/settings-form";
import { WorkerCard } from "@/components/settings/worker-card";
import { PageHeader } from "@/components/ui/page-header";

export default async function SettingsPage() {
  const { data, error } = await (await createClient()).from("settings").select("*").eq("id", 1).single();
  if (error || !data) throw new Error("Settings are missing. Run supabase/schema.sql.");
  return (
    <>
      <PageHeader title="Settings" />
      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <SettingsForm initial={data as SettingsRow} />
        <div className="lg:sticky lg:top-20 lg:self-start"><WorkerCard /></div>
      </div>
    </>
  );
}
