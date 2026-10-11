"use client";

import { useQuery } from "@tanstack/react-query";
import { getJson } from "@/queries/fetch-json";
import type { PickDetail } from "@/server/engine-client";

const time = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", hour: "2-digit", minute: "2-digit", second: "2-digit" });
const t = (iso: string | null) => (iso ? time.format(new Date(iso)) : null);
const secsBetween = (a: string | null, b: string | null) => (a && b ? Math.max(0, Math.round((Date.parse(b) - Date.parse(a)) / 1000)) : null);

/**
 * The expanded part of a Trade Log pick (admin only): when the alert came and the bet went on, when the goals came,
 * the picture at the alert, and for a miss, how it compared with the strategy's winners.
 */
export function PickDetailPanel({ id, home, away }: { id: number; home: string | null; away: string | null }) {
  const { data, error, isLoading } = useQuery({
    queryKey: ["pick-detail", id],
    queryFn: ({ signal }) => getJson<{ detail: PickDetail }>(`/api/admin/picks/detail?id=${id}`, "the pick's detail", signal),
    staleTime: 5 * 60_000,
  });
  if (isLoading) return <p className="px-3 pb-3 text-xs text-ink-muted">Loading…</p>;
  if (error || !data) return <p className="px-3 pb-3 text-xs text-destructive">{error?.message ?? "Couldn't load the detail."}</p>;
  const d = data.detail;
  const alertAt = d.times.alertAt ?? d.times.receivedAt;
  const matched = d.times.bets.find((b) => (b.matched ?? 0) > 0);
  const placedAt = matched?.placedAt ?? d.times.direct?.placedAt ?? null;
  const side = (s: "home" | "away") => (s === "home" ? (home ?? "Home") : (away ?? "Away"));

  const timeRows: Array<[string, string]> = [];
  timeRows.push(["Alert", `${t(alertAt)}${d.minute !== null ? ` · ${d.minute}'` : ""}${d.scoreAtAlert ? ` · ${d.scoreAtAlert}` : ""}`]);
  if (d.times.sentAt) timeRows.push(["Sent to bet", `${t(d.times.sentAt)} (${secsBetween(alertAt, d.times.sentAt)} s after the alert)`]);
  if (placedAt) {
    const price = matched?.odds ?? d.times.direct?.price ?? null;
    const stake = matched?.matched ?? d.times.direct?.matched ?? null;
    timeRows.push(["Bet on Betfair", `${t(placedAt)} (${secsBetween(alertAt, placedAt)} s)${stake ? ` · £${stake.toFixed(2)}` : ""}${price ? ` @ ${price.toFixed(2)}` : ""}`]);
  } else if (d.times.direct?.reason) timeRows.push(["Direct betting", d.times.direct.reason]);
  if (d.lastGoalBefore) timeRows.push(["Last goal before", d.lastGoalBefore]);

  return (
    <div className="space-y-3 border-t border-line bg-surface-2/40 px-3 py-3 text-xs">
      {d.summary && <p className="text-sm text-ink">{d.summary}</p>}

      <dl className="grid grid-cols-[auto,1fr] gap-x-3 gap-y-1">
        {timeRows.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-ink-muted">{k}</dt>
            <dd className="tabular-nums text-ink">{v}</dd>
          </div>
        ))}
      </dl>

      <div>
        <p className="mb-1 font-medium text-ink-muted">Goals</p>
        {d.goals === null ? (
          <p className="text-ink-muted">{d.goalsNote}</p>
        ) : d.goals.length === 0 ? (
          <p className="text-ink">No goals in the match.</p>
        ) : (
          <ul className="space-y-0.5">
            {d.goals.map((g, i) => (
              <li key={i} className={g.afterAlert ? "text-ink" : "text-ink-muted"}>
                <span className="tabular-nums">
                  {g.minute}
                  {g.extra ? `+${g.extra}` : ""}&apos;
                </span>{" "}
                {side(g.side)}
                {g.kind !== "goal" ? ` (${g.kind})` : ""}
                {g.afterAlert && d.minute !== null ? <span className="text-hit"> · {g.minute - d.minute} min after the alert</span> : null}
              </li>
            ))}
          </ul>
        )}
      </div>

      {d.stats.length > 0 && (
        <div>
          <p className="mb-1 font-medium text-ink-muted">At the alert</p>
          <table className="w-full tabular-nums">
            <thead>
              <tr className="text-ink-muted">
                <th className="text-left font-normal" />
                <th className="w-16 text-right font-normal">{(home ?? "Home").slice(0, 10)}</th>
                <th className="w-16 text-right font-normal">{(away ?? "Away").slice(0, 10)}</th>
              </tr>
            </thead>
            <tbody>
              {d.stats.map((s) => (
                <tr key={s.label}>
                  <td className="text-ink-muted">{s.label}</td>
                  <td className={`text-right ${s.home > s.away ? "font-semibold text-ink" : "text-ink"}`}>{s.home}</td>
                  <td className={`text-right ${s.away > s.home ? "font-semibold text-ink" : "text-ink"}`}>{s.away}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {d.compare.length > 0 && (
        <div>
          <p className="mb-1 font-medium text-ink-muted">Against this strategy&apos;s last 60 days</p>
          <table className="w-full tabular-nums">
            <thead>
              <tr className="text-ink-muted">
                <th className="text-left font-normal" />
                <th className="w-16 text-right font-normal">This pick</th>
                <th className="w-16 text-right font-normal">Winners</th>
                <th className="w-16 text-right font-normal">Losers</th>
              </tr>
            </thead>
            <tbody>
              {d.compare.map((c) => (
                <tr key={c.label}>
                  <td className="text-ink-muted">{c.label === "Momentum" ? "Momentum (stronger side)" : `${c.label} (both)`}</td>
                  <td className="text-right text-ink">{c.pick}</td>
                  <td className="text-right text-hit">{c.winners ?? "–"}</td>
                  <td className="text-right text-loss">{c.losers ?? "–"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
