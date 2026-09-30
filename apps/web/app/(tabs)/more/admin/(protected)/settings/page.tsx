"use client";

import { Skeleton } from "@/components/ui/Skeleton";
import { QueryError } from "@/components/ui/QueryError";
import TelegramConnection from "@/components/admin/TelegramConnection";
import { usePublicView, useSetPublicView } from "@/queries/use-access";
import { useFreshStart, useSetFreshStart } from "@/queries/use-fresh-start";

const freshFmt = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

function FreshStartCard() {
  const { data: at, isLoading, error } = useFreshStart();
  const save = useSetFreshStart();

  if (error) return <QueryError error={error} next="/more/admin/settings" />;
  if (isLoading || at === undefined) return <Skeleton className="h-32 w-full" />;

  function start() {
    const ok = window.confirm(
      "Start fresh from now?\n\nThe Dashboard, strategy hit rates, Win/Loss and profit figures will count only alerts from this moment on, so they all start at zero.\n\nNothing is deleted: the Results page, Trade Log and your settings (stakes, minimum odds, switches) are untouched, and you can undo this at any time to bring the old figures back.\n\nStop loss counts also restart from now.",
    );
    if (ok) save.mutate(true);
  }

  function undo() {
    if (window.confirm("Bring the old figures back?\n\nEverything counts from the very beginning again.")) save.mutate(false);
  }

  return (
    <section className="rounded-xl border border-line bg-surface p-3.5">
      <h3 className="text-sm font-medium text-ink">Fresh start</h3>
      <p className="mt-0.5 text-xs text-ink-muted">
        Restarts the Dashboard, strategy hit rates, Win/Loss and profit figures from zero, without deleting anything.
      </p>
      {save.error && <p className="mt-2 text-xs text-danger">{save.error.message}</p>}
      {at === null ? (
        <button
          type="button"
          disabled={save.isPending}
          onClick={start}
          className="mt-3 rounded-md bg-accent px-3 py-2 text-sm font-medium text-accent-ink disabled:opacity-50"
        >
          {save.isPending ? "Saving…" : "Start fresh from now"}
        </button>
      ) : (
        <>
          <p className="mt-3 text-xs text-ink">Counting from {freshFmt.format(new Date(at))}. Older alerts are kept but not counted.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={save.isPending}
              onClick={undo}
              className="rounded-md border border-line px-3 py-2 text-sm font-medium text-ink disabled:opacity-50"
            >
              Undo (bring old figures back)
            </button>
            <button
              type="button"
              disabled={save.isPending}
              onClick={start}
              className="rounded-md border border-line px-3 py-2 text-sm font-medium text-ink disabled:opacity-50"
            >
              Start again from now
            </button>
          </div>
        </>
      )}
    </section>
  );
}

function PublicViewCard() {
  const { data: publicView, isLoading, error } = usePublicView();
  const save = useSetPublicView();

  if (error) return <QueryError error={error} next="/more/admin/settings" />;
  if (isLoading || publicView === undefined) return <Skeleton className="h-40 w-full" />;

  function toggle() {
    const turningOn = !publicView;
    if (turningOn) {
      const ok = window.confirm(
        "Turn the public view ON?\n\nAnyone with your site's address will be able to see your picks, results and hit rates without signing in. Your stakes and the alert text stay private.",
      );
      if (!ok) return;
    }
    save.mutate(turningOn);
  }

  return (
    <section className="rounded-xl border border-line bg-surface p-3.5">
      {save.error && <p className="mb-2 text-sm text-danger">{save.error.message}</p>}
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-medium text-ink">Public view</h3>
          <p className="mt-0.5 text-xs text-ink-muted">Lets anyone see the Dashboard, Live and Trade Log without signing in.</p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={publicView}
          aria-label="Public view"
          disabled={save.isPending}
          onClick={toggle}
          className={`h-6 w-11 shrink-0 rounded-full p-0.5 ring-1 ring-inset ring-line transition-colors disabled:opacity-50 ${
            publicView ? "bg-accent" : "bg-surface-2"
          }`}
        >
          <span className={`block h-5 w-5 rounded-full bg-white shadow ring-1 ring-black/10 transition-transform ${publicView ? "translate-x-5" : ""}`} />
        </button>
      </div>

      <p className={`mt-3 text-xs ${publicView ? "text-ink" : "text-ink-muted"}`}>
        {publicView
          ? "On. Anyone with your site's address can see picks, results and hit rates."
          : "Off. Those pages ask visitors to sign in. Signed-in users only see the pages you have given them on the Users page, and you can see everything."}
      </p>
      <p className="mt-2 text-xs text-ink-muted">
        Admin pages (Picks, Results, Sending, Win/Loss and Settings) always need a sign-in, whatever this is set to.
      </p>
    </section>
  );
}

export default function SettingsPage() {
  return (
    <div className="space-y-3">
      <h2 className="text-lg font-medium tracking-tight text-ink">Settings</h2>
      <PublicViewCard />
      <FreshStartCard />
      <section className="rounded-xl border border-line bg-surface p-3.5">
        <TelegramConnection />
      </section>
    </div>
  );
}