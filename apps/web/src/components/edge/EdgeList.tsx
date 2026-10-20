"use client";

import { useMemo, useState } from "react";
import type { EdgeCard, EdgeTrend } from "@/lib/members/edge";
import { useShowMore } from "@/components/ui/ShowMore";

const dayFmt = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", weekday: "long", day: "numeric", month: "long" });
const timeFmt = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", hour: "2-digit", minute: "2-digit" });
const dayKey = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" });

const KIND_LABEL: Record<string, string> = { goals: "Goals", btts: "Both score", half: "First half", form: "Form", run: "Run", h2h: "Head-to-head", cards: "Cards" };

const pctOf = (x: number) => `${Math.round(x * 100)}%`;

/** "Betfair 1.85 · needs 55% · Value", or why there is no price. Nothing when the trend has no Betfair bet or isn't priced yet. */
function BetfairLine({ t }: { t: EdgeTrend }) {
  const b = t.betfair;
  if (!b) return null;
  if (b.price === null || b.needed === null || b.edge === null) return <p className="mt-1 text-xs text-ink-muted">Betfair: {b.note ?? "no price yet"}</p>;
  const value = b.edge > 0;
  return (
    <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs tabular-nums text-ink-muted">
      <span>
        Betfair <span className="font-semibold text-ink">{b.price.toFixed(2)}</span> · needs {pctOf(b.needed)} to pay
      </span>
      {value ? (
        <span className="rounded-full bg-accent/15 px-2 py-0.5 font-semibold text-accent">Value +{Math.round(b.edge * 100)} pts</span>
      ) : (
        <span>· priced about right or short</span>
      )}
      <span>· {timeFmt.format(new Date(b.at))}</span>
    </p>
  );
}

/** "9 of last 10" as a bar and the sample, beside the line. */
function Trend({ t, big = false }: { t: EdgeTrend; big?: boolean }) {
  const pct = Math.round(t.rate * 100);
  return (
    <li className={big ? "" : "py-2"}>
      <div className="flex items-baseline justify-between gap-3">
        <span className={`min-w-0 ${big ? "text-base font-semibold text-ink" : "text-sm text-ink"}`}>{t.text}</span>
        <span className={`shrink-0 tabular-nums ${big ? "text-lg font-bold text-accent" : "text-sm font-semibold text-ink"}`}>{pct}%</span>
      </div>
      <div className="mt-1 flex items-center gap-2">
        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-2">
          <div className={`h-full rounded-full ${big ? "bg-accent" : "bg-chart"}`} style={{ width: `${pct}%` }} />
        </div>
        <span className="shrink-0 text-xs tabular-nums text-ink-muted">
          {t.hits} of {t.sample} · {KIND_LABEL[t.kind] ?? t.kind}
        </span>
      </div>
      <BetfairLine t={t} />
    </li>
  );
}

function FixtureCard({ c }: { c: EdgeCard }) {
  const [open, setOpen] = useState(false);
  const f = c.fixture;
  const rest = c.trends.slice(1);
  return (
    <li className={`card-hover rounded-xl border border-line ${open ? "card-open" : "bg-surface"}`}>
      <button type="button" aria-expanded={open} onClick={() => setOpen((v) => !v)} className="w-full p-3.5 text-left">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <span className="text-sm font-semibold text-ink">
            {f.home} <span className="font-normal text-ink-muted">v</span> {f.away}
          </span>
          <span className="text-xs tabular-nums text-ink-muted">
            {timeFmt.format(new Date(f.kickoff))} · {f.country} {f.league}
          </span>
        </div>
        {c.headline ? (
          <ul className="mt-2.5">
            <Trend t={c.headline} big />
          </ul>
        ) : (
          <p className="mt-2 text-xs text-ink-muted">No strong trend for this one: nothing reaches 60% on a fair sample.</p>
        )}
        {rest.length > 0 && <p className="mt-2 text-xs text-accent">{open ? "Hide" : `${rest.length} more trend${rest.length === 1 ? "" : "s"}`}</p>}
      </button>
      {open && rest.length > 0 && (
        <ul className="divide-y divide-line border-t border-line px-3.5 pb-2">
          {rest.map((t) => (
            <Trend key={t.text} t={t} />
          ))}
        </ul>
      )}
    </li>
  );
}

/**
 * The ten strongest trends across every fixture kicking off in the next 24 hours, one per match, ranked by strength
 * (the hit rate once its sample is allowed for, so "45 of 50" beats "9 of 10").
 */
function TopTen({ cards }: { cards: EdgeCard[] }) {
  // The page's own clock, read once per render of the list; the cards themselves change only every few hours.
  const [now] = useState(() => Date.now());
  const top = useMemo(
    () =>
      cards
        .filter((c) => c.headline && Date.parse(c.fixture.kickoff) >= now && Date.parse(c.fixture.kickoff) <= now + 24 * 3_600_000)
        .sort((a, b) => b.headline!.strength - a.headline!.strength)
        .slice(0, 10),
    [cards, now],
  );
  if (top.length === 0) return null;
  return (
    <section className="rounded-xl border border-accent/40 bg-surface p-3.5">
      <h2 className="text-base font-semibold text-ink">Top {top.length} for the next 24 hours</h2>
      <p className="mt-0.5 text-xs text-ink-muted">The strongest trend in each match, across every fixture kicking off in the next 24 hours, ranked by how often it has happened once its sample is allowed for.</p>
      <ol className="mt-3 divide-y divide-line">
        {top.map((c, i) => {
          const t = c.headline!;
          return (
            <li key={`${c.fixture.div}-${c.fixture.home}-${c.fixture.away}`} className="flex items-start gap-3 py-2.5">
              <span className="mt-0.5 w-5 shrink-0 text-right text-sm font-bold tabular-nums text-accent">{i + 1}</span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium text-ink">{t.text}</span>
                <span className="block text-xs text-ink-muted">
                  {c.fixture.home} v {c.fixture.away} · {timeFmt.format(new Date(c.fixture.kickoff))} · {c.fixture.country} {c.fixture.league}
                </span>
                <BetfairLine t={t} />
              </span>
              <span className="shrink-0 text-right">
                <span className="block text-sm font-bold tabular-nums text-ink">{Math.round(t.rate * 100)}%</span>
                <span className="block text-xs tabular-nums text-ink-muted">
                  {t.hits} of {t.sample}
                </span>
              </span>
            </li>
          );
        })}
      </ol>
      <p className="mt-2 text-xs text-ink-muted">How often it has happened, not a guarantee: bookmakers price the obvious trends too, so check the price is worth it.</p>
    </section>
  );
}

/**
 * Trends whose cautious hit rate beats what the Betfair price needs after commission, across every fixture in the next
 * 24 hours, ranked by that margin. Up to 10, and at most two per match.
 */
function BestValue({ cards }: { cards: EdgeCard[] }) {
  const [now] = useState(() => Date.now());
  const rows = useMemo(() => {
    const out: { c: EdgeCard; t: EdgeTrend }[] = [];
    for (const c of cards) {
      const k = Date.parse(c.fixture.kickoff);
      if (k < now || k > now + 24 * 3_600_000) continue;
      c.trends
        .filter((t) => (t.betfair?.edge ?? 0) > 0)
        .sort((a, b) => b.betfair!.edge! - a.betfair!.edge!)
        .slice(0, 2)
        .forEach((t) => out.push({ c, t }));
    }
    return out.sort((a, b) => b.t.betfair!.edge! - a.t.betfair!.edge!).slice(0, 10);
  }, [cards, now]);
  const priced = cards.some((c) => c.trends.some((t) => t.betfair));
  if (!priced) return null;
  return (
    <section className="rounded-xl border border-line bg-surface p-3.5">
      <h2 className="text-base font-semibold text-ink">Best value on Betfair (next 24 hours)</h2>
      <p className="mt-0.5 text-xs text-ink-muted">
        Where the trend&apos;s cautious hit rate is above what Betfair&apos;s current back price needs to pay after 2% commission. Prices are read every two hours; check the live price before you bet.
      </p>
      {rows.length === 0 ? (
        <p className="mt-3 text-sm text-ink-muted">Nothing right now: Betfair has every strong trend priced at or below what its history suggests.</p>
      ) : (
        <ol className="mt-3 divide-y divide-line">
          {rows.map(({ c, t }, i) => (
            <li key={`${c.fixture.div}-${c.fixture.home}-${c.fixture.away}-${t.text}`} className="flex items-start gap-3 py-2.5">
              <span className="mt-0.5 w-5 shrink-0 text-right text-sm font-bold tabular-nums text-accent">{i + 1}</span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium text-ink">{t.text}</span>
                <span className="block text-xs text-ink-muted">
                  {c.fixture.home} v {c.fixture.away} · {timeFmt.format(new Date(c.fixture.kickoff))} · {c.fixture.country} {c.fixture.league}
                </span>
              </span>
              <span className="shrink-0 text-right">
                <span className="block text-sm font-bold tabular-nums text-ink">{t.betfair!.price!.toFixed(2)}</span>
                <span className="block text-xs tabular-nums text-accent">+{Math.round(t.betfair!.edge! * 100)} pts</span>
              </span>
            </li>
          ))}
        </ol>
      )}
      <p className="mt-2 text-xs text-ink-muted">
        Value here means the price looks generous against past results, not that the bet will win. Read-only: GoalBrew never bets on these.
      </p>
    </section>
  );
}

/**
 * The single best opportunity kicking off within the next `hours`: the trend that beats its Betfair price by the most,
 * or, when nothing is priced as value, the strongest trend. For the admin's Today page.
 */
export function TopOpportunity({ cards, hours = 6 }: { cards: EdgeCard[]; hours?: number }) {
  const [now] = useState(() => Date.now());
  const best = useMemo(() => {
    const soon = cards.filter((c) => {
      const k = Date.parse(c.fixture.kickoff);
      return k >= now && k <= now + hours * 3_600_000;
    });
    let value: { c: EdgeCard; t: EdgeTrend } | null = null;
    for (const c of soon) for (const t of c.trends) if ((t.betfair?.edge ?? 0) > 0 && (!value || t.betfair!.edge! > value.t.betfair!.edge!)) value = { c, t };
    if (value) return { ...value, isValue: true };
    const strongest = soon.filter((c) => c.headline).sort((a, b) => b.headline!.strength - a.headline!.strength)[0];
    return strongest ? { c: strongest, t: strongest.headline!, isValue: false } : null;
  }, [cards, now, hours]);
  if (!best) return <p className="text-sm text-ink-muted">No fixtures with a strong trend in the next {hours} hours.</p>;
  const { c, t, isValue } = best;
  return (
    <div>
      <p className="text-xs text-ink-muted">{isValue ? "Best value on Betfair" : "Strongest trend (nothing priced as value right now)"}</p>
      <div className="mt-1 flex items-start justify-between gap-3">
        <span className="min-w-0">
          <span className="block text-sm font-semibold text-ink">{t.text}</span>
          <span className="block text-xs text-ink-muted">
            {c.fixture.home} v {c.fixture.away} · {timeFmt.format(new Date(c.fixture.kickoff))} · {c.fixture.country} {c.fixture.league}
          </span>
        </span>
        <span className="shrink-0 text-right">
          <span className="block text-lg font-bold tabular-nums text-accent">{pctOf(t.rate)}</span>
          <span className="block text-xs tabular-nums text-ink-muted">
            {t.hits} of {t.sample}
          </span>
        </span>
      </div>
      <BetfairLine t={t} />
    </div>
  );
}

/**
 * The Edge fixture list (shared by Members > Fixtures and the admin's Fixtures page): a league filter, then each day's
 * fixtures with their headline trend, opening to the ranked trends.
 */
/** One day's fixture cards, 12 at a time: all three days' cards made the page about 13,000 px tall on a phone. */
function DaySection({ cards, league }: { cards: EdgeCard[]; league: string }) {
  const { shown, more } = useShowMore(cards, 12, league);
  return (
    <section className="space-y-2">
      <h2 className="text-sm font-semibold text-ink">{dayFmt.format(new Date(cards[0]!.fixture.kickoff))}</h2>
      <ul className="space-y-2">
        {shown.map((c) => (
          <FixtureCard key={`${c.fixture.div}-${c.fixture.home}-${c.fixture.away}`} c={c} />
        ))}
        {more && <li>{more}</li>}
      </ul>
    </section>
  );
}

export function EdgeList({ cards }: { cards: EdgeCard[] }) {
  const [league, setLeague] = useState("all");
  const leagues = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of cards) m.set(c.fixture.div, `${c.fixture.country} ${c.fixture.league}`);
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [cards]);
  const days = useMemo(() => {
    const out = new Map<string, EdgeCard[]>();
    for (const c of cards) {
      if (league !== "all" && c.fixture.div !== league) continue;
      const k = dayKey.format(new Date(c.fixture.kickoff));
      (out.get(k) ?? out.set(k, []).get(k)!).push(c);
    }
    return [...out.entries()];
  }, [cards, league]);
  if (cards.length === 0) return <p className="text-sm text-ink-muted">No fixtures in the next 48 hours yet. Cards appear as fixtures are announced.</p>;
  const data = { cards };
  return (
    <>
      <TopTen cards={cards} />
      <BestValue cards={cards} />
          {leagues.length > 1 && (
            <label className="flex items-center gap-2 text-xs text-ink-muted">
              League
              <select value={league} onChange={(e) => setLeague(e.target.value)} className="rounded-md border border-line bg-surface-2 px-2.5 py-1.5 text-sm text-ink">
                <option value="all">All leagues ({data.cards.length})</option>
                {leagues.map(([div, name]) => (
                  <option key={div} value={div}>
                    {name}
                  </option>
                ))}
              </select>
            </label>
          )}
          {days.map(([day, cards]) => (
            <DaySection key={day} cards={cards} league={league} />
          ))}
          <p className="text-xs text-ink-muted">
            Trends describe what has happened, not what will: past results don&apos;t guarantee future ones. 18+. Bet only what you can afford to lose.
            Results data: football-data.co.uk.
          </p>
    </>
  );
}
