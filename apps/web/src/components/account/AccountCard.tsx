"use client";

import Link from "next/link";
import { useMe, useSignOut } from "@/queries/use-me";
import { Skeleton } from "@/components/ui/Skeleton";

/** Top of the More page: who you're signed in as, or how to sign in. */
export default function AccountCard() {
  const { data: me, isLoading } = useMe();
  const signOut = useSignOut();

  if (isLoading || !me) return <Skeleton className="h-16 w-full" />;

  if (me.user) {
    const label = me.user.name || me.user.email;
    return (
      <section className="rounded-xl border border-line bg-surface p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-ink">{label}</p>
            {me.user.name && <p className="truncate text-xs text-ink-muted">{me.user.email}</p>}
          </div>
          <button
            type="button"
            onClick={() => signOut.mutate()}
            disabled={signOut.isPending}
            className="shrink-0 text-xs font-medium text-ink-muted hover:text-ink disabled:opacity-50"
          >
            {signOut.isPending ? "Signing out…" : "Sign out"}
          </button>
        </div>
        <p className="mt-2 text-xs text-ink-muted">Your strategies, results, simulation and membership are in Members.</p>
        <Link href="/members" className="mt-3 inline-block rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-accent-ink">
          Open Members
        </Link>
      </section>
    );
  }

  if (me.admin) {
    return (
      <section className="rounded-xl border border-line bg-surface p-4">
        <p className="text-sm font-medium text-ink">Signed in as admin</p>
        <p className="mt-0.5 text-xs text-ink-muted">You can see every page.</p>
      </section>
    );
  }

  return (
    <section className="rounded-xl border border-line bg-surface p-4">
      <p className="text-sm font-medium text-ink">Not signed in</p>
      <div className="mt-2 flex gap-2">
        <Link href="/members/login" className="rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-accent-ink">
          Sign in
        </Link>
        <Link href="/members/join" className="rounded-md border border-line px-3 py-1.5 text-xs font-medium text-ink">
          Create account
        </Link>
      </div>
    </section>
  );
}
