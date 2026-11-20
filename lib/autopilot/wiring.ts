import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createPostCore } from "@/lib/posts/create";
import { publishPost } from "@/lib/facebook/publish";
import { remakeCard } from "@/lib/cards/remake";
import { suggestForLetter, suggestNames } from "@/lib/ai/suggest";
import { NAME_COUNT, VIBE_MAX, filterNameSuggestions } from "@/lib/ai/suggest-filter";
import type { EngineDeps } from "./engine";
import { judgeNames } from "./judge-names";
import { judgeCard, judgeLookAlike } from "./judge-photos";
import { pickNames, type NamesDeps } from "./names-step";
import { supabaseRepo } from "./repo";

/** AI name ideas for a post: the By letter suggestions, or the name suggestions with the theme as the wish. */
const suggest: NamesDeps["suggest"] = async (i) => {
  if (i.target.kind === "letter") {
    const r = await suggestForLetter({ gender: i.gender, style: "single", letter: i.target.letter, count: i.want, existing: i.existing, allNames: i.allNames });
    return r.ok ? { ok: true, names: r.result.fresh.map((n) => ({ name: n.name, meaning: n.meaning })) } : { ok: false, error: r.error };
  }
  const vibe = `${i.target.title} baby names${i.target.hint ? ` (${i.target.hint})` : ""}`.slice(0, VIBE_MAX);
  const r = await suggestNames({ gender: i.gender, style: "single", count: Math.min(Math.max(i.want, NAME_COUNT.min), NAME_COUNT.max), vibe, existing: i.existing });
  if (!r.ok) return { ok: false, error: r.error };
  return { ok: true, names: filterNameSuggestions(r.data, i.allNames, "single").fresh.map((n) => ({ name: n.name, meaning: n.meaning })) };
};

/** The engine's real dependencies, on the service-role client. */
export function autopilotDeps(sb: SupabaseClient): EngineDeps {
  const repo = supabaseRepo(sb);
  return {
    repo,
    pickNames: (item, hint, deadline) => pickNames({ repo, judge: judgeNames, suggest, rng: Math.random }, item, hint, deadline),
    createPost: (input) => createPostCore(sb, input),
    schedule: async (postId, at) => {
      const { data } = await sb.from("posts").select("caption").eq("id", postId).maybeSingle();
      return publishPost(sb, postId, { caption: (data as { caption?: string } | null)?.caption ?? "", scheduledAt: at });
    },
    remake: (card, extra) => remakeCard(sb, card, extra),
    judgeCard: (card, url) => judgeCard(card, url),
    judgeLookAlike: (cards) => judgeLookAlike(cards),
    now: Date.now,
  };
}
