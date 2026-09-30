"use client";

import { FormEvent, Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { safeNext } from "@/lib/user-pages";

function LoginForm() {
  const router = useRouter();
  const qc = useQueryClient();
  const next = safeNext(useSearchParams().get("next"));

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setPending(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error ?? "Couldn't sign in.");
        return;
      }
      qc.clear(); // nothing loaded before signing in should be shown afterwards
      router.replace(next);
      router.refresh();
    } catch {
      setError("Network error. Try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex min-h-full flex-col items-center justify-center px-6 py-10">
      <div className="w-full max-w-xs">
        <h1 className="mb-1 text-lg font-medium tracking-tight text-ink">Sign in</h1>
        <p className="mb-6 text-sm text-ink-muted">Use the email and password you signed up with.</p>

        <form onSubmit={handleSubmit} className="space-y-3">
          <input
            type="email"
            autoFocus
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Email"
            className="w-full rounded-md border border-line bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-accent"
          />
          <input
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Password"
            className="w-full rounded-md border border-line bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-accent"
          />

          {error && <p className="text-sm text-destructive">{error}</p>}

          <button
            type="submit"
            disabled={pending || email.length === 0 || password.length === 0}
            className="w-full rounded-md bg-accent px-3 py-2 text-sm font-medium text-accent-ink disabled:opacity-50"
          >
            {pending ? "Checking…" : "Sign in"}
          </button>
        </form>

        <p className="mt-4 text-sm text-ink-muted">
          No account yet?{" "}
          <Link href={`/signup${next !== "/more" ? `?next=${encodeURIComponent(next)}` : ""}`} className="text-accent underline">
            Create one
          </Link>
        </p>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}
