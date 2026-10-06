"use client";

import { useState } from "react";
import { Card } from "@/components/ui/Card";
import type { AdminLeagueRow, LeaguePatch } from "@/queries/use-leagues";

/**
 * Keeping the alerts you receive to leagues you can actually bet on. Three steps, top of the Leagues page:
 *  1. Needs review: a league with this many alerts whose match wasn't on Betfair. Stop it, or keep it.
 *  2. To switch off in InPlayGuru: stopped leagues whose alerts still arrive, until they're removed from InPlayGuru's
 *     league filter (copy the list, remove them there, tick them off here).
 *  3. Stopped: everything already stopped, tucked away and reversible.
 * "Stop" does both things at once: stops sending its alerts and hides it from the stats.
 */

/** Alerts not on Betfair before a league is flagged for review. */
export const REVIEW_AFTER = 10;

const whenFmt = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

type Change = (key: string, patch: LeaguePatch) => void;

/** The league as InPlayGuru writes it: country first ("France Ligue 1"). */
const fullName = (r: AdminLeagueRow) => (r.country && !r.league.toLowerCase().startsWith(r.country.toLowerCase()) ? `${r.country} ${r.league}` : r.league);

export const needsReview = (r: AdminLeagueRow) => (r.exchange?.off ?? 0) >= REVIEW_AFTER && !r.noSend && !r.keep;
export const toSwitchOff = (r: AdminLeagueRow) => r.noSend && !r.ipgDone;

const STOP: LeaguePatch = { noSend: true, hidden: true };
const RESTART: LeaguePatch = { noSend: false, hidden: false, ipgDone: false, keep: true };

function Row({ r, children }: { r: AdminLeagueRow; children: React.ReactNode }) {
  const ex = r.exchange ?? { checked: 0, on: 0, nameDiffers: 0, off: 0, lastOffAt: null };
  return (
    <li className="flex items-start justify-between gap-3 py-2.5">
      <span className="min-w-0">
        <span className="block truncate text-sm text-ink">{fullName(r)}</span>
        <span className="block text-xs text-ink-muted">
          {[
            `${ex.off} of ${ex.checked} alert${ex.checked === 1 ? "" : "s"} not on Betfair`,
            ex.on > 0 && `${ex.on} were`,
            ex.lastOffAt && `last ${whenFmt.format(new Date(ex.lastOffAt))}`,
          ]
            .filter(Boolean)
            .join(" · ")}
        </span>
      </span>
      <span className="flex shrink-0 gap-1.5">{children}</span>
    </li>
  );
}

const btn = "rounded-md border border-line px-2.5 py-1 text-xs font-medium text-ink hover:bg-surface-2 disabled:opacity-50";
const btnPrimary = "rounded-md bg-accent px-2.5 py-1 text-xs font-medium text-accent-ink disabled:opacity-50";

export function LeagueReview({ rows, busy, onChange }: { rows: AdminLeagueRow[]; busy: boolean; onChange: Change }) {
  const [copied, setCopied] = useState(false);
  if (rows.length > 0 && rows[0]!.exchange === undefined) return null; // older engine
  const review = rows.filter(needsReview).sort((a, b) => (b.exchange?.off ?? 0) - (a.exchange?.off ?? 0) || a.league.localeCompare(b.league));
  const todo = rows.filter(toSwitchOff).sort((a, b) => a.league.localeCompare(b.league));
  const stopped = rows.filter((r) => r.noSend && r.ipgDone).sort((a, b) => a.league.localeCompare(b.league));

  async function copy() {
    try {
      await navigator.clipboard.writeText(todo.map(fullName).join("\n"));
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      // Clipboard blocked: the names are still listed below to copy by hand.
    }
  }

  return (
    <div className="space-y-3">
      {review.length > 0 ? (
        <Card
          title={`Needs review (${review.length})`}
          subtitle={`Leagues where ${REVIEW_AFTER} or more alerts weren't on Betfair. Stop a league to stop sending its alerts and hide it from the stats (you can undo it), or keep it if you still want it.`}
          actions={
            <button type="button" disabled={busy} onClick={() => review.forEach((r) => onChange(r.key, STOP))} className={btnPrimary}>
              Stop all {review.length}
            </button>
          }
        >
          <ul className="divide-y divide-line">
            {review.map((r) => (
              <Row key={r.key} r={r}>
                <button type="button" disabled={busy} onClick={() => onChange(r.key, { keep: true })} className={btn}>
                  Keep
                </button>
                <button type="button" disabled={busy} onClick={() => onChange(r.key, STOP)} className={btnPrimary}>
                  Stop
                </button>
              </Row>
            ))}
          </ul>
        </Card>
      ) : (
        <p className="rounded-xl border border-line bg-surface px-3.5 py-2.5 text-xs text-ink-muted">
          Nothing to review. A league appears here once {REVIEW_AFTER} of its alerts weren’t on Betfair.
        </p>
      )}

      {todo.length > 0 && (
        <Card
          title={`To switch off in InPlayGuru (${todo.length})`}
          subtitle="These are stopped here, but InPlayGuru still sends their alerts. Copy the list, remove them from your league filter in InPlayGuru, then tick them off."
          actions={
            <>
              <button type="button" onClick={() => void copy()} className={btn}>
                {copied ? "Copied" : "Copy list"}
              </button>
              <button type="button" disabled={busy} onClick={() => todo.forEach((r) => onChange(r.key, { ipgDone: true }))} className={btnPrimary}>
                All done
              </button>
            </>
          }
        >
          <ul className="divide-y divide-line">
            {todo.map((r) => (
              <li key={r.key} className="flex items-center justify-between gap-3 py-2">
                <span className="min-w-0 truncate text-sm text-ink">{fullName(r)}</span>
                <button type="button" disabled={busy} onClick={() => onChange(r.key, { ipgDone: true })} className={btn}>
                  Removed
                </button>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {stopped.length > 0 && (
        <details className="rounded-xl border border-line bg-surface p-3.5">
          <summary className="cursor-pointer text-sm font-medium text-ink">
            Stopped leagues ({stopped.length}) <span className="text-xs font-normal text-ink-muted">· switched off and hidden</span>
          </summary>
          <ul className="mt-2 divide-y divide-line">
            {stopped.map((r) => (
              <Row key={r.key} r={r}>
                <button type="button" disabled={busy} onClick={() => onChange(r.key, RESTART)} className={btn}>
                  Start again
                </button>
              </Row>
            ))}
          </ul>
          <p className="mt-2 text-xs text-ink-muted">Starting a league again brings its alerts back here, but you also need to add it back to your league filter in InPlayGuru.</p>
        </details>
      )}
    </div>
  );
}
