import { Suspense } from "react";
import { notFound } from "next/navigation";
import { getPost } from "@/lib/data/posts";
import { PostDetail } from "@/components/posts/post-detail";

// "Rewrite caption" runs on this route and can wait ~15 s for Gemini.
export const maxDuration = 60;

export default async function PostPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const data = await getPost(id);
  if (!data) notFound();
  // PostDetail reads ?card= (open that card), which needs a Suspense boundary.
  return <Suspense><PostDetail key={id} post={data.post} theme={data.theme} initialCards={data.cards} settingsFonts={data.settingsFonts} /></Suspense>;
}
