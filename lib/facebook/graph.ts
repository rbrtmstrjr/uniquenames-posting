import "server-only";
import { createHmac } from "node:crypto";

// The Facebook Page's official Graph API (Post now / Schedule, 2026-11-04): only what posting needs. Every call is
// signed with appsecret_proof, so a leaked Page token alone cannot be used against the Page (with "Require App Secret"
// on in the Meta app). Posting only: no comments, likes or any other activity.
export const GRAPH_VERSION = "v26.0";
const BASE = `https://graph.facebook.com/${GRAPH_VERSION}`;

export interface FacebookConfig { pageId: string; token: string; appSecret: string }

/** The Page and its keys from the server's environment (Vercel, Sensitive), or null until all three are set. */
export function facebookConfig(env: Record<string, string | undefined> = process.env): FacebookConfig | null {
  const pageId = env.FACEBOOK_PAGE_ID?.trim(), token = env.FACEBOOK_PAGE_TOKEN?.trim(), appSecret = env.FACEBOOK_APP_SECRET?.trim();
  return pageId && token && appSecret ? { pageId, token, appSecret } : null;
}

/**
 * auth = the token no longer works (expired, password changed, role removed): reconnect. blocked = Facebook paused
 * posting (368). rate = too many calls. network = no answer at all, so nothing is known about what Facebook did.
 */
export type FacebookErrorKind = "auth" | "blocked" | "rate" | "network" | "other";

export class FacebookError extends Error {
  constructor(message: string, readonly kind: FacebookErrorKind, readonly code?: number, readonly subcode?: number) {
    super(message);
    this.name = "FacebookError";
  }
}

const AUTH_SUBCODES = new Set([458, 459, 460, 463, 464, 467, 492]);
const RATE_CODES = new Set([4, 17, 32, 613, 80001]);

function kindOf(code?: number, subcode?: number): FacebookErrorKind {
  if (code === 190 || code === 102 || (subcode !== undefined && AUTH_SUBCODES.has(subcode))) return "auth";
  if (code === 368) return "blocked";
  if (code !== undefined && RATE_CODES.has(code)) return "rate";
  return "other";
}

export const appSecretProof = (token: string, secret: string) => createHmac("sha256", secret).update(token).digest("hex");

export function graphClient(cfg: FacebookConfig, fetchImpl: typeof fetch = fetch, timeoutMs = 25_000) {
  const proof = appSecretProof(cfg.token, cfg.appSecret);

  async function call(method: "GET" | "POST" | "DELETE", path: string, params: Record<string, string> = {}) {
    const all = new URLSearchParams({ ...params, access_token: cfg.token, appsecret_proof: proof });
    const inUrl = method !== "POST";
    let res: Response;
    try {
      res = await fetchImpl(`${BASE}${path}${inUrl ? `?${all}` : ""}`, {
        method, signal: AbortSignal.timeout(timeoutMs),
        ...(inUrl ? {} : { body: all, headers: { "content-type": "application/x-www-form-urlencoded" } }),
      });
    } catch (e) {
      throw new FacebookError(`Facebook did not answer (${(e as Error).name === "TimeoutError" || (e as Error).name === "AbortError" ? "timed out" : (e as Error).message}).`, "network");
    }
    const body = (await res.json().catch(() => null)) as { error?: { message?: string; code?: number; error_subcode?: number } } & Record<string, unknown> | null;
    if (!res.ok || body?.error) {
      const e = body?.error ?? {};
      throw new FacebookError(e.message || `Facebook answered ${res.status}.`, kindOf(e.code, e.error_subcode), e.code, e.error_subcode);
    }
    return body ?? {};
  }

  return {
    /** The Page's name: the Settings connection check. */
    async pageName(): Promise<string> {
      return String((await call("GET", `/${cfg.pageId}`, { fields: "name" })).name ?? "");
    },
    /** One photo, uploaded unpublished from a URL Facebook fetches itself; `temporary` for a scheduled post. */
    async uploadPhoto(url: string, o: { temporary?: boolean } = {}): Promise<string> {
      const r = await call("POST", `/${cfg.pageId}/photos`, { url, published: "false", ...(o.temporary ? { temporary: "true" } : {}) });
      return String(r.id);
    },
    /** ONE feed post with every photo attached in order; with `scheduledAt`, Facebook holds it until then. */
    async createPost(p: { message: string; photoIds: string[]; scheduledAt?: Date }): Promise<string> {
      const params: Record<string, string> = { message: p.message };
      p.photoIds.forEach((id, i) => { params[`attached_media[${i}]`] = JSON.stringify({ media_fbid: id }); });
      if (p.scheduledAt) {
        params.published = "false";
        params.scheduled_publish_time = String(Math.floor(p.scheduledAt.getTime() / 1000));
        params.unpublished_content_type = "SCHEDULED";
      }
      return String((await call("POST", `/${cfg.pageId}/feed`, params)).id);
    },
    async permalink(postId: string): Promise<string | null> {
      const r = await call("GET", `/${postId}`, { fields: "permalink_url" });
      return typeof r.permalink_url === "string" ? r.permalink_url : null;
    },
    async deletePost(postId: string): Promise<void> {
      await call("DELETE", `/${postId}`);
    },
  };
}

export type GraphClient = ReturnType<typeof graphClient>;
