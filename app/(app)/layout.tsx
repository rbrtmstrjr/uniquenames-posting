import { redirect } from "next/navigation";
import { AppShell } from "@/components/shell/app-shell";
import { createClient, getOwner } from "@/lib/supabase/server";
import type { SettingsRow, WorkerStatusRow } from "@/lib/db/types";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  if (!(await getOwner())) redirect("/login");
  const sb = await createClient();
  const [{ data: worker }, { data: settings }] = await Promise.all([
    sb.from("worker_status").select("*").eq("id", 1).maybeSingle(),
    sb.from("settings").select("sound_on").eq("id", 1).maybeSingle(),
  ]);
  return (
    <AppShell initialWorker={(worker as WorkerStatusRow) ?? null} soundOn={(settings as Pick<SettingsRow, "sound_on">)?.sound_on ?? true}>
      {children}
    </AppShell>
  );
}
