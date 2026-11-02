"use client";

import { PageHeader } from "@/components/ui/Card";
import { Skeleton } from "@/components/ui/Skeleton";
import { QueryError } from "@/components/ui/QueryError";
import { useDialog } from "@/components/ui/ConfirmDialog";
import { useArchive, useSetArchive } from "@/queries/use-archive";
import { gbp, signedPct, toneOf, units } from "@/lib/format";

const day = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", day: "numeric", month: "short", year: "numeric" });
const shown = (iso: string | null) => (iso ? day.format(new Date(iso)) : "–");

function Record({ name, r }: { name: string; r: { counted: number; profit: number; units: number; roi: number | null } }) {
  if (r.counted === 0) return <p className="text-xs text-ink-muted">{name}: no priced bets</p>;
  return (
    <p className="text-xs tabular-nums text-ink-muted">
      {name}: {r.counted} bets · <span className={toneOf(r.roi)}>{units(r.units)}</span> · <span className={toneOf(r.roi)}>{signedPct(r.roi)}</span> per £1 · <span className={toneOf(r.profit)}>{gbp(r.profit)}</span>
    </p>
  );
}

/**
 * The archive: strategies hidden from every other page, kept here with what they did, so they are not built again by
 * mistake. Their bets still count in every money total. Restoring one puts it back on the lists (still in Sim).
 */
export default function ArchivePage() {
  const { data, isLoading, error } = useArchive();
  const set = useSetArchive();
  const dialog = useDialog();
  if (error) return <QueryError error={error} next="/more/admin/archive" />;
  if (isLoading || !data) return <Skeleton className="h-40 w-full" />;
  return (
    <div className="space-y-4">
      <PageHeader
        as="h2"
        title="Archive"
        subtitle="Strategies no longer in use: hidden from every other page, kept here so they aren't built again by mistake. Their bets still count in the money totals."
      />
      {data.rows.length === 0 ? (
        <p className="text-sm text-ink-muted">Nothing is archived. Archive a strategy from its page to move it here.</p>
      ) : (
        <ul className="space-y-3">
          {data.rows.map((r) => (
            <li key={r.key} className="rounded-xl border border-line bg-surface p-3.5">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-medium text-ink">{r.label}</p>
                  <p className="text-xs text-ink-muted">
                    Archived {shown(r.archivedAt)} · {r.alerts} alerts · last {shown(r.lastAlertAt)}
                  </p>
                  {r.note && <p className="mt-0.5 text-xs text-ink">{r.note}</p>}
                </div>
                <button
                  type="button"
                  disabled={set.isPending}
                  onClick={async () => {
                    const ok = await dialog.confirm({
                      title: `Restore ${r.label}?`,
                      confirmLabel: "Restore",
                      body: <p>It goes back on the Strategies and Profit lists. It stays in Sim: put it Live again yourself if you want to.</p>,
                    });
                    if (ok) set.mutate({ label: r.label, archived: false });
                  }}
                  className="shrink-0 rounded-md border border-line px-3 py-2 text-xs font-medium text-ink"
                >
                  Restore
                </button>
              </div>
              <div className="mt-2 space-y-0.5">
                <Record name="Live" r={r.live} />
                <Record name="Sim" r={r.sim} />
              </div>
            </li>
          ))}
        </ul>
      )}
      {set.error && <p className="text-sm text-destructive">{set.error.message}</p>}
    </div>
  );
}
