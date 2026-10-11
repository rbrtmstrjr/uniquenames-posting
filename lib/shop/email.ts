import "server-only";
import nodemailer from "nodemailer";
import type { PackPdf, PackShop, ShopProduct } from "@/packs/types";
import { fillShop } from "./products";
import type { ShopEnv } from "./config";

// The delivery email (brief 2026-10-11-shop): pack-branded HTML + a plain-text twin with the download link and the
// PDF password, sent through Gmail SMTP (SMTP_USER + an app password in SMTP_PASS). No email env = no email: the
// thanks page still shows everything. Neither the address nor the password is ever logged.

export interface OrderEmailInput {
  shop: Pick<PackShop, "copy" | "products">;
  colors: PackPdf["colors"];
  brandName: string;
  buyerName: string;
  product: ShopProduct;
  /** The thanks page of the order (it shows the password and the download button). */
  link: string;
  password: string;
}

export interface OrderEmail { subject: string; html: string; text: string }

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const firstName = (n: string) => n.trim().split(/\s+/)[0] || n;

export function buildOrderEmail(i: OrderEmailInput): OrderEmail {
  const e = i.shop.copy.email;
  const product = i.shop.products[i.product].name;
  const v = { name: firstName(i.buyerName), product };
  const greeting = fillShop(e.greeting, v);
  const intro = fillShop(e.intro, v);
  const c = i.colors;
  if (!/^https?:\/\//.test(i.link)) throw new Error("The email link must be absolute.");
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(e.subject)}</title></head>
<body style="margin:0;padding:0;background:${c.paper};font-family:Helvetica,Arial,sans-serif;color:${c.ink}">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${c.paper};padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border:1px solid ${c.line};border-radius:16px;padding:28px 24px">
<tr><td style="font-size:12px;letter-spacing:2px;text-transform:uppercase;color:${c.accent};font-weight:bold;padding-bottom:12px">${esc(i.brandName)}</td></tr>
<tr><td style="font-size:16px;line-height:24px;padding-bottom:8px">${esc(greeting)}</td></tr>
<tr><td style="font-size:16px;line-height:24px;padding-bottom:20px">${esc(intro)}</td></tr>
<tr><td style="background:${c.accentSoft};border-radius:12px;padding:16px;text-align:center">
<div style="font-size:12px;letter-spacing:1px;text-transform:uppercase;color:${c.muted};padding-bottom:6px">${esc(e.passwordLabel)}</div>
<div style="font-family:Consolas,Menlo,monospace;font-size:22px;font-weight:bold;letter-spacing:1px;color:${c.ink}">${esc(i.password)}</div>
</td></tr>
<tr><td align="center" style="padding:24px 0 8px"><a href="${esc(i.link)}" style="display:inline-block;background:${c.accent};color:#ffffff;text-decoration:none;font-weight:bold;font-size:16px;padding:14px 28px;border-radius:12px">${esc(e.button)}</a></td></tr>
<tr><td style="font-size:13px;line-height:20px;color:${c.muted};padding-top:12px">${esc(e.note)}</td></tr>
<tr><td style="font-size:14px;line-height:22px;padding-top:20px">${esc(e.signoff)}</td></tr>
</table></td></tr></table></body></html>`;
  const text = [greeting, "", intro, "", `${e.passwordLabel}: ${i.password}`, "", `${e.button}: ${i.link}`, "", e.note, "", e.signoff].join("\n");
  return { subject: e.subject, html, text };
}

export type Mailer = (msg: { from: string; to: string; subject: string; html: string; text: string }) => Promise<void>;

/** Gmail SMTP (port 465, TLS). */
export function gmailMailer(smtp: NonNullable<ShopEnv["smtp"]>): Mailer {
  const transport = nodemailer.createTransport({
    host: "smtp.gmail.com", port: 465, secure: true, auth: { user: smtp.user, pass: smtp.pass },
    connectionTimeout: 10_000, greetingTimeout: 10_000, socketTimeout: 20_000,
  });
  return async (msg) => { await transport.sendMail(msg); };
}

/** Send one order email; null = sent, else a short reason (kept on the order, shown to the owner). Never throws. */
export async function sendOrderEmail(i: { smtp: ShopEnv["smtp"]; brandName: string; to: string; email: OrderEmail; mailer?: Mailer }): Promise<string | null> {
  if (!i.smtp) return "Email is not set up (SMTP_USER / SMTP_PASS).";
  const send = i.mailer ?? gmailMailer(i.smtp);
  try {
    await send({ from: `${i.brandName} <${i.smtp.from}>`, to: i.to, subject: i.email.subject, html: i.email.html, text: i.email.text });
    return null;
  } catch (e) {
    // the error's code only: SMTP errors can echo addresses
    const code = (e as { code?: unknown; responseCode?: unknown })?.code ?? (e as { responseCode?: unknown })?.responseCode;
    return `The email could not be sent${typeof code === "string" || typeof code === "number" ? ` (${code})` : ""}.`;
  }
}
