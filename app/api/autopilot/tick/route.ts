import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { autopilotDeps } from "@/lib/autopilot/wiring";
import { tick } from "@/lib/autopilot/engine";
import { AUTOPILOT_SECRET_MIN, keyOk } from "@/lib/autopilot/key";

// The PC worker knocks here about every 30 s while an Autopilot run is active (worker 2.9.0). One bounded step.
export const maxDuration = 300;
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const secret = process.env.AUTOPILOT_SECRET?.trim();
  if (!secret || secret.length < AUTOPILOT_SECRET_MIN) {
    return NextResponse.json({ ok: false, error: `Set AUTOPILOT_SECRET (${AUTOPILOT_SECRET_MIN}+ characters) in Vercel.` }, { status: 503 });
  }
  if (!keyOk(req.headers.get("x-autopilot-key"), secret)) return NextResponse.json({ ok: false, error: "Wrong key." }, { status: 401 });
  const sb = createAdminClient();
  if (!sb) return NextResponse.json({ ok: false, error: "Set SUPABASE_SERVICE_ROLE_KEY in Vercel." }, { status: 503 });
  return NextResponse.json({ ok: true, ...(await tick(autopilotDeps(sb))) });
}
