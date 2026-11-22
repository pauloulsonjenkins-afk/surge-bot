"use client";

import { useState } from "react";
import { Card, PageHeader } from "@/components/ui/Card";
import { Skeleton } from "@/components/ui/Skeleton";
import { QueryError } from "@/components/ui/QueryError";
import { useChangeTipman, useTipman, type TipmanCard, type TipmanCategory, type TipmanRecord } from "@/queries/use-tipman";
import { signedGbp } from "@/lib/money-verdict";

const LABEL: Record<TipmanCategory, string> = {
  botd: "Bet of the Day",
  "double-treble": "Double / Treble",
  acca: "Accumulator",
  booking: "Booking Bets",
  "bet-builder": "Bet Builder",
  "btts-win-acca": "BTTS & Win Acca",
  other: "Other",
};

const pts = (n: number) => `${n > 0 ? "+" : n < 0 ? "−" : ""}${Math.abs(n).toFixed(2).replace(/\.?0+$/, "")} pts`;
const tone = (n: number) => (n > 0 ? "text-hit" : n < 0 ? "text-loss" : "text-ink-muted");
const time = (iso: string | null) => (iso ? new Date(iso).toLocaleTimeString("en-GB", { timeZone: "Europe/London", hour: "2-digit", minute: "2-digit" }) : "");
const dayWords = (day: string) => new Date(`${day}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });

/** Points won or lost on a settled card. */
function cardPts(c: TipmanCard): number | null {
  if (c.result === "lost") return -c.pts;
  if (c.result === "won" && c.odds !== null) return c.pts * (c.odds - 1);
  return null;
}

function Status({ c }: { c: TipmanCard }) {
  if (c.result === "won") return <span className="rounded-full bg-hit/15 px-2 py-0.5 text-[11px] font-medium text-hit">Won</span>;
  if (c.result === "lost") return <span className="rounded-full bg-loss/15 px-2 py-0.5 text-[11px] font-medium text-loss">Lost</span>;
  if (c.result === "void") return <span className="rounded-full bg-ink/10 px-2 py-0.5 text-[11px] font-medium text-ink">Void</span>;
  const needsYou = c.legs.some((l) => l.settle === "manual" && l.result === null);
  return <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${needsYou ? "bg-warn/20 text-warn" : "bg-ink/5 text-ink-muted"}`}>{needsYou ? "Needs your result" : "Waiting"}</span>;
}

function CardView({ c, pointValue }: { c: TipmanCard; pointValue: number }) {
  const change = useChangeTipman();
  const won = cardPts(c);
  const betfair = c.books.find((b) => b.book === "Betfair");
  const mark = (result: "won" | "lost" | "void") => change.mutate({ action: "result", id: c.id, result });
  return (
    <li className="py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium text-ink">
            {LABEL[c.category]} <span className="text-xs font-normal text-ink-muted">· {c.tier === "premium" ? "Premium" : "Free"}</span>
          </p>
          <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-ink-muted">
            <Status c={c} />
            <span>
              {c.pts}pt{c.ptsAssumed ? " (assumed)" : ""} ({signedGbp(c.pts * pointValue).replace("+", "")})
            </span>
            {c.odds !== null && <span>@ {c.odds.toFixed(2)}</span>}
            {c.legs.length > 1 && <span>· {c.legs.length} legs</span>}
          </p>
        </div>
        {won !== null && (
          <p className={`shrink-0 text-right text-sm font-semibold tabular-nums ${tone(won)}`}>
            {pts(won)}
            <span className="block text-xs font-normal">{signedGbp(won * pointValue)}</span>
          </p>
        )}
      </div>

      <ul className="mt-2 space-y-1">
        {c.legs.map((l, i) => (
          <li key={`${l.match}-${l.selection}-${i}`} className="flex items-start gap-2 text-xs">
            <span className={`mt-0.5 w-4 shrink-0 text-center font-bold ${l.result === "won" ? "text-hit" : l.result === "lost" ? "text-loss" : "text-ink-muted"}`} aria-label={l.result ?? "not settled"}>
              {l.result === "won" ? "✓" : l.result === "lost" ? "✗" : l.result === "void" ? "–" : "·"}
            </span>
            <span className="min-w-0 text-ink">
              {l.selection}
              <span className="text-ink-muted">
                {" "}
                · {l.match} {time(l.kickoff) && `· ${time(l.kickoff)}`}
                {l.odds !== null ? ` · ${l.odds.toFixed(2)}` : ""}
              </span>
              {l.settle === "manual" && l.result === null && <span className="block text-ink-muted">Not on Betfair&apos;s Exchange: you mark this card.</span>}
            </span>
          </li>
        ))}
      </ul>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        {c.books.length > 0 && (
          <a
            href={(betfair ?? c.books[0]!).url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-h-11 items-center rounded-full bg-accent px-4 py-2 text-xs font-medium text-accent-ink"
          >
            Open {(betfair ?? c.books[0]!).book} betslip
          </a>
        )}
        {c.books
          .filter((b) => b !== (betfair ?? c.books[0]))
          .slice(0, 3)
          .map((b) => (
            <a key={b.book} href={b.url} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center rounded-full border border-line px-3 py-2 text-xs font-medium text-ink">
              {b.book}
              {b.odds !== null ? ` ${b.odds.toFixed(2)}` : ""}
            </a>
          ))}
        {c.result === null &&
          (["won", "lost", "void"] as const).map((r) => (
            <button key={r} type="button" disabled={change.isPending} onClick={() => mark(r)} className="min-h-11 rounded-full border border-line px-3 py-2 text-xs font-medium text-ink disabled:opacity-50">
              Mark {r}
            </button>
          ))}
        {c.result !== null && c.resultBy && <span className="text-xs text-ink-muted">Settled {c.resultBy === "owner" ? "by you" : c.resultBy === "betfair" ? "from Betfair" : "from Betfair and you"}</span>}
      </div>
      {change.error && <p className="mt-1 text-xs text-destructive">{change.error.message}</p>}
    </li>
  );
}

function Record({ rows, pointValue }: { rows: TipmanRecord[]; pointValue: number }) {
  const sorted = [...rows].sort((a, b) => (a.tier === b.tier ? b.profitPts - a.profitPts : a.tier === "premium" ? -1 : 1));
  const total = (tier: "premium" | "free") => sorted.filter((r) => r.tier === tier).reduce((t, r) => ({ pts: t.pts + r.profitPts, settled: t.settled + r.settled }), { pts: 0, settled: 0 });
  return (
    <Card title="How each is doing" subtitle="Settled bets only, in points as the tipster stakes them, and in pounds at your £ per point.">
      {sorted.length === 0 ? (
        <p className="text-sm text-ink-muted">Nothing settled yet.</p>
      ) : (
        <>
          {(["premium", "free"] as const).map((tier) => {
            const t = total(tier);
            return t.settled > 0 ? (
              <div key={tier} className="flex items-baseline justify-between border-b border-line pb-2 text-sm">
                <span className="font-medium text-ink">All {tier} · {t.settled} settled</span>
                <span className={`font-semibold tabular-nums ${tone(t.pts)}`}>
                  {pts(t.pts)} · {signedGbp(t.pts * pointValue)}
                </span>
              </div>
            ) : null;
          })}
          <ul className="divide-y divide-line">
            {sorted.map((r) => (
              <li key={`${r.tier}-${r.category}`} className="flex items-baseline justify-between gap-3 py-2 text-sm">
                <span className="min-w-0 text-ink">
                  {LABEL[r.category]} <span className="text-xs text-ink-muted">· {r.tier}</span>
                  <span className="block text-xs text-ink-muted">
                    {r.won} won · {r.lost} lost{r.cards > r.settled ? ` · ${r.cards - r.settled} open` : ""}
                  </span>
                </span>
                <span className={`shrink-0 text-right font-semibold tabular-nums ${tone(r.profitPts)}`}>
                  {r.settled > 0 ? pts(r.profitPts) : "–"}
                  {r.settled > 0 && <span className="block text-xs font-normal">{signedGbp(r.profitPts * pointValue)}</span>}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </Card>
  );
}

/**
 * TipMan (owner, 22 Nov 2026): the bets on tipmantips.com as the tipster sets them up (a single, a double or treble, an
 * accumulator, booking bets, a bet builder), each at its own stake in points and its own price. Tracked only: nothing is
 * bet. The cards are read from your signed-in browser by a scheduled task; Betfair's Exchange settles the legs it lists,
 * and the rest you mark here.
 */
export default function TipmanPage() {
  const { data, isLoading, error } = useTipman();
  const change = useChangeTipman();
  const [draft, setDraft] = useState<string | null>(null);
  if (error) return <QueryError error={error} next="/more/admin/tipman" />;
  if (isLoading || !data) return <Skeleton className="h-64 w-full" />;

  const days = [...new Set(data.cards.map((c) => c.day))].sort().reverse();
  const value = draft ?? String(data.pointValue);
  const save = () => {
    const n = Number(value);
    if (Number.isFinite(n) && n > 0) change.mutate({ action: "pointValue", value: n }, { onSuccess: () => setDraft(null) });
  };

  return (
    <div className="space-y-6">
      <PageHeader as="h2" title="TipMan" subtitle="The tipster's bets, staked as he sets them up. Tracked only: nothing is bet." />

      <Record rows={data.record} pointValue={data.pointValue} />

      <Card title="One point is worth" subtitle="Used for the pounds figures here.">
        <div className="flex items-center gap-2">
          <span className="text-ink">£</span>
          <input
            type="number"
            inputMode="decimal"
            min="0.01"
            step="0.5"
            value={value}
            onChange={(e) => setDraft(e.target.value)}
            className="min-h-11 w-28 rounded-md border border-line bg-surface-2 px-3 py-2 text-sm text-ink"
            aria-label="£ per point"
          />
          <button type="button" onClick={save} disabled={change.isPending || draft === null} className="min-h-11 rounded-full bg-accent px-4 py-2 text-xs font-medium text-accent-ink disabled:opacity-50">
            Save
          </button>
        </div>
        {change.error && <p className="mt-1 text-xs text-destructive">{change.error.message}</p>}
      </Card>

      {days.length === 0 ? (
        <p className="text-sm text-ink-muted">No bets read yet. They appear here when TipMan publishes them and the scheduled read picks them up.</p>
      ) : (
        days.map((day) => (
          <section key={day} className="space-y-1">
            <h3 className="text-base font-semibold text-ink">{dayWords(day)}</h3>
            <ul className="divide-y divide-line rounded-xl border border-line bg-surface px-3.5">
              {data.cards
                .filter((c) => c.day === day)
                .map((c) => (
                  <CardView key={c.id} c={c} pointValue={data.pointValue} />
                ))}
            </ul>
          </section>
        ))
      )}
    </div>
  );
}
