"use client";

import { useState } from "react";
import { Card } from "@/components/ui/Card";
import { useDialog } from "@/components/ui/ConfirmDialog";
import { useClearUnplaced, useFixUnplaced, useUnplaced } from "@/queries/use-unplaced";
import { useStrategyNames } from "@/queries/use-strategy-names";

const SHOW = 5;

const when = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/London" });

/**
 * Sent picks your betting software didn't place: no bet on Betfair 3 minutes after sending (last 24 hours), with the
 * likely reason. Shown only when there are some, so a quiet day adds nothing to the page. Each can be cleared once
 * looked at; clearing only takes it off this list (the pick stays sent and is settled as usual).
 */
export function NotPlacedCard() {
  const { data } = useUnplaced();
  const clear = useClearUnplaced();
  const fix = useFixUnplaced();
  const dialog = useDialog();
  const strategyNames = useStrategyNames();
  const [all, setAll] = useState(false);
  // What the last "Add name & send" did, shown above the list.
  const [fixNote, setFixNote] = useState<string | null>(null);
  if (!data?.configured || data.picks.length === 0) return null;
  // The newest few; a bad day can have dozens.
  const shown = all ? data.picks : data.picks.slice(0, SHOW);

  async function clearAll() {
    const ids = data!.picks.map((p) => p.id);
    const ok = await dialog.confirm({
      title: `Clear all ${ids.length} from Not placed?`,
      body: "They come off this list only. The picks stay sent and are settled as usual.",
      confirmLabel: `Clear ${ids.length}`,
    });
    if (ok) clear.mutate(ids);
  }

  return (
    <Card
      title={<span className="text-warn">Not placed · {data.picks.length}</span>}
      subtitle={`Sent to your betting software but no bet on Betfair ${data.afterMinutes} minutes later, last 24 hours. Fix the cause in your betting software, or tick “Placed it yourself?” on Live if you bet it elsewhere. Clear each one once you've looked at it.`}
      actions={
        <button type="button" onClick={() => void clearAll()} disabled={clear.isPending} className="text-xs font-medium text-accent disabled:opacity-50">
          Clear all
        </button>
      }
    >
      {clear.error && <p className="mb-2 text-xs text-destructive">{clear.error.message}</p>}
      {fix.error && <p className="mb-2 text-xs text-destructive">{fix.error.message}</p>}
      {fixNote && <p className="mb-2 text-xs text-hit">{fixNote}</p>}
      <ul className="divide-y divide-line">
        {shown.map((p) => (
          <li key={p.id} className="flex items-start gap-3 py-2">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-ink">
                {p.match} <span className="font-normal text-ink-muted">· {strategyNames.name(p.strategy)}</span>
              </p>
              <p className="text-xs text-ink-muted">
                {[
                  p.competition,
                  `sent ${when.format(new Date(p.sentAt))}`,
                  p.price != null ? `Betfair ${p.price.toFixed(2)}${p.minPrice != null ? ` (min ${p.minPrice.toFixed(2)})` : ""}` : null,
                  p.alertedAt ? "notified" : null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
              <p className="mt-0.5 text-xs text-ink">{p.reason}</p>
              {p.betfairEvent && (
                <button
                  type="button"
                  disabled={fix.isPending}
                  onClick={() => {
                    setFixNote(null);
                    fix.mutate(p.id, { onSuccess: (r) => setFixNote(`${p.match}: ${r.message}`) });
                  }}
                  className="mt-1.5 rounded-md bg-accent px-2.5 py-1 text-xs font-medium text-accent-ink disabled:opacity-50"
                >
                  Add name &amp; send as “{p.betfairEvent}”
                </button>
              )}
            </div>
            <button
              type="button"
              onClick={() => clear.mutate([p.id])}
              aria-label={`Clear ${p.match} from Not placed`}
              className="shrink-0 rounded-md border border-line px-2 py-1 text-xs font-medium text-ink-muted hover:text-ink"
            >
              Clear
            </button>
          </li>
        ))}
      </ul>
      {data.picks.length > SHOW && (
        <button type="button" onClick={() => setAll((a) => !a)} className="mt-2 text-xs font-medium text-accent">
          {all ? "Show fewer" : `Show all ${data.picks.length}`}
        </button>
      )}
    </Card>
  );
}
