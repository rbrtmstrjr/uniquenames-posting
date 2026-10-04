"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

export function LoginForm({ next }: { next: string }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error } = await createClient().auth.signInWithPassword({ email: email.trim(), password });
    if (error) { setError("Wrong email or password."); setBusy(false); return; }
    router.replace(next);
    router.refresh();
  }

  return (
    <form onSubmit={submit} className="space-y-4 rounded-2xl border border-line bg-surface p-6 shadow-soft">
      <label className="block">
        <span className="text-sm font-semibold text-ink">Email</span>
        <input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)}
          className="mt-1.5 h-11 w-full rounded-xl border border-line bg-bg px-3 text-ink outline-none focus:border-accent" />
      </label>
      <label className="block">
        <span className="text-sm font-semibold text-ink">Password</span>
        <input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)}
          className="mt-1.5 h-11 w-full rounded-xl border border-line bg-bg px-3 text-ink outline-none focus:border-accent" />
      </label>
      {error && <p role="alert" className="text-sm font-medium text-bad">{error}</p>}
      <button disabled={busy} className="flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-accent font-bold text-accent-ink transition hover:opacity-90 disabled:opacity-60">
        {busy && <Loader2 className="size-4 animate-spin" />} Sign in
      </button>
    </form>
  );
}
