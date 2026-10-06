"use client";

import { useEffect, useState } from "react";
import { Skeleton } from "@/components/ui/Skeleton";
import { Card, PageHeader } from "@/components/ui/Card";
import { QueryError } from "@/components/ui/QueryError";
import { useSaveSending, useSending, type SendingSettings } from "@/queries/use-sending";
import { useDialog } from "@/components/ui/ConfirmDialog";
import { NotPlacedCard } from "@/components/admin/NotPlacedCard";
import { NotificationsCard } from "@/components/admin/NotificationsCard";
import { useStrategyNames } from "@/queries/use-strategy-names";
import Link from "next/link";
import { useDirect } from "@/queries/use-direct";
import { Activity, Limits, ModeCard, Readiness } from "@/components/admin/DirectBetting";

const whenFmt = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  timeZone: "Europe/London",
});

interface Form {
  maxStake: string;
  maxAgeMinutes: string;
  dailyCap: string;
  bttsMarketType: string;
  bttsSelection: string;
  underdogMarketType: string;
  underdogHomeSelection: string;
  underdogAwaySelection: string;
  favouriteMarketType: string;
  favouriteHomeSelection: string;
  favouriteAwaySelection: string;
  firstHalfGoalsMarketType: string;
  firstHalfGoalsSelection: string;
  firstHalfCornersMarketType: string;
  firstHalfCornersSelection: string;
  aliases: string;
  favouriteScoresHomeMarketType: string;
  favouriteScoresAwayMarketType: string;
  favouriteScoresSelection: string;
}

function toForm(s: SendingSettings): Form {
  return {
    maxStake: String(s.maxStake),
    maxAgeMinutes: String(s.maxAgeMinutes),
    dailyCap: String(s.dailyCap),
    bttsMarketType: s.bttsMarketType,
    bttsSelection: s.bttsSelection,
    underdogMarketType: s.underdogMarketType,
    underdogHomeSelection: s.underdogHomeSelection,
    underdogAwaySelection: s.underdogAwaySelection,
    favouriteMarketType: s.favouriteMarketType,
    favouriteHomeSelection: s.favouriteHomeSelection,
    favouriteAwaySelection: s.favouriteAwaySelection,
    firstHalfGoalsMarketType: s.firstHalfGoalsMarketType,
    firstHalfGoalsSelection: s.firstHalfGoalsSelection,
    firstHalfCornersMarketType: s.firstHalfCornersMarketType ?? "",
    firstHalfCornersSelection: s.firstHalfCornersSelection ?? "Over {line} Corners",
    favouriteScoresHomeMarketType: s.favouriteScoresHomeMarketType ?? "",
    favouriteScoresAwayMarketType: s.favouriteScoresAwayMarketType ?? "",
    favouriteScoresSelection: s.favouriteScoresSelection ?? "Over {line} Goals",
    aliases: s.aliases,
  };
}

const inputCls = "w-full rounded-md border border-line bg-surface-2 px-3 py-2 text-sm text-ink";

type SettingsTab = "limits" | "names" | "wording";
const SETTINGS_TABS: Array<{ id: SettingsTab; label: string }> = [
  { id: "limits", label: "Safety limits" },
  { id: "names", label: "Match names" },
  { id: "wording", label: "Bet wording" },
];

const SENDABLE = new Set(["OVER_1_5", "NEXT_GOAL", "BOTH_TEAMS_TO_SCORE", "UNDERDOG_DOUBLE_CHANCE", "FAVOURITE_TO_WIN", "FIRST_HALF_GOALS"]);

export default function SendingPage() {
  const { data, isLoading, error } = useSending();
  const save = useSaveSending();
  const dialog = useDialog();
  const strategyNames = useStrategyNames();
  const direct = useDirect();
  const [form, setForm] = useState<Form | null>(null);
  const [saved, setSaved] = useState(false);
  // Which settings tab is showing.
  const [tab, setTab] = useState<SettingsTab>("limits");

  // Fill the form once. Later refreshes must not overwrite what is being typed.
  useEffect(() => {
    if (data && form === null) setForm(toForm(data.settings));
  }, [data, form]);

  if (error) return <QueryError error={error} next="/more/admin/sending" />;
  if (isLoading || !data || !form) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-28 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  const { settings } = data;

  async function toggleMaster() {
    const turningOn = !settings.enabled;
    if (turningOn) {
      const live = data!.strategies.filter((x) => x.enabled);
      const perDay = live.reduce((most, x) => Math.max(most, x.stake ?? 0), 0) * settings.dailyCap;
      const ok = await dialog.confirm({
        title: "Turn betting on?",
        tone: "money",
        confirmLabel: live.length === 0 ? "Turn betting on" : `Start betting ${live.length} Live strateg${live.length === 1 ? "y" : "ies"}`,
        details: [
          { label: "Live strategies", value: live.length === 0 ? "None yet" : live.map((x) => `${strategyNames.name(x.label)} £${x.stake?.toFixed(2) ?? "–"}`).join(", ") },
          { label: "Daily limit", value: `${settings.dailyCap} new bets` },
          { label: "Most staked in a day", value: perDay > 0 ? `up to £${perDay.toFixed(2)}` : "–" },
          { label: "Highest stake allowed", value: `£${settings.maxStake.toFixed(2)}` },
        ],
        body: <p>New picks from Live strategies are bet on Betfair, at each strategy’s own stake.</p>,
      });
      if (!ok) return;
    }
    save.mutate({ enabled: turningOn });
  }

  function saveLimits() {
    save.mutate(
      {
        maxStake: Number(form!.maxStake),
        maxAgeMinutes: Number(form!.maxAgeMinutes),
        dailyCap: Number(form!.dailyCap),
        bttsMarketType: form!.bttsMarketType,
        bttsSelection: form!.bttsSelection,
        underdogMarketType: form!.underdogMarketType,
        underdogHomeSelection: form!.underdogHomeSelection,
        underdogAwaySelection: form!.underdogAwaySelection,
        favouriteMarketType: form!.favouriteMarketType,
        favouriteHomeSelection: form!.favouriteHomeSelection,
        favouriteAwaySelection: form!.favouriteAwaySelection,
        firstHalfGoalsMarketType: form!.firstHalfGoalsMarketType,
        firstHalfGoalsSelection: form!.firstHalfGoalsSelection,
        firstHalfCornersMarketType: form!.firstHalfCornersMarketType,
        firstHalfCornersSelection: form!.firstHalfCornersSelection,
        favouriteScoresHomeMarketType: form!.favouriteScoresHomeMarketType,
        favouriteScoresAwayMarketType: form!.favouriteScoresAwayMarketType,
        favouriteScoresSelection: form!.favouriteScoresSelection,
        aliases: form!.aliases,
      },
      {
        onSuccess: (d) => {
          setForm(toForm(d.settings));
          setSaved(true);
          setTimeout(() => setSaved(false), 2500);
        },
      },
    );
  }

  const settingsDirty = JSON.stringify(form) !== JSON.stringify(toForm(settings));
  const onCount = data.strategies.filter((s) => s.enabled).length;
  const stoppedCount = data.strategies.filter((s) => s.stopLoss?.stopped).length;

  return (
    <div className="space-y-3">
      <PageHeader as="h2" title="Sending" subtitle="Betting on or off, how bets are placed on Betfair, and the limits and wording that apply to every strategy." />

      {save.error && <p className="text-sm text-destructive">{save.error.message}</p>}

      {/* 1. Status: the one thing that matters most, always at the top. */}
      <section
        className={`rounded-xl border p-3.5 ${settings.enabled ? "border-hit/40 bg-surface" : "border-line bg-surface"}`}
        aria-label="Sending status"
      >
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-medium text-ink">{settings.enabled ? "Betting is ON" : "Betting is OFF"}</p>
            <p className="mt-0.5 text-xs text-ink-muted">
              {settings.enabled ? `${onCount} of ${data.strategies.length} strategies Live` : "Nothing is bet while this is off, so every strategy runs as Sim."}
              {stoppedCount > 0 && <span className="text-warn"> · {stoppedCount} stopped by stop loss today</span>}
            </p>
          </div>
          <button
            type="button"
            onClick={() => void toggleMaster()}
            disabled={save.isPending}
            className={`shrink-0 rounded-md px-3 py-2 text-sm font-medium ${
              settings.enabled ? "border border-line text-ink" : "bg-accent text-accent-ink"
            } disabled:opacity-50`}
          >
            {settings.enabled ? "Turn off" : "Turn on"}
          </button>
        </div>
      </section>

      {direct.data && (
        <>
          <ModeCard data={direct.data} />
          <Readiness data={direct.data} />
        </>
      )}

      {/* Sent picks with no bet on Betfair 3 minutes on: only shown when there are some. */}
      <NotPlacedCard />

      {/* 2. Each strategy's Live / Sim switch, stake, minimum odds and stop loss are on Strategies. */}
      <Card
        title="Strategies"
        subtitle="Each strategy's Live / Sim switch, stake, minimum odds and stop loss sit with its results on the Strategies page."
        actions={
          <Link href="/more/admin/strategies" className="text-xs font-medium text-accent">
            Open Strategies
          </Link>
        }
      >
        {data.strategies.length === 0 ? (
          <p className="text-xs text-ink-muted">Strategies appear as picks arrive.</p>
        ) : (
          <ul className="space-y-1 text-sm">
            {data.strategies
              .filter((s) => s.enabled)
              .map((s) => (
                <li key={s.label} className="flex items-center justify-between gap-2">
                  <span className="min-w-0 truncate text-ink">{strategyNames.full(s.label)}</span>
                  <span className="shrink-0 text-xs text-ink-muted">
                    {s.stopLoss?.stopped ? <span className="text-warn">Stopped today · </span> : null}Live · £{s.stake?.toFixed(2) ?? "–"}
                  </span>
                </li>
              ))}
            {onCount === 0 && <li className="text-xs text-ink-muted">No strategy is Live: every one runs in Sim.</li>}
          </ul>
        )}
      </Card>

      {/* 3. What is happening right now. */}
      <Card
        title="What would be bet now"
        subtitle={settings.enabled ? "Picks waiting to be bet at this moment." : "Betting is off, so nothing is waiting. This shows what the checks would do."}
      >
        {data.preview.rows.length === 0 ? (
          <p className="text-xs text-ink-muted">Nothing right now.</p>
        ) : (
          <ul className="space-y-2">
            {data.preview.rows.map((r) => (
              <li key={r.pickId} className="rounded-md bg-surface-2 px-3 py-2 text-xs">
                <p className="font-medium text-ink">{r.eventName}</p>
                <p className="text-ink-muted">
                  {strategyNames.name(r.provider)}
                  {strategyNames.name(r.provider) !== r.provider && <> ({r.provider})</>} · {r.selectionName} · £{r.stake.toFixed(2)}
                  {r.minPrice !== null ? ` · min odds ${r.minPrice.toFixed(2)}` : ""} · <span className="font-mono">{r.marketType}</span>
                </p>
              </li>
            ))}
          </ul>
        )}
        {data.preview.skipped.length > 0 && (
          <details className="mt-3">
            <summary className="cursor-pointer text-xs font-medium text-ink-muted">Held back ({data.preview.skipped.length})</summary>
            <ul className="mt-1 space-y-1">
              {data.preview.skipped.map((k) => (
                <li key={k.pickId} className="text-xs text-ink-muted">
                  <span className="text-ink">{k.match}</span> — {k.reason}
                </li>
              ))}
            </ul>
          </details>
        )}
      </Card>

      {direct.data && (
        <>
          <Activity bets={direct.data.bets} />
          <Limits data={direct.data} />
        </>
      )}

      {/* Push notifications for picks not placed, per device. */}
      <NotificationsCard />

      {/* 4. Settings you rarely change, in tabs at the bottom. */}
      <section className="rounded-xl border border-line bg-surface p-3.5">
        <h2 className="text-sm font-medium text-ink">Sending settings</h2>
        <p className="mt-0.5 text-xs text-ink-muted">Settings that apply to every strategy. You rarely need to change these.</p>

        <div role="tablist" aria-label="Sending settings" className="mt-3 grid grid-cols-3 gap-0.5 rounded-lg border border-line bg-surface-2 p-0.5">
          {SETTINGS_TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              onClick={() => setTab(t.id)}
              className={`rounded-md px-1 py-1.5 text-xs font-medium leading-tight transition-colors sm:text-xs ${
                tab === t.id ? "bg-accent text-accent-ink" : "text-ink-muted hover:text-ink"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="mt-3" role="tabpanel">
          {tab === "limits" && (
            <div className="grid grid-cols-2 gap-3">
              <label className="col-span-2 text-xs text-ink-muted">
                Highest stake allowed (£). Nothing above this is ever sent.
                <input
                  inputMode="decimal"
                  className={`${inputCls} mt-1`}
                  value={form.maxStake}
                  onChange={(e) => setForm({ ...form, maxStake: e.target.value })}
                />
              </label>
              <label className="text-xs text-ink-muted">
                Ignore picks older than (minutes)
                <input
                  inputMode="numeric"
                  className={`${inputCls} mt-1`}
                  value={form.maxAgeMinutes}
                  onChange={(e) => setForm({ ...form, maxAgeMinutes: e.target.value })}
                />
                <span className="mt-1 block">Pre-match picks (First Half Goal) can be bet until kick-off instead.</span>
              </label>
              <label className="text-xs text-ink-muted">
                Most new picks per day
                <input
                  inputMode="numeric"
                  className={`${inputCls} mt-1`}
                  value={form.dailyCap}
                  onChange={(e) => setForm({ ...form, dailyCap: e.target.value })}
                />
              </label>
            </div>
          )}

          {tab === "names" && (
            <>
              <p className="mb-2 text-xs text-ink-muted">
                If your betting software can&apos;t find a match, the team name in the alert differs from Betfair&apos;s. Fix it here, one per line:{" "}
                <span className="font-mono text-ink">alert name = Betfair name</span>.
              </p>
              <textarea
                rows={6}
                className={`${inputCls} font-mono text-xs`}
                placeholder={"OHiggins = O'Higgins"}
                value={form.aliases}
                onChange={(e) => setForm({ ...form, aliases: e.target.value })}
              />
            </>
          )}

          {tab === "wording" && (
            <div className="space-y-4">
              <p className="text-xs text-ink-muted">
                How each bet type is named for Betfair. Only change these to match what Betfair shows. {"{home}"} and {"{away}"} become the team
                names. Over goals bets need no wording.
              </p>
              <div>
                <p className="text-xs font-medium text-ink">Both teams to score</p>
                <div className="mt-2 grid grid-cols-2 gap-3">
                  <label className="text-xs text-ink-muted">
                    Market code
                    <input className={`${inputCls} mt-1 font-mono text-xs`} value={form.bttsMarketType} onChange={(e) => setForm({ ...form, bttsMarketType: e.target.value })} />
                  </label>
                  <label className="text-xs text-ink-muted">
                    Selection
                    <input className={`${inputCls} mt-1 font-mono text-xs`} value={form.bttsSelection} onChange={(e) => setForm({ ...form, bttsSelection: e.target.value })} />
                  </label>
                </div>
              </div>
              <div>
                <p className="text-xs font-medium text-ink">Underdog win or draw</p>
                <p className="mt-0.5 text-xs text-ink-muted">Double Chance on the side with the longer pre-match price.</p>
                <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <label className="text-xs text-ink-muted">
                    Market code
                    <input className={`${inputCls} mt-1 font-mono text-xs`} value={form.underdogMarketType} onChange={(e) => setForm({ ...form, underdogMarketType: e.target.value })} />
                  </label>
                  <label className="text-xs text-ink-muted">
                    Home underdog
                    <input className={`${inputCls} mt-1 font-mono text-xs`} value={form.underdogHomeSelection} onChange={(e) => setForm({ ...form, underdogHomeSelection: e.target.value })} />
                  </label>
                  <label className="text-xs text-ink-muted">
                    Away underdog
                    <input className={`${inputCls} mt-1 font-mono text-xs`} value={form.underdogAwaySelection} onChange={(e) => setForm({ ...form, underdogAwaySelection: e.target.value })} />
                  </label>
                </div>
              </div>
              <div>
                <p className="text-xs font-medium text-ink">Favourite to win</p>
                <p className="mt-0.5 text-xs text-ink-muted">Match Odds on the side with the shorter live price in the alert.</p>
                <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <label className="text-xs text-ink-muted">
                    Market code
                    <input className={`${inputCls} mt-1 font-mono text-xs`} value={form.favouriteMarketType} onChange={(e) => setForm({ ...form, favouriteMarketType: e.target.value })} />
                  </label>
                  <label className="text-xs text-ink-muted">
                    Home favourite
                    <input className={`${inputCls} mt-1 font-mono text-xs`} value={form.favouriteHomeSelection} onChange={(e) => setForm({ ...form, favouriteHomeSelection: e.target.value })} />
                  </label>
                  <label className="text-xs text-ink-muted">
                    Away favourite
                    <input className={`${inputCls} mt-1 font-mono text-xs`} value={form.favouriteAwaySelection} onChange={(e) => setForm({ ...form, favouriteAwaySelection: e.target.value })} />
                  </label>
                </div>
              </div>
              <div>
                <p className="text-xs font-medium text-ink">1st half goals (pre-match)</p>
                <p className="mt-0.5 text-xs text-ink-muted">Over 0.5 goals in the first half, backed when a &ldquo;First Half Goal&rdquo; alert arrives before kick-off.</p>
                <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <label className="text-xs text-ink-muted">
                    Market code
                    <input className={`${inputCls} mt-1 font-mono text-xs`} value={form.firstHalfGoalsMarketType} onChange={(e) => setForm({ ...form, firstHalfGoalsMarketType: e.target.value })} />
                  </label>
                  <label className="text-xs text-ink-muted">
                    Selection name
                    <input className={`${inputCls} mt-1 font-mono text-xs`} value={form.firstHalfGoalsSelection} onChange={(e) => setForm({ ...form, firstHalfGoalsSelection: e.target.value })} />
                  </label>
                </div>
              </div>
              <div>
                <p className="text-xs font-medium text-ink">Favourite to score again (Pass Master 1st half)</p>
                <p className="mt-0.5 text-xs text-ink-muted">
                  The favourite&rsquo;s own goals Over (its goals at the alert + 0.5), by full time. <code>{"{line}"}</code> becomes the line (1.5) and{" "}
                  <code>{"{line10}"}</code> ten times it in two digits (15, or 05 for 0.5). Copy the codes from &ldquo;Team goal markets on Betfair&rdquo; on the Reconcile page.
                  Leave a code empty and it stays in Sim.
                </p>
                <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <label className="text-xs text-ink-muted">
                    Code when the favourite is at home
                    <input placeholder="Not set" className={`${inputCls} mt-1 font-mono text-xs`} value={form.favouriteScoresHomeMarketType} onChange={(e) => setForm({ ...form, favouriteScoresHomeMarketType: e.target.value })} />
                  </label>
                  <label className="text-xs text-ink-muted">
                    Code when the favourite is away
                    <input placeholder="Not set" className={`${inputCls} mt-1 font-mono text-xs`} value={form.favouriteScoresAwayMarketType} onChange={(e) => setForm({ ...form, favouriteScoresAwayMarketType: e.target.value })} />
                  </label>
                  <label className="text-xs text-ink-muted">
                    Selection name
                    <input className={`${inputCls} mt-1 font-mono text-xs`} value={form.favouriteScoresSelection} onChange={(e) => setForm({ ...form, favouriteScoresSelection: e.target.value })} />
                  </label>
                </div>
              </div>
              <div>
                <p className="text-xs font-medium text-ink">1st half corners (First Half Corner Race)</p>
                <p className="mt-0.5 text-xs text-ink-muted">
                  One more corner before half-time: first-half corners Over the corners so far + 0.5. <code>{"{line}"}</code> becomes the line
                  (5.5) and <code>{"{line10}"}</code> ten times it in two digits (55). Copy the code and wording from &ldquo;Corner markets on Betfair&rdquo; on the
                  Reconcile page. Leave the code empty and it stays in Sim.
                </p>
                <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <label className="text-xs text-ink-muted">
                    Market code
                    <input placeholder="Not set" className={`${inputCls} mt-1 font-mono text-xs`} value={form.firstHalfCornersMarketType} onChange={(e) => setForm({ ...form, firstHalfCornersMarketType: e.target.value })} />
                  </label>
                  <label className="text-xs text-ink-muted">
                    Selection name
                    <input className={`${inputCls} mt-1 font-mono text-xs`} value={form.firstHalfCornersSelection} onChange={(e) => setForm({ ...form, firstHalfCornersSelection: e.target.value })} />
                  </label>
                </div>
              </div>
            </div>
          )}

        </div>

        {(
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={saveLimits}
              disabled={save.isPending || !settingsDirty}
              className="rounded-md bg-accent px-3 py-2 text-sm font-medium text-accent-ink disabled:opacity-50"
            >
              {save.isPending ? "Saving…" : saved ? "Saved" : "Save changes"}
            </button>
            {settingsDirty && (
              <>
                <button
                  type="button"
                  onClick={() => setForm(toForm(settings))}
                  disabled={save.isPending}
                  className="rounded-md border border-line px-3 py-2 text-sm text-ink disabled:opacity-50"
                >
                  Undo
                </button>
                <span className="text-xs text-ink-muted">Unsaved changes (saving covers all tabs)</span>
              </>
            )}
          </div>
        )}
      </section>
    </div>
  );
}

/** When direct betting is on, say so here: in Live the betting software is handed nothing new. */
