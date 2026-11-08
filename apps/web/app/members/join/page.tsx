"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { input } from "@/components/members/ui";
import { useMembersOffer } from "@/queries/use-members";

const USERNAME_OK = /^[A-Za-z0-9_]{3,20}$/;

/** A field with its label always shown above it (a placeholder vanishes as you type). */
function Field({ id, label, hint, children }: { id: string; label: string; hint?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-sm font-medium text-ink">
        {label}
      </label>
      {children}
      {hint}
    </div>
  );
}

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
  const offer = useMembersOffer().data;
  const days = offer?.trialDays ?? 7;
  const picks = offer?.trialStrategyLimit ?? 3;

  // What still stops the button, said under it, so a greyed-out button never leaves you guessing.
  const missing =
    name.trim().length < 2
      ? "Add your name"
      : !USERNAME_OK.test(username)
        ? "Choose a username"
        : !email
          ? "Add your email"
          : password.length < 10
            ? "Choose a password of 10+ characters"
            : !agree
              ? "Tick the 18+ box"
              : null;

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
      // Straight on to choosing the trial strategies (that page explains itself if a trial isn't available).
      router.replace(offer?.trial === false ? "/members" : "/members/trial");
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
      <p className="text-sm text-ink-muted">
        {offer?.selling
          ? `Free forever: house results and a simulation bank. Start a ${days}-day Premium Trial whenever you're ready.`
          : `Free. Choose ${picks} strategies and get ${days} days of full access to them: how they work, every qualifying game and upcoming opportunities. No card needed.`}
      </p>
      <form onSubmit={submit} className="space-y-4">
        <Field id="join-name" label="Your name">
          <input id="join-name" className={input} autoComplete="name" required value={name} maxLength={60} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field
          id="join-username"
          label="Username"
          hint={
            <p className={`text-xs ${username && !USERNAME_OK.test(username) ? "text-destructive" : "text-ink-muted"}`}>
              3 to 20 letters, numbers or underscores. You can sign in with it instead of your email.
            </p>
          }
        >
          <input
            id="join-username"
            className={input}
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            required
            value={username}
            maxLength={20}
            onChange={(e) => setUsername(e.target.value.replace(/\s/g, ""))}
          />
        </Field>
        <Field id="join-email" label="Email">
          <input id="join-email" className={input} type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <Field id="join-password" label="Password" hint={<p className="text-xs text-ink-muted">At least 10 characters.</p>}>
          <input id="join-password" className={input} type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        <label className="flex items-start gap-2.5 text-sm text-ink-muted">
          <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} className="mt-1 h-4 w-4 shrink-0 accent-[var(--accent)]" />I am 18 or over and understand GoalBrew shows betting information, not advice.
        </label>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <div className="space-y-1.5 pt-1">
          <button type="submit" disabled={pending || missing !== null} className="min-h-11 w-full rounded-md bg-accent px-3 py-2 text-sm font-semibold text-accent-ink">
            {pending ? "Creating…" : "Create free account"}
          </button>
          {missing && !pending && <p className="text-center text-xs text-ink-muted">{missing} to continue.</p>}
        </div>
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
