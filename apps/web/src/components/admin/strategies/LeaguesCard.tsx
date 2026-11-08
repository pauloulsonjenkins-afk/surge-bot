"use client";

import { useDialog } from "@/components/ui/ConfirmDialog";
import { useSaveSending, type SendingSettings } from "@/queries/use-sending";
import {
  useLeagueForm,
  type FilterBacktest,
  type LeagueFilter,
  type LeagueFormRow,
} from "@/queries/use-league-form";
import { gbp } from "@/lib/format";
import { roiText } from "@/lib/hit-rate";

/**
 * How a strategy does league by league, and which leagues it (or one of its slices) is bet Live in (owner, 8 Nov 2026:
 * "some leagues will perform better than others; build that into the strategies and slices"). The verdicts come from
 * the engine (inplayguru/league-form.ts), worked out hourly on the strategy's priced picks since its rule change.
 */

const FILTERS: Array<[LeagueFilter, string, string]> = [
  ["off", "All leagues", "every league"],
  ["notRed", "Skip red", "every league except the red ones"],
  ["greenOnly", "Green only", "green and proven leagues only"],
];

const LEVEL: Record<LeagueFormRow["level"], { label: string; dot: string }> = {
  proven: { label: "Proven", dot: "bg-hit" },
  green: { label: "Green", dot: "bg-hit/60" },
  grey: { label: "Too few", dot: "bg-ink-muted/40" },
  red: { label: "Red", dot: "bg-loss" },
};

export function LeagueDot({ level }: { level: LeagueFormRow["level"] }) {
  return (
    <span
      role="img"
      aria-label={`${LEVEL[level].label} league`}
      className={`inline-block h-2 w-2 shrink-0 rounded-full ${LEVEL[level].dot}`}
    />
  );
}

function filterOf(
  settings: SendingSettings | undefined,
  key: string,
): LeagueFilter {
  return settings?.leagueFilter?.[key] ?? "off";
}

/**
 * The three-way league filter for a strategy (key = its lower-case name) or a slice ("strategy#slice"). A change asks
 * first: it decides which picks are bet with real money. Picks it leaves out are still recorded, in Sim.
 */
export function LeagueFilterControl({
  filterKey,
  name,
  settings,
  inherited,
}: {
  filterKey: string;
  name: string;
  settings: SendingSettings | undefined;
  inherited?: LeagueFilter;
}) {
  const save = useSaveSending();
  const dialog = useDialog();
  const own = settings?.leagueFilter?.[filterKey] ?? null;
  const current = own ?? inherited ?? "off";
  if (settings && settings.leagueFilter === undefined) return null; // an older engine without the filter

  async function choose(next: LeagueFilter) {
    if (next === current) return;
    const words = FILTERS.find((f) => f[0] === next)![2];
    const ok = await dialog.confirm({
      title:
        next === "off"
          ? `Bet ${name} in every league?`
          : `Bet ${name} Live in ${words}?`,
      tone: "money",
      confirmLabel: next === "off" ? "Bet every league" : "Use this filter",
      body: (
        <p>
          {next === "off"
            ? `${name}'s picks will be bet in any league again, as its Live / Sim switch says.`
            : `${name}'s picks in other leagues will be recorded in Sim instead of bet. A league's colour can change as results come in (worked out hourly), so the leagues bet will change with it.`}
        </p>
      ),
    });
    if (!ok) return;
    // A slice keeps its own "All leagues" (it overrides its strategy's filter); a strategy's is simply cleared.
    save.mutate({
      leagueFilter: {
        [filterKey]: next === "off" && !filterKey.includes("#") ? null : next,
      },
    });
  }

  return (
    <>
      <div
        role="radiogroup"
        aria-label={`Leagues ${name} is bet in`}
        className="grid grid-cols-3 gap-1.5 text-xs"
      >
        {FILTERS.map(([value, label]) => {
          const on = current === value;
          return (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={on}
              disabled={save.isPending || !settings}
              onClick={() => void choose(value)}
              className={`press min-h-10 rounded-md px-2 text-center font-semibold transition-colors ${on ? "bg-accent/15 text-ink" : "bg-surface text-ink-muted hover:text-ink"}`}
            >
              {label}
            </button>
          );
        })}
      </div>
      {own !== null && inherited !== undefined && (
        <button
          type="button"
          disabled={save.isPending}
          onClick={() => save.mutate({ leagueFilter: { [filterKey]: null } })}
          className="mt-1.5 text-xs font-medium text-ink-muted underline-offset-2 hover:text-ink hover:underline"
        >
          Follow the strategy&apos;s leagues
        </button>
      )}
    </>
  );
}

function BacktestRow({
  label,
  b,
  base,
}: {
  label: string;
  b: FilterBacktest;
  base: FilterBacktest;
}) {
  return (
    <tr className="border-t border-line">
      <th scope="row" className="py-1.5 pr-2 text-left font-medium text-ink">
        {label}
      </th>
      <td className="py-1.5 pr-2 text-right tabular-nums">
        {b.n}
        {base.n > 0 && b.n < base.n && (
          <span className="text-ink-muted">
            {" "}
            ({Math.round((b.n / base.n) * 100)}%)
          </span>
        )}
      </td>
      <td
        className={`py-1.5 pr-2 text-right tabular-nums ${b.profit > 0 ? "text-hit" : b.profit < 0 ? "text-loss" : ""}`}
      >
        {gbp(b.profit)}
      </td>
      <td className="py-1.5 text-right tabular-nums">{roiText(b.roi)}</td>
    </tr>
  );
}

function LeagueList({ title, rows }: { title: string; rows: LeagueFormRow[] }) {
  if (rows.length === 0) return null;
  return (
    <div>
      <p className="mb-1 font-medium text-ink-muted">{title}</p>
      <ul className="space-y-1">
        {rows.map((r) => (
          <li key={r.key} className="flex items-center gap-2">
            <LeagueDot level={r.level} />
            <span className="min-w-0 flex-1 truncate text-ink">
              {r.league}
              {r.country && (
                <span className="text-ink-muted"> · {r.country}</span>
              )}
            </span>
            <span className="shrink-0 tabular-nums text-ink-muted">
              {roiText(r.roi)} over {r.n}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** The strategy card's Leagues section: green and red leagues, what each filter would have returned, and the filter. */
export function LeaguesCard({
  strategyKey,
  name,
  settings,
}: {
  strategyKey: string;
  name: string;
  settings: SendingSettings | undefined;
}) {
  const q = useLeagueForm();
  const s = q.data?.strategies[strategyKey];
  if (q.isPending)
    return (
      <div className="h-24 animate-pulse rounded-lg bg-surface-2" aria-hidden />
    );
  if (!q.data || !s) return null;
  const good = s.leagues.filter(
    (l) => l.level === "proven" || l.level === "green",
  );
  const bad = s.leagues.filter((l) => l.level === "red");
  const grey = s.leagues.length - good.length - bad.length;
  const bt = s.backtest;
  const current = filterOf(settings, strategyKey);

  return (
    <section
      aria-label={`${name} by league`}
      className="space-y-3 rounded-lg bg-surface-2 p-3 text-xs"
    >
      <div>
        <p className="font-semibold text-ink">Leagues</p>
        <p className="text-ink-muted">
          Green: {q.data.greenFrom}+ priced picks and in profit after allowing
          for luck. Proven: {q.data.provenFrom}+ and the whole likely range
          above zero. Red: losing by the same tests.{" "}
          {grey > 0 &&
            `${grey} more ${grey === 1 ? "league has" : "leagues have"} too few picks to judge.`}
        </p>
      </div>
      {good.length === 0 && bad.length === 0 && (
        <p className="text-ink-muted">
          No league has enough picks to judge yet.
        </p>
      )}
      <LeagueList title="Doing well" rows={good.slice(0, 8)} />
      <LeagueList title="Losing" rows={bad.slice(0, 8)} />
      {bt && bt.off.n > 0 && (
        <div>
          <p className="mb-1 font-medium text-ink-muted">
            What each filter would have returned
          </p>
          <table className="w-full text-ink-muted">
            <thead>
              <tr>
                <th scope="col" className="sr-only">
                  Filter
                </th>
                <th scope="col" className="pb-1 pr-2 text-right font-normal">
                  Picks
                </th>
                <th scope="col" className="pb-1 pr-2 text-right font-normal">
                  Profit
                </th>
                <th scope="col" className="pb-1 text-right font-normal">
                  Per £1
                </th>
              </tr>
            </thead>
            <tbody>
              {FILTERS.map(([f, label]) => (
                <BacktestRow key={f} label={label} b={bt[f]} base={bt.off} />
              ))}
            </tbody>
          </table>
          <p className="mt-1 text-ink-muted">
            Each pick judged only on its league&apos;s record before it, so no
            hindsight. Live and Sim picks together, at their stakes. With many
            leagues, some look green by luck: trust a filter only if it keeps
            beating &ldquo;All leagues&rdquo;.
          </p>
        </div>
      )}
      <div>
        <p className="mb-1 font-medium text-ink-muted">Bet Live in</p>
        <LeagueFilterControl
          filterKey={strategyKey}
          name={name}
          settings={settings}
        />
        {current !== "off" && (
          <p className="mt-1 text-ink-muted">
            Picks in other leagues are recorded in Sim.
          </p>
        )}
      </div>
    </section>
  );
}
