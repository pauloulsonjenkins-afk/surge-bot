"use client";

import { useRef, useState } from "react";
import { Card, HeroStat, PageHeader, moneyTone } from "@/components/ui/Card";
import { Skeleton } from "@/components/ui/Skeleton";
import { QueryError } from "@/components/ui/QueryError";
import { gbp } from "@/lib/format";
import { useAcknowledgeBets, useAddMatchName, useImportBetHistory, useReconcile, type ReconcileReport } from "@/queries/use-reconcile";
import { useDialog } from "@/components/ui/ConfirmDialog";
import { useStrategyNames } from "@/queries/use-strategy-names";

const whenFmt = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const when = (iso: string) => whenFmt.format(new Date(iso));
const timeFmt = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", hour: "2-digit", minute: "2-digit", second: "2-digit" });

function pct(n: number | null, signed = false): string {
  if (n === null) return "–";
  const v = Math.round(n * 1000) / 10;
  return `${signed && v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v)}%`;
}

const TONE = { hit: "text-hit", loss: "text-loss", muted: "text-ink-muted" };

/**
 * The file's text. Windows programs often save CSV in the old Windows encoding (a £ that isn't valid UTF-8) or UTF-16,
 * so UTF-8 is tried first and the others used when the bytes say so. The engine does the same for the import script.
 */
function decodeCsv(bytes: Uint8Array): string {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder("utf-16le").decode(bytes);
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder("utf-16be").decode(bytes);
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder("windows-1252").decode(bytes);
  }
}

/** The live check of your bets on Betfair: on and working, off (with the settings it needs), or failing (with why). */
function BetfairLinkCard({ link }: { link: NonNullable<ReconcileReport["betfairLink"]> }) {
  const ago = (iso: string) => `at ${timeFmt.format(new Date(iso))}`;
  const failing = link.configured && link.lastError !== null;
  return (
    <Card
      title="Live check on Betfair"
      subtitle="Reads your open and settled bets from Betfair every 45 seconds (read only), so Live shows within a minute whether each sent pick was placed and matched."
    >
      {!link.configured ? (
        <p className="text-xs text-ink-muted">
          <span className="text-warn">Off.</span> Add these settings to the engine component in DigitalOcean:{" "}
          {link.missing.map((m, i) => (
            <span key={m}>
              {i > 0 && ", "}
              <code className="text-ink">{m}</code>
            </span>
          ))}
          .
        </p>
      ) : failing ? (
        <p className="text-xs text-destructive">
          Not working: {link.lastError}
          {link.lastOkAt ? ` Last worked ${ago(link.lastOkAt)}.` : " It hasn’t connected yet."}
        </p>
      ) : link.lastOkAt ? (
        <p className="text-xs text-hit">
          Connected · last checked {ago(link.lastOkAt)} · {link.lastCount} bet{link.lastCount === 1 ? "" : "s"} in the last day.
        </p>
      ) : (
        <p className="text-xs text-ink-muted">Connecting…</p>
      )}
    </Card>
  );
}

/**
 * The corner markets Betfair offered for First Half Corner Race alerts. The strategy can't be sent until its exact
 * market is chosen; this shows the codes and selections on offer so the right one can be picked.
 */
function CornerMarketsCard({
  markets,
  title = "Corner markets on Betfair",
  subtitle = "Seen for First Half Corner Race alerts. Its bet can be sent once we know which of these it is.",
}: {
  markets: NonNullable<ReconcileReport["cornerMarkets"]>;
  title?: string;
  subtitle?: string;
}) {
  return (
    <Card title={title} subtitle={subtitle}>
      <ul className="divide-y divide-line">
        {markets.map((m) => (
          <li key={m.code || m.name} className="py-2 text-xs">
            <span className="block text-ink">
              {m.name} <code className="text-ink-muted">{m.code || "no code"}</code>
            </span>
            <span className="block text-ink-muted">
              {m.selections.join(" · ")} · e.g. {m.example}, {when(m.seenAt)}
            </span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function ImportCard({ report }: { report: ReconcileReport | undefined }) {
  const upload = useImportBetHistory();
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  // The betting software writes times in its PC's time zone, which may not be UK time (a server is often UTC or CET).
  const [zone, setZone] = useState<string>("Europe/London");
  const last = upload.data ?? report?.lastImport ?? null;

  async function send() {
    if (!file) return;
    upload.mutate({ csv: decodeCsv(new Uint8Array(await file.arrayBuffer())), source: file.name, timeZone: zone });
  }

  return (
    <Card title="Import bet history" subtitle="Export settled bets from BF Bot Manager (or Betfair’s bet history) as CSV and upload it here.">
      <div className="flex flex-wrap items-center gap-2">
        <input
          ref={input}
          type="file"
          accept=".csv,.txt,text/csv"
          aria-label="Bet history CSV file"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          className="max-w-full text-xs text-ink-muted file:mr-2 file:rounded-md file:border file:border-line file:bg-surface-2 file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-ink"
        />
        <label className="flex items-center gap-1.5 text-xs text-ink-muted">
          Times in the file are
          <select
            value={zone}
            onChange={(e) => setZone(e.target.value)}
            className="rounded-md border border-line bg-surface-2 px-2 py-1 text-xs text-ink"
          >
            <option value="Europe/London">UK time</option>
            <option value="Europe/Berlin">Central Europe (CET)</option>
            <option value="UTC">UTC</option>
          </select>
        </label>
        <button
          type="button"
          disabled={!file || upload.isPending}
          onClick={() => void send()}
          className="rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-accent-ink disabled:opacity-50"
        >
          {upload.isPending ? "Importing…" : "Import"}
        </button>
      </div>
      {upload.error && <p className="mt-2 text-xs text-destructive">{upload.error.message}</p>}
      {last && (
        <div className="mt-3 space-y-1 text-xs text-ink-muted">
          <p className="text-ink">
            Last import {when(last.at)} from {last.source}: {last.rows} bet{last.rows === 1 ? "" : "s"} ({last.added} new, {last.updated} already known),{" "}
            {last.linked} newly linked to picks{last.skipped > 0 ? `, ${last.skipped} row${last.skipped === 1 ? "" : "s"} skipped` : ""}.
          </p>
          <p>
            Columns read:{" "}
            {Object.entries(last.columns)
              .map(([field, col]) => `${col} → ${field}`)
              .join(", ")}
            {last.unused.length > 0 && `. Not used: ${last.unused.join(", ")}`}.
          </p>
        </div>
      )}
      <p className="mt-3 text-xs text-ink-muted">
        Importing the same file again is safe: bets are recognised by their bet id, so nothing is counted twice, and a bet that has settled
        since is updated.
      </p>
    </Card>
  );
}

function AutomaticCard({ configured }: { configured: boolean }) {
  const site = typeof window === "undefined" ? "https://your-site" : window.location.origin;
  return (
    <Card title="Automatic import" subtitle="Run a small script on the PC that runs BF Bot Manager, so new exports are sent here on their own.">
      <ol className="list-decimal space-y-2 pl-5 text-xs text-ink-muted">
        <li>
          {configured ? (
            <span className="text-hit">BETFAIR_IMPORT_TOKEN is set on the engine.</span>
          ) : (
            <>
              <span className="text-warn">Not set up yet.</span> In DigitalOcean, add <code className="text-ink">BETFAIR_IMPORT_TOKEN</code> to the
              engine component: a random string of at least 32 letters and digits, kept secret like the bet feed token.
            </>
          )}
        </li>
        <li>
          In BF Bot Manager, set the bet history export (or its automatic bet log) to save CSV files into one folder, for example{" "}
          <code className="text-ink">C:\BFBotManager\Exports</code>.
        </li>
        <li>
          Copy <code className="text-ink">tools/bf-import.ps1</code> from the repository onto that PC and schedule it every 15 minutes with Windows
          Task Scheduler:
          <pre className="mt-1 overflow-x-auto whitespace-pre-wrap break-all rounded-md bg-surface-2 p-2 text-ink">
            {`powershell -ExecutionPolicy Bypass -File bf-import.ps1 -Folder "C:\\BFBotManager\\Exports" -Url "${site}/imports/betfair/<BETFAIR_IMPORT_TOKEN>"`}
          </pre>
        </li>
      </ol>
      <p className="mt-2 text-xs text-ink-muted">The script only sends files that have changed since it last ran, and the figures on this page update after each one.</p>
    </Card>
  );
}

function StrategyRow({ s }: { s: ReconcileReport["strategies"][number] }) {
  const strategyNames = useStrategyNames();
  const diff = Math.round((s.actualProfit - s.estimatedProfit) * 100) / 100;
  const cells: Array<[string, string, string?]> = [
    ["Unmatched", s.sent === 0 ? "–" : `${pct(s.unmatchedRate)} (${s.sent - s.matched} of ${s.sent})`, s.unmatchedRate && s.unmatchedRate > 0.1 ? "text-warn" : undefined],
    ["Slippage", s.slippage === null ? "–" : `${pct(s.slippage, true)} over ${s.slippageBets}`, s.slippage === null ? undefined : TONE[moneyTone(s.slippage)]],
    ["Estimated", s.compared === 0 ? "–" : gbp(s.estimatedProfit), s.compared === 0 ? undefined : TONE[moneyTone(s.estimatedProfit)]],
    ["Actual", s.compared === 0 ? "–" : gbp(s.actualProfit), s.compared === 0 ? undefined : TONE[moneyTone(s.actualProfit)]],
  ];
  return (
    <li className="rounded-xl border border-line bg-surface p-3.5">
      <div className="flex items-start justify-between gap-3">
        <p className="min-w-0 break-words text-sm font-medium text-ink">{strategyNames.name(s.label)}</p>
        {s.compared > 0 && (
          <p className="shrink-0 text-right">
            <span className={`text-base font-semibold tabular-nums ${TONE[moneyTone(diff)]}`}>{diff === 0 ? "£0.00" : gbp(diff)}</span>
            <span className="block text-xs text-ink-muted">real minus estimate, {s.compared} bets</span>
          </p>
        )}
      </div>
      <dl className="mt-2 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
        {cells.map(([k, v, tone]) => (
          <div key={k} className="rounded-md bg-surface-2 px-2.5 py-1.5">
            <dt className="text-ink-muted">{k}</dt>
            <dd className={`font-medium tabular-nums ${tone ?? "text-ink"}`}>{v}</dd>
          </div>
        ))}
      </dl>
      {s.resultMismatches > 0 && (
        <p className="mt-2 text-xs text-warn">
          {s.resultMismatches} bet{s.resultMismatches === 1 ? "" : "s"} settled differently from the alert’s Hit/Miss. Check them on Amend results.
        </p>
      )}
    </li>
  );
}

function BetLine({ b, action }: { b: ReconcileReport["unlinked"][number]; action: React.ReactNode }) {
  return (
    <li className="flex items-start justify-between gap-3 py-2 text-xs">
      <span className="min-w-0">
        <span className="block truncate text-ink">{b.event}</span>
        <span className="text-ink-muted">
          {b.placedAt ? when(b.placedAt) : "–"} · {b.selection ?? "–"} · {b.status} ·{" "}
          <span className={TONE[moneyTone(b.profit ?? 0)]}>{b.profit === null ? "–" : gbp(b.profit)}</span>
        </span>
        {b.reason && <span className="mt-0.5 block text-ink-muted">{b.reason}</span>}
      </span>
      <span className="shrink-0">{action}</span>
    </li>
  );
}

/**
 * Bets with no pick. Once looked at, they can be acknowledged (e.g. placed before the feed was used), which moves them
 * to a closed list underneath, so the open list only ever shows new ones worth checking. Nothing is deleted.
 */
function UnlinkedBets({ report }: { report: ReconcileReport }) {
  const ack = useAcknowledgeBets();
  const addName = useAddMatchName();
  const dialog = useDialog();

  async function addMatchName(s: { from: string; to: string }) {
    const ok = await dialog.confirm({
      title: "Add this to Match names?",
      confirmLabel: "Add to Match names",
      details: [
        { label: "In the alert", value: s.from },
        { label: "On Betfair", value: s.to },
      ],
      body: (
        <p>
          Picks for this team are then sent to your betting software as “{s.to}”, and bets already placed on it link to their picks. You can
          change or remove it under Match names on the Sending page.
        </p>
      ),
    });
    if (!ok) return;
    addName.mutate(s, {
      onSuccess: (r) =>
        void dialog.notify({
          title: "Match name added",
          body: (
            <p>
              “{r.line}” is saved. {r.linked > 0 ? `${r.linked} bet${r.linked === 1 ? "" : "s"} linked to ${r.linked === 1 ? "its pick" : "their picks"}.` : "No other bets were waiting on it."}
            </p>
          ),
        }),
    });
  }
  const open = report.unlinked;
  const openCount = report.unlinkedCount ?? open.length;
  const done = report.acknowledged ?? [];
  const doneCount = report.acknowledgedCount ?? done.length;
  // An older engine doesn't know about acknowledging yet.
  const canAck = report.acknowledged !== undefined;
  const btn = "rounded-md border border-line px-2.5 py-1 text-xs font-medium text-ink hover:bg-surface-2 disabled:opacity-50";

  async function acknowledgeAll() {
    const ok = await dialog.confirm({
      title: `Acknowledge ${openCount} unlinked bet${openCount === 1 ? "" : "s"}?`,
      confirmLabel: `Acknowledge ${openCount}`,
      body: (
        <>
          <p>They move to the Acknowledged list below, so this list only shows bets that come in from now on.</p>
          <p>Nothing is deleted, they no longer count towards the period the figures cover, and each one can be put back.</p>
        </>
      ),
    });
    if (ok) ack.mutate({ betIds: open.map((b) => b.betId), acknowledged: true });
  }

  return (
    <section className="space-y-2 rounded-xl border border-line bg-surface p-3.5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-sm font-medium text-ink">Bets not linked to a pick ({openCount})</h3>
          <p className="mt-0.5 text-xs text-ink-muted">
            {openCount === 0
              ? "None. Any new bet that can’t be tied to a pick will show here."
              : "Placed by hand, by another bot, or under a team name the alert spells differently. Once checked, acknowledge them so only new ones show here."}
          </p>
        </div>
        {canAck && openCount > 1 && (
          <button type="button" disabled={ack.isPending} onClick={() => void acknowledgeAll()} className={btn}>
            Acknowledge all {openCount}
          </button>
        )}
      </div>
      {ack.error && <p className="text-xs text-destructive">{ack.error.message}</p>}
      {addName.error && <p className="text-xs text-destructive">{addName.error.message}</p>}
      {open.length > 0 && (
        <ul className="divide-y divide-line">
          {open.map((b) => (
            <BetLine
              key={b.betId}
              b={b}
              action={
                <span className="flex flex-col items-end gap-1.5">
                  {b.suggestion && (
                    <button
                      type="button"
                      disabled={addName.isPending}
                      onClick={() => void addMatchName(b.suggestion!)}
                      title={`Adds “${b.suggestion.from} = ${b.suggestion.to}” to Match names on the Sending page`}
                      className="rounded-md bg-accent px-2.5 py-1 text-xs font-medium text-accent-ink disabled:opacity-50"
                    >
                      Add to Match names
                    </button>
                  )}
                  {canAck && (
                    <button type="button" disabled={ack.isPending} onClick={() => ack.mutate({ betIds: [b.betId], acknowledged: true })} className={btn}>
                      Acknowledge
                    </button>
                  )}
                </span>
              }
            />
          ))}
        </ul>
      )}
      {doneCount > 0 && (
        <details className="border-t border-line pt-2">
          <summary className="cursor-pointer text-xs font-medium text-ink-muted">Acknowledged ({doneCount})</summary>
          <ul className="mt-1 divide-y divide-line">
            {done.map((b) => (
              <BetLine
                key={b.betId}
                b={{ ...b, reason: `Acknowledged ${when(b.acknowledgedAt)}` }}
                action={
                  <button type="button" disabled={ack.isPending} onClick={() => ack.mutate({ betIds: [b.betId], acknowledged: false })} className={btn}>
                    Put back
                  </button>
                }
              />
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}

export default function ReconcilePage() {
  const { data, isLoading, error } = useReconcile();

  return (
    <div className="space-y-6">
      <PageHeader
        as="h2"
        title="Reconcile"
        subtitle="The app counts bets matched on Betfair at their real figures. This compares the app’s estimate (from the alert’s price and your stake) with what your betting software actually placed: how many picks never matched, the price you really got, and the real profit."
      />

      {data?.betfairLink && <BetfairLinkCard link={data.betfairLink} />}
      {data?.cornerMarkets && data.cornerMarkets.length > 0 && <CornerMarketsCard markets={data.cornerMarkets} />}
      {data?.teamMarkets && data.teamMarkets.length > 0 && (
        <CornerMarketsCard
          markets={data.teamMarkets}
          title="Team goal markets on Betfair"
          subtitle="Seen for the favourite in Pass Master 1st half alerts (favourite to score again). In Sending → Bet wording use TEAM_A_OVER_UNDER_{line10} (home favourite), TEAM_B_OVER_UNDER_{line10} (away) and Over {line} Goals."
        />
      )}

      <ImportCard report={data} />

      {error ? (
        <QueryError error={error} next="/more/admin/reconcile" />
      ) : isLoading || !data ? (
        <Skeleton className="h-40 w-full" />
      ) : !data.coverage ? (
        <p className="text-sm text-ink-muted">Import a bet history to see real results here.</p>
      ) : (
        <>
          <section aria-label="Totals" className="space-y-2">
            <p className="text-xs text-ink-muted">
              Picks sent between {when(data.coverage.from)} and {when(data.coverage.to)}, the period the imported bets cover.
            </p>
            <div className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-4">
              <HeroStat label="Actual profit" tone={moneyTone(data.totals.actualProfit)} value={gbp(data.totals.actualProfit)} sub={`on ${data.totals.compared} settled bets`} />
              <HeroStat label="Estimated" tone={moneyTone(data.totals.estimatedProfit)} value={gbp(data.totals.estimatedProfit)} sub="same picks, app’s figure" />
              <HeroStat
                label="Unmatched"
                value={data.totals.sent === 0 ? "–" : pct(1 - data.totals.matched / data.totals.sent)}
                sub={`${data.totals.sent - data.totals.matched} of ${data.totals.sent} picks sent`}
              />
              <HeroStat
                label="Bets not linked"
                value={String(data.unlinkedCount ?? data.unlinked.length)}
                sub={data.acknowledgedCount ? `${data.acknowledgedCount} more acknowledged` : "no matching pick"}
              />
            </div>
          </section>

          <section className="space-y-3">
            <h3 className="text-base font-semibold text-ink">By strategy</h3>
            <p className="text-xs text-ink-muted">
              Slippage is the price matched against the price in the alert: −3% means 1.94 where the alert said 2.00. Estimated and actual compare
              only picks that had a matched, settled bet, so a missed bet doesn’t count as a difference.
            </p>
            {data.strategies.length === 0 ? (
              <p className="text-sm text-ink-muted">No picks were sent during this period.</p>
            ) : (
              <ul className="space-y-2">
                {data.strategies.map((s) => (
                  <StrategyRow key={s.label} s={s} />
                ))}
              </ul>
            )}
          </section>

          <UnlinkedBets report={data} />
        </>
      )}

      {data && <AutomaticCard configured={data.importTokenConfigured} />}
    </div>
  );
}
