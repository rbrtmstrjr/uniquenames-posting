"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { facebookConfig } from "@/lib/facebook/graph";
import { MAX_DAYS } from "@/lib/autopilot/plan";
import { nameThemesProblem } from "@/lib/autopilot/name-themes";
import { AUTOPILOT_SECRET_MIN } from "@/lib/autopilot/key";
import { NEEDS_022, preparePlan, type RunPreview } from "@/lib/autopilot/prepare";
import { UUID_RE } from "./helpers";
import { fail, requireOwner, type ActionResult } from "./result";

export type { RunPreview } from "@/lib/autopilot/prepare";

const badDays = (days: number) => !Number.isInteger(days) || days < 1 || days > MAX_DAYS;
const DAYS = `Pick 1 to ${MAX_DAYS} days.`;

/** What a run would make (no writes). */
export async function previewAutopilotAction(days: number): Promise<ActionResult<{ preview: RunPreview }>> {
  await requireOwner();
  if (badDays(days)) return fail(DAYS);
  const plan = await preparePlan(await createClient(), days, Math.random, Date.now());
  return plan.ok ? { ok: true, preview: plan.preview } : fail(plan.error);
}

/** What Autopilot needs before it can run, in plain words; null when all set. */
function missingSetup(): string | null {
  if (!facebookConfig()) return "Connect Facebook first: add FACEBOOK_PAGE_ID, FACEBOOK_PAGE_TOKEN and FACEBOOK_APP_SECRET in Vercel (see docs/SETUP.md).";
  if (!process.env.ANTHROPIC_API_KEY?.trim()) return "Autopilot's checks need ANTHROPIC_API_KEY in Vercel (see docs/SETUP.md, Autopilot).";
  if ((process.env.AUTOPILOT_SECRET?.trim().length ?? 0) < AUTOPILOT_SECRET_MIN || !process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()) {
    return "Autopilot needs AUTOPILOT_SECRET and SUPABASE_SERVICE_ROLE_KEY in Vercel, and the same secret on your PC (see docs/SETUP.md, Autopilot).";
  }
  return null;
}

export async function startAutopilotAction(days: number): Promise<ActionResult<{ runId: string }>> {
  await requireOwner();
  if (badDays(days)) return fail(DAYS);
  const setup = missingSetup();
  if (setup) return fail(setup);
  const sb = await createClient();
  const plan = await preparePlan(sb, days, Math.random, Date.now());
  if (!plan.ok) return fail(plan.error);
  const { data: run, error } = await sb.from("autopilot_runs").insert({
    days, first_day: plan.first,
    events: [{ at: new Date().toISOString(), kind: "run", text: `Started: ${plan.preview.posts} posts, ${plan.preview.range}.` }],
  }).select("id").single();
  if (error) return fail(error.code === "23505" ? "Autopilot is already running. Stop it first." : /autopilot_runs/.test(error.message) ? NEEDS_022 : error.message);
  const runId = (run as { id: string }).id;
  const { error: itemsErr } = await sb.from("autopilot_items").insert(plan.items.map((i) => ({
    run_id: runId, day: i.day, slot: i.slot, gender: i.gender, scheduled_for: i.scheduledFor, letter: i.letter, name_theme: i.nameTheme, name_count: i.nameCount,
  })));
  if (itemsErr) {
    await sb.from("autopilot_runs").delete().eq("id", runId);
    return fail(`Could not save the plan: ${itemsErr.message}`);
  }
  revalidatePath("/autopilot");
  return { ok: true, runId };
}

/** Stop at once: nothing new is made or scheduled; scheduled posts stay. */
export async function stopAutopilotAction(runId: string): Promise<ActionResult> {
  await requireOwner();
  if (!UUID_RE.test(runId ?? "")) return fail("Run not found.");
  const sb = await createClient();
  const { error } = await sb.from("autopilot_runs").update({ status: "stopped", message: null, finished_at: new Date().toISOString() })
    .eq("id", runId).in("status", ["running", "waiting", "paused"]).select("id");
  if (error) return fail(error.message);
  revalidatePath("/autopilot");
  return { ok: true };
}

/** After the owner fixed what paused the run (credits, a key). */
export async function resumeAutopilotAction(runId: string): Promise<ActionResult> {
  await requireOwner();
  if (!UUID_RE.test(runId ?? "")) return fail("Run not found.");
  const sb = await createClient();
  const { error } = await sb.from("autopilot_runs").update({ status: "running", message: null }).eq("id", runId).eq("status", "paused").select("id");
  if (error) return fail(error.message);
  revalidatePath("/autopilot");
  return { ok: true };
}

export async function saveNameThemesAction(text: string): Promise<ActionResult> {
  await requireOwner();
  const raw = String(text ?? "");
  const problem = nameThemesProblem(raw);
  if (problem) return fail(problem);
  const clean = raw.split(/\r?\n/).map((l) => l.replace(/\s+/g, " ").trim()).filter(Boolean).join("\n");
  const sb = await createClient();
  const { error } = await sb.from("settings").update({ autopilot_name_themes: clean }).eq("id", 1).select("id");
  if (error) return fail(/autopilot_name_themes/.test(error.message) ? NEEDS_022 : error.message);
  revalidatePath("/autopilot");
  return { ok: true };
}
