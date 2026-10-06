"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { input } from "@/components/members/ui";

const USERNAME_OK = /^[A-Za-z0-9_]{3,20}$/;

/** Free membership sign-up: makes the account, then signs straight in. */
export default function JoinPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [agree, setAgree] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setPending(true);
    try {
      const made = await fetch("/api/auth/signup", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, username, email, password }) });
      if (!made.ok) {
        setError(((await made.json().catch(() => ({}))) as { error?: string }).error ?? "Couldn't create the account.");
        return;
      }
      const login = await fetch("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password }) });
      if (!login.ok) {
        // The email was already registered (sign-up never says so, to protect who has an account).
        setError("That email already has an account. Sign in instead.");
        return;
      }
      qc.clear();
      router.replace("/members");
      router.refresh();
    } catch {
      setError("Network error. Try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="mx-auto max-w-sm space-y-4 pt-6">
      <h1 className="font-display text-2xl font-bold text-ink [font-stretch:115%]">Create your free account</h1>
      <p className="text-sm text-ink-muted">Free forever: house results and a simulation bank. Start a 7-day Premium Trial whenever you&apos;re ready.</p>
      <form onSubmit={submit} className="space-y-3">
        <input className={input} autoComplete="name" placeholder="Your name" aria-label="Your name" required value={name} maxLength={60} onChange={(e) => setName(e.target.value)} />
        <div>
          <input
            className={input}
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            placeholder="Choose a username"
            aria-label="Username"
            required
            value={username}
            maxLength={20}
            onChange={(e) => setUsername(e.target.value.replace(/\s/g, ""))}
          />
          <p className={`mt-1 text-xs ${username && !USERNAME_OK.test(username) ? "text-destructive" : "text-ink-muted"}`}>
            3 to 20 letters, numbers or underscores. You can sign in with it instead of your email.
          </p>
        </div>
        <input className={input} type="email" autoComplete="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} />
        <input className={input} type="password" autoComplete="new-password" placeholder="Password (10+ characters)" value={password} onChange={(e) => setPassword(e.target.value)} />
        <label className="flex items-start gap-2 text-xs text-ink-muted">
          <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} className="mt-0.5" />I am 18 or over and understand GoalBrew shows betting information, not advice.
        </label>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <button type="submit" disabled={pending || !agree || name.trim().length < 2 || !USERNAME_OK.test(username) || !email || password.length < 10} className="w-full rounded-md bg-accent px-3 py-2 text-sm font-semibold text-accent-ink disabled:opacity-50">
          {pending ? "Creating…" : "Create free account"}
        </button>
      </form>
      <p className="text-sm text-ink-muted">
        Already a member?{" "}
        <Link href="/members/login" className="text-accent underline">
          Sign in
        </Link>
      </p>
    </div>
  );
}
