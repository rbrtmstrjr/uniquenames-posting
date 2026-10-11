import { activePack } from "@/packs";
import { anonShopDb } from "@/lib/shop/anon";
import { downloadOrder, TOKEN_RE } from "@/lib/shop/service";

// /shop/download/<token>: the buyer's own PDF. POST only (the Download button's form), so link scanners in email apps
// never use up the 5 downloads; a GET (an old link, a scanner) goes to the thanks page, which has the button.
// Node runtime: pdfkit + the committed fonts (next.config.ts traces lib/pdf/fonts for this route).

export const maxDuration = 60;

const MESSAGES: Record<string, string> = {
  not_found: "We can't find this order.",
  unpaid: "This order is not paid yet.",
  expired: "This download link has ended (7 days after payment). Message us and we will help you.",
  limit: "This PDF was downloaded 5 times already. Message us and we will help you.",
  empty: "This edition has no names yet. Message us and we will help you.",
  error: "Something went wrong. Please try again in a minute.",
};

const back = (req: Request, token: string) =>
  Response.redirect(new URL(TOKEN_RE.test(token) ? `/shop/thanks?o=${token}` : "/shop", req.url), 303);

export async function GET(req: Request, ctx: { params: Promise<{ token: string }> }) {
  return back(req, (await ctx.params).token);
}

export async function POST(req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  const r = await downloadOrder({ db: anonShopDb(), pack: activePack(), token, now: new Date() });
  if (!r.ok) {
    const status = r.reason === "not_found" ? 404 : r.reason === "error" ? 500 : 403;
    // our own fixed texts only (no input is echoed)
    const backTo = TOKEN_RE.test(token) ? `/shop/thanks?o=${token}` : "/shop";
    const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Download</title></head>` +
      `<body style="font-family:system-ui,sans-serif;max-width:32rem;margin:3rem auto;padding:0 1rem;line-height:1.5;color:#3B2A20;background:#FBF6EF">` +
      `<p>${MESSAGES[r.reason]}</p><p><a href="${backTo}" style="color:#8A5A3B;font-weight:600">Back to your order</a></p></body></html>`;
    return new Response(html, { status, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
  }
  return new Response(new Uint8Array(r.pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${r.fileName}"`,
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
      "X-Robots-Tag": "noindex",
    },
  });
}
