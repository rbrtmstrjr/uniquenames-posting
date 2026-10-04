import { getPostList } from "@/lib/data/posts";
import { PostList } from "@/components/posts/post-list";
import { PageHeader } from "@/components/ui/page-header";

export default async function PostsPage() {
  const posts = await getPostList();
  return (
    <>
      <PageHeader title="Posts" subtitle="Every post you made. Open one to pick, order and save its cards." />
      <PostList posts={posts} />
    </>
  );
}
