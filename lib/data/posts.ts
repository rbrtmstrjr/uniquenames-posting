import { createClient } from "@/lib/supabase/server";
import type { CardRow, PostRow, SettingsRow, ThemeRow } from "@/lib/db/types";
import { fontsOf } from "@/lib/fonts/post-fonts";
import { partsInOrder } from "@/lib/series/az";

export type PostListItem = PostRow & { theme_title: string; cards: Pick<CardRow, "id" | "status" | "card_path" | "position">[] };

export async function getPostList(): Promise<PostListItem[]> {
  const sb = await createClient();
  const { data } = await sb.from("posts").select("*, themes(title), cards(id, status, card_path, position)")
    .order("post_date", { ascending: false }).order("created_at", { ascending: false }).limit(90);
  // Newest first, but an A–Z series reads Part 1 above Part 2.
  return partsInOrder((data ?? []).map((p) => {
    const { themes, cards, ...rest } = p as PostRow & { themes: { title: string } | null; cards: PostListItem["cards"] };
    return { ...rest, theme_title: themes?.title ?? "", cards: [...(cards ?? [])].sort((a, b) => a.position - b.position) };
  }));
}

export async function getPost(id: string) {
  const sb = await createClient();
  const { data: post } = await sb.from("posts").select("*").eq("id", id).maybeSingle();
  if (!post) return null;
  const [{ data: theme }, { data: cards }, { data: settings }] = await Promise.all([
    sb.from("themes").select("*").eq("id", (post as PostRow).theme_id).single(),
    sb.from("cards").select("*").eq("post_id", id).order("position"),
    // select * (never naming the font columns): works before and after every migration.
    sb.from("settings").select("*").eq("id", 1).maybeSingle(),
  ]);
  return { post: post as PostRow, theme: theme as ThemeRow, cards: (cards ?? []) as CardRow[], settingsFonts: fontsOf(settings as Partial<SettingsRow> | null) };
}
