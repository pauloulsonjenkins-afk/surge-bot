"use client";

import { useMemo, useState } from "react";
import { PageHeader } from "@/components/ui/Card";
import { Skeleton } from "@/components/ui/Skeleton";
import { LockedFeature } from "@/components/members/ui";
import { useMembersEdge, useMembersMe } from "@/queries/use-members";
import type { EdgeCard, EdgeTrend } from "@/lib/members/edge";

const dayFmt = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", weekday: "long", day: "numeric", month: "long" });
const timeFmt = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", hour: "2-digit", minute: "2-digit" });
const dayKey = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" });

const KIND_LABEL: Record<string, string> = { goals: "Goals", btts: "Both score", half: "First half", form: "Form", run: "Run", h2h: "Head-to-head", cards: "Cards" };

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
 * Edge: a pre-match card for each fixture in the next 48 hours. Worked out from past results a few times a day, never
 * per view. Trends are ranked by how strong they are once their sample is allowed for, and each shows its sample.
 */
export default function FixturesPage() {
  const me = useMembersMe();
  const { data, isLoading } = useMembersEdge();
  const [league, setLeague] = useState("all");

  const leagues = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of data?.cards ?? []) m.set(c.fixture.div, `${c.fixture.country} ${c.fixture.league}`);
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [data]);

  const days = useMemo(() => {
    const out = new Map<string, EdgeCard[]>();
    for (const c of data?.cards ?? []) {
      if (league !== "all" && c.fixture.div !== league) continue;
      const k = dayKey.format(new Date(c.fixture.kickoff));
      (out.get(k) ?? out.set(k, []).get(k)!).push(c);
    }
    return [...out.entries()];
  }, [data, league]);

  if (isLoading || !data || !me.data) return <Skeleton className="h-96 w-full" />;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Fixtures · Edge"
        subtitle="The strongest trends for every match in the next 48 hours, from each side's recent results and past meetings. Every line shows its sample, so you can see how much it rests on."
      />

      {data.locked ? (
        <LockedFeature
          me={me.data}
          feature="edge"
          title={`Edge insights for ${data.count ?? 0} upcoming fixture${data.count === 1 ? "" : "s"}`}
          pitch="See the headline trend for every match, plus goals, both-teams-to-score, form, runs, head-to-head and cards, each with its sample."
        />
      ) : data.cards.length === 0 ? (
        <p className="text-sm text-ink-muted">No fixtures in the next 48 hours yet. Cards appear as fixtures are announced.</p>
      ) : (
        <>
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
            <section key={day} className="space-y-2">
              <h2 className="text-sm font-semibold text-ink">{dayFmt.format(new Date(cards[0]!.fixture.kickoff))}</h2>
              <ul className="space-y-2">
                {cards.map((c) => (
                  <FixtureCard key={`${c.fixture.div}-${c.fixture.home}-${c.fixture.away}`} c={c} />
                ))}
              </ul>
            </section>
          ))}
          <p className="text-xs text-ink-muted">
            Trends describe what has happened, not what will: past results don&apos;t guarantee future ones. 18+. Bet only what you can afford to lose.
            Results data: football-data.co.uk.
          </p>
        </>
      )}
    </div>
  );
}
