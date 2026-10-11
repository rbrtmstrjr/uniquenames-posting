import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireOwner } from "@/lib/actions/result";
import { buildExport, validateExport } from "@/lib/pdf/export";
import { activePack } from "@/packs";

// POST /names/export {buyer, gender} -> the encrypted names PDF (Names > Export PDF). Node runtime (the default): pdfkit
// and the committed fonts (lib/pdf/fonts, traced in next.config.ts). The new password comes back ONCE, in the
// X-Export-Password header, next to the file; it is also kept in the owner-only exports log (migration 018).

// Names are sorted beforehand by the dialog ("Sorting names by meaning…"); a PDF itself takes a few seconds.
export const maxDuration = 60;

const json = (error: string, status: number) => Response.json({ error }, { status, headers: { "Cache-Control": "no-store" } });

export async function POST(req: Request) {
  try {
    await requireOwner();
  } catch {
    return json("Not signed in.", 401);
  }
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json("Send the buyer and the pick as JSON.", 400);
  }
  const v = validateExport(body);
  if (!v.ok) return json(v.error, 400);
  const r = await buildExport({ sb: await createClient(), pack: activePack(), buyer: v.buyer, gender: v.gender, now: new Date() });
  if (!r.ok) return json(r.error, 422);
  if (r.logged) revalidatePath("/names");
  return new Response(new Uint8Array(r.pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${r.fileName}"`,
      "Cache-Control": "no-store",
      "X-Export-Password": r.password,
      "X-Export-File": r.fileName,
      "X-Export-Count": String(r.count),
      "X-Export-Pages": String(r.pages),
      "X-Export-Logged": r.logged ? "1" : "0",
      ...(r.warning ? { "X-Export-Warning": encodeURIComponent(r.warning) } : {}),
    },
  });
}
