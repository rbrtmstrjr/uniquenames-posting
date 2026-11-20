import { getAutopilotData } from "@/lib/data/autopilot";
import { PageHeader } from "@/components/ui/page-header";
import { AutopilotPanel } from "@/components/autopilot/autopilot-panel";
import { NameThemesEditor } from "@/components/autopilot/name-themes-editor";

export const dynamic = "force-dynamic";

export default async function AutopilotPage() {
  const d = await getAutopilotData();
  return (
    <>
      <PageHeader title="Autopilot" subtitle="Makes, checks and schedules the next days of posts while you're busy." />
      {d.needs022 ? (
        <p className="rounded-xl border border-warn/40 bg-warn/10 p-3 text-sm text-warn-text">
          Autopilot needs a database update first: run supabase/migrations/022_autopilot.sql in Supabase, then reload.
        </p>
      ) : (
        <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_380px]">
          <AutopilotPanel run={d.run} items={d.items} stats={d.stats} />
          <NameThemesEditor text={d.nameThemes} />
        </div>
      )}
    </>
  );
}
