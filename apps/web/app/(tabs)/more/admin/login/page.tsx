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
  // On by default: the admin signs in on their own phone or computer. Untick it on a shared one.
  const [remember, setRemember] = useState(true);
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
        body: JSON.stringify({ password, remember }),
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
    <div className="flex min-h-[calc(100dvh-12rem)] flex-col items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm rounded-2xl border border-line bg-surface p-6">
        <h1 className="font-display text-title font-bold text-ink [font-stretch:115%]">Admin</h1>
        <p className="mb-6 mt-1 text-sm text-ink-muted">Sign in to manage betting and alerts.</p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <label htmlFor="admin-password" className="-mb-2.5 block text-sm font-medium text-ink">
            Password
          </label>
          <input
            id="admin-password"
            type="password"
            autoFocus
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="min-h-11 w-full rounded-md border border-line bg-app px-3 py-2 text-sm text-ink outline-none focus:border-accent focus:ring-2 focus:ring-accent/30"
          />

          <label className="flex items-center gap-2 text-sm text-ink-muted">
            <input
              type="checkbox"
              checked={remember}
              onChange={(e) => setRemember(e.target.checked)}
              style={{ accentColor: "var(--accent)" }}
              className="h-4 w-4"
            />
            Remember this device for 30 days
          </label>

          {error && <p className="text-sm text-destructive">{error}</p>}

          <button
            type="submit"
            disabled={pending || password.length === 0}
            className="min-h-11 w-full rounded-md bg-accent px-3 py-2 text-sm font-semibold text-accent-ink"
          >
            {pending ? "Checking…" : "Sign in"}
          </button>
        </form>
      </div>
    </div>
  );
}
