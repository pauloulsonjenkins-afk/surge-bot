"use client";

import { FormEvent, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { safeNext } from "@/lib/user-pages";

export default function AdminLoginPage() {
  const router = useRouter();
  const params = useSearchParams();
  // Only a page on this site: a link carrying ?next=https://… must not send you elsewhere once signed in.
  const next = safeNext(params.get("next"), "/more/admin/today");

  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setPending(true);

    try {
      const res = await fetch("/api/admin/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error ?? "Couldn't sign in.");
        return;
      }

      // Server has set the httpOnly session cookie; nothing to store here.
      router.replace(next);
      router.refresh();
    } catch {
      setError("Network error — try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex min-h-full flex-col items-center justify-center px-6">
      <div className="w-full max-w-xs">
        <h1 className="mb-1 text-lg font-medium tracking-tight text-ink">Admin access</h1>
        <p className="mb-6 text-sm text-ink-muted">
          This section controls the alert connection. Sign in to continue.
        </p>

        <form onSubmit={handleSubmit} className="space-y-3">
          <input
            type="password"
            autoFocus
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Password"
            className="w-full rounded-md border border-line bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-accent"
          />

          {error && <p className="text-sm text-destructive">{error}</p>}

          <button
            type="submit"
            disabled={pending || password.length === 0}
            className="w-full rounded-md bg-accent px-3 py-2 text-sm font-medium text-accent-ink disabled:opacity-50"
          >
            {pending ? "Checking…" : "Sign in"}
          </button>
        </form>
      </div>
    </div>
  );
}
