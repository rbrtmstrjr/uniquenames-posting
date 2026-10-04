import { LoginForm } from "./login-form";
import { safeNext } from "@/lib/supabase/proxy";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; denied?: string }> }) {
  const { next, denied } = await searchParams;
  return (
    <main className="grid min-h-dvh place-items-center bg-bg px-5">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="font-display text-4xl italic text-accent">✿</div>
          <h1 className="mt-2 font-display text-3xl text-ink">Unique Names</h1>
          <p className="mt-1 text-sm text-muted">Daily name-card posts</p>
        </div>
        <LoginForm next={safeNext(next)} denied={denied === "1"} />
      </div>
    </main>
  );
}
