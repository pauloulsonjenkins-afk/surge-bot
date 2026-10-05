"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";

export default function SignupPage() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setPending(true);
    try {
      const res = await fetch("/api/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, password }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error ?? "Couldn't create the account.");
        return;
      }
      setDone(true);
    } catch {
      setError("Network error. Try again.");
    } finally {
      setPending(false);
    }
  }

  if (done) {
    return (
      <div className="flex min-h-full flex-col items-center justify-center px-6 py-10">
        <div className="w-full max-w-xs">
          <h1 className="mb-2 text-lg font-medium tracking-tight text-ink">Request received</h1>
          <p className="mb-4 text-sm text-ink-muted">
            If that email wasn&apos;t already registered, your account now exists, with a free Members membership. Sign in and open
            Members. If you already have an account, just sign in.
          </p>
          <Link href="/login?next=/members" className="text-sm text-accent underline">
            Go to sign in
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-full flex-col items-center justify-center px-6 py-10">
      <div className="w-full max-w-xs">
        <h1 className="mb-1 text-lg font-medium tracking-tight text-ink">Create account</h1>
        <p className="mb-6 text-sm text-ink-muted">Every new account gets a free Members membership (house results and a simulation bank).</p>

        <form onSubmit={handleSubmit} className="space-y-3">
          <input
            type="text"
            autoFocus
            autoComplete="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Name (optional)"
            maxLength={60}
            className="w-full rounded-md border border-line bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-accent"
          />
          <input
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Email"
            className="w-full rounded-md border border-line bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-accent"
          />
          <input
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Password (10+ characters)"
            className="w-full rounded-md border border-line bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-accent"
          />

          {error && <p className="text-sm text-destructive">{error}</p>}

          <button
            type="submit"
            disabled={pending || email.length === 0 || password.length < 10}
            className="w-full rounded-md bg-accent px-3 py-2 text-sm font-medium text-accent-ink disabled:opacity-50"
          >
            {pending ? "Creating…" : "Create account"}
          </button>
        </form>

        <p className="mt-4 text-sm text-ink-muted">
          Already have one?{" "}
          <Link href="/login" className="text-accent underline">
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
