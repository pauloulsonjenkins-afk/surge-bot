"use client";

import { useEffect, useState } from "react";
import { Card, PageHeader } from "@/components/ui/Card";
import { Skeleton } from "@/components/ui/Skeleton";
import { QueryError } from "@/components/ui/QueryError";
import { useChangeTipman, useTipman, type TipmanCard, type TipmanCategory, type TipmanPlaced, type TipmanRecord } from "@/queries/use-tipman";
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

/** A day's cards as blocks: the bets of one post together, each other card on its own. */
function blocks(cards: TipmanCard[]): Array<{ key: string; group: boolean; cards: TipmanCard[] }> {
  const out: Array<{ key: string; group: boolean; cards: TipmanCard[] }> = [];
  const byGroup = new Map<string, { key: string; group: boolean; cards: TipmanCard[] }>();
  for (const c of cards) {
    if (!c.group) {
      out.push({ key: c.id, group: false, cards: [c] });
      continue;
    }
    let b = byGroup.get(c.group.id);
    if (!b) {
      b = { key: c.group.id, group: true, cards: [] };
      byGroup.set(c.group.id, b);
      out.push(b);
    }
    b.cards.push(c);
  }
  return out;
}

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

/** "I've put this bet on": the stake actually used (the advised one to start with), and a tap to take it back. */
function PlacedControl({ c, pointValue }: { c: TipmanCard; pointValue: number }) {
  const change = useChangeTipman();
  const advised = Math.round(c.pts * pointValue * 100) / 100;
  const [stake, setStake] = useState<string | null>(null);
  if (c.placed) {
    return (
      <button
        type="button"
        disabled={change.isPending}
        onClick={() => change.mutate({ action: "placed", id: c.id, placed: false })}
        className="mt-1.5 inline-flex min-h-11 items-center rounded-full border border-hit bg-hit/10 px-4 py-2 text-xs font-medium text-hit disabled:opacity-50"
        aria-label="Placed: tap to undo"
      >
        ✓ Placed {signedGbp(c.placed.stake).replace("+", "")} at {c.placed.book} · tap to undo
      </button>
    );
  }
  const value = stake ?? String(advised);
  const n = Number(value);
  return (
    <span className="mt-1.5 flex flex-wrap items-center gap-2">
      <span className="text-ink-muted">£</span>
      <input
        type="number"
        inputMode="decimal"
        min="0.01"
        step="0.5"
        value={value}
        onChange={(e) => setStake(e.target.value)}
        className="min-h-11 w-20 rounded-md border border-line bg-surface px-2 py-2 text-xs text-ink"
        aria-label={`Stake placed on ${c.name}`}
      />
      <button
        type="button"
        disabled={change.isPending || !(Number.isFinite(n) && n > 0)}
        onClick={() => change.mutate({ action: "placed", id: c.id, placed: true, stake: n })}
        className="min-h-11 rounded-full border border-line px-4 py-2 text-xs font-medium text-ink disabled:opacity-50"
      >
        I&apos;ve placed this
      </button>
      {change.error && <span className="text-destructive">{change.error.message}</span>}
    </span>
  );
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
      <div className="mt-1 text-xs">
        <PlacedControl c={c} pointValue={pointValue} />
      </div>
      {change.error && <p className="mt-1 text-xs text-destructive">{change.error.message}</p>}
    </li>
  );
}

/** The bets of one post (a Trixie: three doubles and a treble) as one block: its legs, tapped once each, and its bets. */
function GroupView({ cards, pointValue }: { cards: TipmanCard[]; pointValue: number }) {
  const change = useChangeTipman();
  const first = cards[0]!;
  const g = first.group!;
  const legs = [...new Map(cards.flatMap((c) => c.legs).map((l) => [`${l.match}|${l.selection}`, l] as const)).values()];
  const settled = cards.filter((c) => c.result === "won" || c.result === "lost");
  const profit = settled.reduce((t, c) => t + (cardPts(c) ?? 0), 0);
  const placedN = cards.filter((c) => c.placed).length;
  const mark = (l: TipmanCard["legs"][number], result: "won" | "lost" | null) => change.mutate({ action: "leg", match: l.match, selection: l.selection, result });
  return (
    <li id={g.id} className="scroll-mt-20 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium text-ink">
            {LABEL[first.category]}: {g.label} <span className="text-xs font-normal text-ink-muted">· {g.totalPts}pt in all ({signedGbp(g.totalPts * pointValue).replace("+", "")})</span>
          </p>
          <p className="mt-0.5 text-xs text-ink-muted">
            <span className={placedN === g.bets ? "font-medium text-hit" : placedN > 0 ? "font-medium text-warn" : "font-medium text-ink"}>{placedN === g.bets ? "All placed" : `Placed ${placedN} of ${g.bets}`}</span> · {settled.length} settled
            {first.source === "screenshot" ? " · read from the screenshot" : ""}
          </p>
        </div>
        {settled.length > 0 && (
          <p className={`shrink-0 text-right text-sm font-semibold tabular-nums ${tone(profit)}`}>
            {pts(profit)}
            <span className="block text-xs font-normal">{signedGbp(profit * pointValue)}</span>
          </p>
        )}
      </div>
      {first.note && <p className="mt-1 text-xs font-medium text-warn">{first.note}</p>}
      {first.source === "screenshot" && !first.note && <p className="mt-1 text-xs text-ink-muted">Read from the screenshot by GoalBrew: check the legs match the post.</p>}

      <ul className="mt-2 space-y-1.5">
        {legs.map((l) => (
          <li key={`${l.match}|${l.selection}`} className="flex items-center justify-between gap-2 text-xs">
            <span className="min-w-0 text-ink">
              {l.selection}
              <span className="text-ink-muted">
                {" "}
                · {l.match}
                {l.odds !== null ? ` · ${l.odds.toFixed(2)}` : ""}
              </span>
            </span>
            {l.settle === "manual" ? (
              <span className="flex shrink-0 gap-1.5">
                <button type="button" disabled={change.isPending} onClick={() => mark(l, l.result === "won" ? null : "won")} className={`min-h-11 min-w-11 rounded-full border px-3 text-sm font-bold ${l.result === "won" ? "border-hit bg-hit/15 text-hit" : "border-line text-ink-muted"}`} aria-label={`${l.selection} won`} aria-pressed={l.result === "won"}>
                  ✓
                </button>
                <button type="button" disabled={change.isPending} onClick={() => mark(l, l.result === "lost" ? null : "lost")} className={`min-h-11 min-w-11 rounded-full border px-3 text-sm font-bold ${l.result === "lost" ? "border-loss bg-loss/15 text-loss" : "border-line text-ink-muted"}`} aria-label={`${l.selection} lost`} aria-pressed={l.result === "lost"}>
                  ✗
                </button>
              </span>
            ) : (
              <span className={`shrink-0 font-bold ${l.result === "won" ? "text-hit" : l.result === "lost" ? "text-loss" : "text-ink-muted"}`}>{l.result === "won" ? "✓" : l.result === "lost" ? "✗" : "·"}</span>
            )}
          </li>
        ))}
      </ul>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-medium text-ink">Place these in Paddy Power</p>
        {placedN < g.bets && cards.some((c) => c.result === null) && (
          <button type="button" disabled={change.isPending} onClick={() => change.mutate({ action: "placed", group: g.id, placed: true })} className="min-h-11 rounded-full border border-line px-3 py-2 text-xs font-medium text-ink disabled:opacity-50">
            I&apos;ve placed all {g.bets}
          </button>
        )}
      </div>
      <p className="text-xs text-ink-muted">Its slip can&apos;t load a double or treble from a longer list, so each bet has its own button: tap one, check the slip, set the stake, then come back for the next.</p>
      <ul className="mt-1 divide-y divide-line/60 rounded-lg bg-surface-2 px-3 text-xs">
        {cards.map((c) => {
          const p = cardPts(c);
          const link = c.pad ?? c.books.find((b) => b.book === "Paddy Power")?.url ?? c.books[0]?.url;
          return (
            <li key={c.id} className="py-2">
              <div className="flex items-center justify-between gap-2">
                <span className="min-w-0 text-ink">
                  {c.name.split(" · ")[1] ?? c.name}
                  <span className="text-ink-muted"> · {c.legs.map((l) => l.selection.split(" ")[0]).join(" + ")}{c.odds !== null ? ` @ ${c.odds.toFixed(2)}` : ""}</span>
                </span>
                <span className="flex shrink-0 items-center gap-2">
                  <Status c={c} />
                  {p !== null && <span className={`tabular-nums ${tone(p)}`}>{pts(p)}</span>}
                </span>
              </div>
              {link && c.result === null && (
                <a href={link} target="_blank" rel="noopener noreferrer" className="mt-1.5 inline-flex min-h-11 items-center rounded-full bg-accent px-4 py-2 text-xs font-medium text-accent-ink">
                  Open in Paddy Power · stake {signedGbp(c.pts * pointValue).replace("+", "")} ({c.pts}pt)
                </a>
              )}
              {!c.pad && link && c.result === null && <span className="ml-2 text-ink-muted">adds the whole post</span>}
              <div>
                <PlacedControl c={c} pointValue={pointValue} />
              </div>
            </li>
          );
        })}
      </ul>
      {change.error && <p className="mt-1 text-xs text-destructive">{change.error.message}</p>}
    </li>
  );
}

/** What still needs putting on (bets not marked placed that haven't kicked off), and what has been placed and how it is doing. */
function ToPlace({ cards, placed }: { cards: TipmanCard[]; placed: TipmanPlaced }) {
  const [now] = useState(() => Date.now());
  const kickoff = (c: TipmanCard) => c.legs.map((l) => l.kickoff).filter((k): k is string => k !== null).sort()[0] ?? null;
  const todo = cards.filter((c) => !c.placed && c.result === null && (kickoff(c) === null || Date.parse(kickoff(c)!) > now));
  const groups = [...new Map(todo.map((c) => [c.group?.id ?? c.id, c] as const)).entries()].map(([anchor, c]) => ({ anchor, c, n: todo.filter((x) => (x.group?.id ?? x.id) === anchor).length }));
  return (
    <Card title="Have you put them on?" subtitle="Mark each bet once you have, with the stake you used, so nothing is missed or doubled up.">
      {groups.length === 0 ? (
        <p className="text-sm text-ink-muted">Nothing waiting to be placed.</p>
      ) : (
        <ul className="space-y-1.5">
          {groups.map(({ anchor, c, n }) => (
            <li key={anchor} className="flex items-center justify-between gap-2 text-sm">
              <a href={`#${anchor}`} className="min-w-0 truncate text-accent underline underline-offset-2">
                {c.group?.label ?? LABEL[c.category]} · {n} bet{n === 1 ? "" : "s"} to place
              </a>
              <span className="shrink-0 text-xs text-ink-muted">{time(kickoff(c)) && `kicks off ${time(kickoff(c))}`}</span>
            </li>
          ))}
        </ul>
      )}
      {placed.bets > 0 && (
        <p className="mt-3 border-t border-line pt-2 text-xs text-ink-muted">
          You&apos;ve placed {placed.bets} bet{placed.bets === 1 ? "" : "s"}, {signedGbp(placed.staked).replace("+", "")} staked
          {placed.settled > 0 && (
            <>
              {" "}
              · {placed.settled} settled: <span className={tone(placed.profit)}>{signedGbp(placed.profit)}</span> at the advised prices
            </>
          )}
        </p>
      )}
    </Card>
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
  // A notification opens this page at a post (#tg123-group): scroll to it once the bets are on screen.
  const loaded = !!data;
  useEffect(() => {
    if (loaded && window.location.hash) document.getElementById(decodeURIComponent(window.location.hash.slice(1)))?.scrollIntoView({ block: "start" });
  }, [loaded]);
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

      <ToPlace cards={data.cards} placed={data.placed} />

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
              {blocks(data.cards.filter((c) => c.day === day)).map((b) =>
                b.group ? <GroupView key={b.key} cards={b.cards} pointValue={data.pointValue} /> : <CardView key={b.key} c={b.cards[0]!} pointValue={data.pointValue} />,
              )}
            </ul>
          </section>
        ))
      )}
    </div>
  );
}
