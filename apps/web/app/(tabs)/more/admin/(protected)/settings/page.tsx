"use client";

import { Skeleton } from "@/components/ui/Skeleton";
import { QueryError } from "@/components/ui/QueryError";
import { usePublicView, useSetPublicView } from "@/queries/use-access";

export default function SettingsPage() {
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
    <div className="space-y-3">
      <div>
        <h2 className="text-lg font-medium tracking-tight text-ink">Settings</h2>
      </div>

      {save.error && <p className="text-sm text-danger">{save.error.message}</p>}

      <section className="rounded-xl border border-line bg-surface p-3.5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-medium text-ink">Public view</h3>
            <p className="mt-0.5 text-xs text-ink-muted">
              Lets anyone see the Dashboard, Live and Trade Log without signing in.
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={publicView}
            aria-label="Public view"
            disabled={save.isPending}
            onClick={toggle}
            className={`h-6 w-11 shrink-0 rounded-full p-0.5 transition-colors disabled:opacity-50 ${
              publicView ? "bg-accent" : "bg-surface-2"
            }`}
          >
            <span className={`block h-5 w-5 rounded-full bg-ink transition-transform ${publicView ? "translate-x-5" : ""}`} />
          </button>
        </div>

        <p className={`mt-3 text-xs ${publicView ? "text-ink" : "text-ink-muted"}`}>
          {publicView
            ? "On. Anyone with your site's address can see picks, results and hit rates."
            : "Off. Those pages ask visitors to sign in. You can still see everything while signed in."}
        </p>
        <p className="mt-2 text-xs text-ink-muted">
          Admin pages (Telegram, Picks, Results, Sending and Settings) always need a sign-in, whatever this is set to.
        </p>
      </section>
    </div>
  );
}
