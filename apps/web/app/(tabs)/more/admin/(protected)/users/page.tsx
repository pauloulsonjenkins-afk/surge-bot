"use client";

import { PageHeader } from "@/components/ui/Card";
import { useState } from "react";
import { Skeleton } from "@/components/ui/Skeleton";
import { QueryError } from "@/components/ui/QueryError";
import { useDialog } from "@/components/ui/ConfirmDialog";
import { usePublicView } from "@/queries/use-access";
import { useAdminUsers, useDeleteUser, useSetSignupsOpen, useUpdateUser, type AdminUser } from "@/queries/use-users";
import { USER_PAGES, USER_PAGE_LABEL, type UserPage } from "@/lib/user-pages";

const dateFmt = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Europe/London" });

function statusOf(u: AdminUser): { text: string; className: string } {
  if (!u.active) return { text: "Disabled", className: "bg-warn/15 text-warn" };
  if (u.pages.length === 0) return { text: "Waiting for access", className: "bg-surface-2 text-ink-muted" };
  return { text: "Active", className: "bg-hit/15 text-hit" };
}

function UserCard({ user }: { user: AdminUser }) {
  const update = useUpdateUser();
  const remove = useDeleteUser();
  const dialog = useDialog();
  const busy = update.isPending || remove.isPending;
  const status = statusOf(user);
  const error = update.error ?? remove.error;

  function togglePage(page: UserPage) {
    const pages = user.pages.includes(page) ? user.pages.filter((p) => p !== page) : [...user.pages, page];
    update.mutate({ id: user.id, pages });
  }

  function resetPassword() {
    const next = window.prompt(`New password for ${user.email} (at least 10 characters).\n\nThey will be signed out everywhere. Tell them the new password yourself.`);
    if (next === null) return;
    if (next.length < 10) {
      void dialog.notify({ title: "Password too short", body: <p>Use at least 10 characters.</p> });
      return;
    }
    update.mutate({ id: user.id, password: next });
  }

  async function toggleActive() {
    if (
      user.active &&
      !(await dialog.confirm({
        title: `Disable ${user.email}?`,
        tone: "danger",
        confirmLabel: "Disable account",
        body: <p>They will be signed out and unable to sign in until you enable them again.</p>,
      }))
    )
      return;
    update.mutate({ id: user.id, active: !user.active });
  }

  async function signOutEverywhere() {
    const ok = await dialog.confirm({
      title: `Sign ${user.email} out everywhere?`,
      confirmLabel: "Sign out on every device",
      body: <p>They can sign straight back in.</p>,
    });
    if (!ok) return;
    update.mutate({ id: user.id, signOutEverywhere: true });
  }

  async function deleteUser() {
    const ok = await dialog.confirm({
      title: `Delete ${user.email} for good?`,
      tone: "danger",
      confirmLabel: "Delete account",
      body: <p>The account is removed and they will need to sign up again.</p>,
    });
    if (!ok) return;
    remove.mutate(user.id);
  }

  const btn = "rounded-md border border-line px-2.5 py-1.5 text-xs text-ink hover:bg-surface-2 disabled:opacity-50";

  return (
    <li className={`rounded-xl border border-line bg-surface p-3 ${user.active ? "" : "opacity-70"}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-ink">{user.name || user.email}</p>
          {user.name && <p className="truncate text-xs text-ink-muted">{user.email}</p>}
          <p className="mt-0.5 text-xs text-ink-muted">
            Joined {dateFmt.format(new Date(user.createdAt))}
            {user.lastLoginAt ? ` · last signed in ${dateFmt.format(new Date(user.lastLoginAt))}` : " · never signed in"}
          </p>
        </div>
        <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${status.className}`}>{status.text}</span>
      </div>

      <fieldset className="mt-3 space-y-1.5" disabled={busy}>
        <legend className="mb-1 text-xs font-medium text-ink-muted">Can see</legend>
        {USER_PAGES.map((page) => (
          <label key={page} className="flex items-start gap-2 text-sm text-ink">
            <input type="checkbox" checked={user.pages.includes(page)} onChange={() => togglePage(page)} className="mt-0.5 h-4 w-4 accent-[var(--accent)]" />
            <span>
              {USER_PAGE_LABEL[page].title}
              <span className="block text-xs text-ink-muted">{USER_PAGE_LABEL[page].detail}</span>
            </span>
          </label>
        ))}
      </fieldset>

      {error && <p className="mt-2 text-xs text-destructive">{error.message}</p>}

      <div className="mt-3 flex flex-wrap gap-1.5">
        <button type="button" className={btn} disabled={busy} onClick={toggleActive}>
          {user.active ? "Disable" : "Enable"}
        </button>
        <button type="button" className={btn} disabled={busy} onClick={resetPassword}>
          Reset password
        </button>
        <button type="button" className={btn} disabled={busy} onClick={signOutEverywhere}>
          Sign out everywhere
        </button>
        <button type="button" className={`${btn} text-destructive`} disabled={busy} onClick={deleteUser}>
          Delete
        </button>
      </div>
    </li>
  );
}

function SignupsCard({ open }: { open: boolean }) {
  const save = useSetSignupsOpen();
  return (
    <section className="rounded-xl border border-line bg-surface p-3.5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-medium text-ink">Allow new sign-ups</h3>
          <p className="mt-0.5 text-xs text-ink-muted">
            {open
              ? "On. Anyone can create an account, but it starts with no access until you give it some."
              : "Off. The sign-up page refuses new accounts. Existing users are not affected."}
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={open}
          aria-label="Allow new sign-ups"
          disabled={save.isPending}
          onClick={() => save.mutate(!open)}
          className={`h-6 w-11 shrink-0 rounded-full p-0.5 ring-1 ring-inset ring-line transition-colors disabled:opacity-50 ${open ? "bg-hit" : "bg-surface-2"}`}
        >
          <span className={`block h-5 w-5 rounded-full bg-white shadow ring-1 ring-black/10 transition-transform ${open ? "translate-x-5" : ""}`} />
        </button>
      </div>
      {save.error && <p className="mt-2 text-xs text-destructive">{save.error.message}</p>}
    </section>
  );
}

export default function UsersPage() {
  const { data, isLoading, error } = useAdminUsers();
  const { data: publicView } = usePublicView();

  // People waiting for access first, then everyone else newest first (the engine already sends newest first).
  const users = data
    ? [...data.users].sort((a, b) => Number(b.active && b.pages.length === 0) - Number(a.active && a.pages.length === 0))
    : [];

  return (
    <div className="space-y-3">
      <PageHeader as="h2" title="Users" subtitle="People who signed up on the site. Choose which pages each one can see." />

      {publicView === true && (
        <p className="rounded-xl border border-line bg-surface-2 p-3 text-xs text-ink">
          Public view is ON, so everyone can already see the Dashboard, Live, Trade Log and Schedule, and the choices below don&apos;t
          restrict anything. Turn Public view off in Settings for them to apply.
        </p>
      )}

      {error ? (
        <QueryError error={error} next="/more/admin/users" />
      ) : isLoading || !data ? (
        <Skeleton className="h-40 w-full" />
      ) : (
        <>
          <SignupsCard open={data.signupsOpen} />
          {users.length === 0 ? (
            <p className="text-sm text-ink-muted">Nobody has signed up yet.</p>
          ) : (
            <ul className="space-y-2">
              {users.map((u) => (
                <UserCard key={u.id} user={u} />
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
