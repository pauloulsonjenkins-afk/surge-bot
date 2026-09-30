"use client";

import { useEffect, useState } from "react";
import { Skeleton } from "@/components/ui/Skeleton";
import { Card, PageHeader } from "@/components/ui/Card";
import { QueryError } from "@/components/ui/QueryError";
import { marketName } from "@/lib/markets";
import { StopLossControls } from "@/components/admin/StopLossControls";
import { useSaveSending, useSending, type SendingSettings } from "@/queries/use-sending";
import { useDeleteStrategyFlow } from "@/components/admin/useDeleteStrategyFlow";

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
  aliases: string;
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
    aliases: s.aliases,
  };
}

const inputCls = "w-full rounded-md border border-line bg-surface-2 px-3 py-2 text-sm text-ink";

type SettingsTab = "limits" | "names" | "wording" | "feed";
const SETTINGS_TABS: Array<{ id: SettingsTab; label: string }> = [
  { id: "limits", label: "Safety limits" },
  { id: "names", label: "Match names" },
  { id: "wording", label: "Bet wording" },
  { id: "feed", label: "Feed" },
];

const SENDABLE = new Set(["NEXT_GOAL", "BOTH_TEAMS_TO_SCORE", "UNDERDOG_DOUBLE_CHANCE", "FAVOURITE_TO_WIN"]);

export default function SendingPage() {
  const { data, isLoading, error } = useSending();
  const save = useSaveSending();
  const remove = useDeleteStrategyFlow();
  const [form, setForm] = useState<Form | null>(null);
  const [saved, setSaved] = useState(false);
  // What has been typed into each strategy's stake box but not saved yet, keyed by lower-case name.
  const [stakeDraft, setStakeDraft] = useState<Record<string, string>>({});
  const [stakeError, setStakeError] = useState<string | null>(null);
  // The same for each strategy's minimum odds box.
  const [minDraft, setMinDraft] = useState<Record<string, string>>({});
  const [minError, setMinError] = useState<string | null>(null);
  // Which strategy rows are opened up to edit, and which settings tab is showing.
  const [open, setOpen] = useState<Set<string>>(new Set());
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

  function toggleMaster() {
    const turningOn = !settings.enabled;
    if (turningOn) {
      const ok = window.confirm(
        "Turn sending ON?\n\nNew picks from strategies that are switched on will be added to the feed your betting software reads, with the stake you set for each strategy.",
      );
      if (!ok) return;
    }
    save.mutate({ enabled: turningOn });
  }

  function saveStake(key: string) {
    const raw = (stakeDraft[key] ?? "").trim().replace(/^£/, "");
    const n = Number(raw);
    if (!raw || !Number.isFinite(n) || n <= 0) {
      setStakeError("Enter a stake above zero, for example 2 or 2.50.");
      return;
    }
    if (n > settings.maxStake) {
      setStakeError(`That is above your highest stake allowed (£${settings.maxStake}). Raise that limit first if you really mean it.`);
      return;
    }
    setStakeError(null);
    save.mutate(
      { stakes: { [key]: n } },
      {
        onSuccess: () =>
          setStakeDraft((d) => {
            const next = { ...d };
            delete next[key];
            return next;
          }),
      },
    );
  }

  function saveMinOdds(key: string) {
    const raw = (minDraft[key] ?? "").trim();
    const clear = () =>
      setMinDraft((d) => {
        const next = { ...d };
        delete next[key];
        return next;
      });
    if (raw === "") {
      setMinError(null);
      save.mutate({ minOdds: { [key]: null } }, { onSuccess: clear });
      return;
    }
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 1.01 || n > 1000) {
      setMinError("Enter minimum odds between 1.01 and 1000, for example 1.85. Leave the box empty for no minimum.");
      return;
    }
    setMinError(null);
    save.mutate({ minOdds: { [key]: n } }, { onSuccess: clear });
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
  // Switched-on strategies first (they are the ones sending money), then ready-to-switch-on ones, then the rest.
  const rank = (s: (typeof data.strategies)[number]) =>
    s.enabled ? 0 : s.market !== null && SENDABLE.has(s.market) && s.stake !== null ? 1 : s.market !== null && SENDABLE.has(s.market) ? 2 : 3;
  const sortedStrategies = data.strategies.map((s, i) => ({ s, i })).sort((a, b) => rank(a.s) - rank(b.s) || a.i - b.i).map((x) => x.s);
  const onCount = data.strategies.filter((s) => s.enabled).length;
  const stoppedCount = data.strategies.filter((s) => s.stopLoss?.stopped).length;
  const toggleOpen = (key: string) =>
    setOpen((o) => {
      const next = new Set(o);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  return (
    <div className="space-y-3">
      <PageHeader as="h2" title="Sending" subtitle="Controls which picks are handed to your betting software." />

      {save.error && <p className="text-sm text-danger">{save.error.message}</p>}
      {remove.error && <p className="text-sm text-danger">{remove.error.message}</p>}

      {/* 1. Status: the one thing that matters most, always at the top. */}
      <section
        className={`rounded-xl border p-3.5 ${settings.enabled ? "border-accent bg-surface" : "border-line bg-surface"}`}
        aria-label="Sending status"
      >
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-medium text-ink">{settings.enabled ? "Sending is ON" : "Sending is OFF"}</p>
            <p className="mt-0.5 text-xs text-ink-muted">
              {settings.enabled ? `${onCount} of ${data.strategies.length} strategies switched on` : "Nothing is handed over while this is off."}
              {stoppedCount > 0 && <span className="text-danger"> · {stoppedCount} stopped by stop loss today</span>}
            </p>
            <p className="mt-0.5 text-[11px] text-ink-muted">
              {!data.feedTokenConfigured ? (
                <span className="text-danger">No feed link set up: see the Feed tab below.</span>
              ) : (
                <>Betting software last checked: {data.lastFeedFetchAt ? whenFmt.format(new Date(data.lastFeedFetchAt)) : "not yet"}</>
              )}
            </p>
          </div>
          <button
            type="button"
            onClick={toggleMaster}
            disabled={save.isPending}
            className={`shrink-0 rounded-md px-3 py-2 text-sm font-medium ${
              settings.enabled ? "border border-line text-ink" : "bg-accent text-accent-ink"
            } disabled:opacity-50`}
          >
            {settings.enabled ? "Turn off" : "Turn on"}
          </button>
        </div>
      </section>

      {/* 2. Strategies: one compact row each; open a row to change its stake, minimum odds or stop loss. */}
      <Card title="Strategies" subtitle="Tap a strategy to set its stake, minimum odds and stop loss. Each one is off until you switch it on.">
        {stakeError && <p className="mb-2 text-xs text-danger">{stakeError}</p>}
        {minError && <p className="mb-2 text-xs text-danger">{minError}</p>}
        {data.strategies.length === 0 ? (
          <p className="text-xs text-ink-muted">Strategies appear here as picks arrive.</p>
        ) : (
          <ul className="divide-y divide-line">
            {sortedStrategies.map((s, idx) => {
              const key = s.label.toLowerCase();
              const supported = s.market !== null && SENDABLE.has(s.market);
              const firstOff = !s.enabled && (idx === 0 || sortedStrategies[idx - 1]!.enabled) && onCount > 0;
              const note = !s.market ? "No market set" : !supported ? "Can't be sent yet" : marketName(s.market);
              const draft = stakeDraft[key];
              const shown = draft ?? (s.stake !== null ? s.stake.toFixed(2) : "");
              const dirty = draft !== undefined && draft.trim() !== (s.stake !== null ? s.stake.toFixed(2) : "");
              const minDraftValue = minDraft[key];
              const minSaved = s.minOdds !== null ? s.minOdds.toFixed(2) : "";
              const minShown = minDraftValue ?? minSaved;
              const minDirty = minDraftValue !== undefined && minDraftValue.trim() !== minSaved;
              const canSwitch = supported && s.stake !== null && !dirty && !save.isPending;
              const isOpen = open.has(key);
              const hasStopLoss = s.stopLoss !== null && (s.stopLoss.dailyLoss !== null || s.stopLoss.lossRun !== null);
              const summary = !supported
                ? null
                : [
                    s.stake !== null ? `£${s.stake.toFixed(2)}` : "No stake yet",
                    s.minOdds !== null ? `min odds ${s.minOdds.toFixed(2)}` : null,
                    hasStopLoss ? "stop loss set" : null,
                  ]
                    .filter(Boolean)
                    .join(" · ");
              return (
                <li key={s.label} className="py-2.5">
                  {idx === 0 && onCount > 0 && <p className="-mt-1 mb-1.5 text-[11px] font-medium uppercase tracking-wide text-ink-muted">Switched on</p>}
                  {firstOff && <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-ink-muted">Switched off</p>}
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      onClick={() => toggleOpen(key)}
                      aria-expanded={isOpen}
                      className="flex min-w-0 flex-1 items-center gap-2 text-left"
                    >
                      <span className={`shrink-0 text-xs text-ink-muted transition-transform ${isOpen ? "rotate-90" : ""}`} aria-hidden>
                        ▸
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate text-sm text-ink">{s.label}</span>
                        <span className={`block truncate text-xs ${supported ? "text-ink-muted" : "text-danger"}`}>
                          {note}
                          {summary && <span className={s.stake === null ? "text-danger" : ""}> · {summary}</span>}
                        </span>
                      </span>
                    </button>
                    {s.stopLoss?.stopped && (
                      <span className="shrink-0 rounded-full bg-danger px-2 py-0.5 text-[10px] font-medium text-white">Stopped today</span>
                    )}
                    <button
                      type="button"
                      role="switch"
                      aria-checked={s.enabled}
                      aria-label={`Send ${s.label}`}
                      disabled={!canSwitch}
                      title={!supported ? "This strategy can't be sent yet" : s.stake === null ? "Set a stake first" : undefined}
                      onClick={() => save.mutate({ strategies: { [key]: !s.enabled } })}
                      className={`h-6 w-11 shrink-0 rounded-full p-0.5 ring-1 ring-inset ring-line transition-colors disabled:opacity-40 ${
                        s.enabled ? "bg-accent" : "bg-surface-2"
                      }`}
                    >
                      <span
                        className={`block h-5 w-5 rounded-full bg-white shadow ring-1 ring-black/10 transition-transform ${s.enabled ? "translate-x-5" : ""}`}
                      />
                    </button>
                  </div>

                  {isOpen && (
                    <div className="mt-2 space-y-3 pl-5">
                      {supported && (
                        <div className="grid grid-cols-2 gap-3">
                          <label className="text-[11px] text-ink-muted">
                            Stake (£)
                            <div className="mt-1 flex gap-1.5">
                              <input
                                inputMode="decimal"
                                placeholder="0.00"
                                className="w-full rounded-md border border-line bg-surface-2 px-3 py-1.5 text-sm text-ink"
                                value={shown}
                                onChange={(e) => setStakeDraft((d) => ({ ...d, [key]: e.target.value }))}
                              />
                              {dirty && (
                                <button
                                  type="button"
                                  onClick={() => saveStake(key)}
                                  disabled={save.isPending}
                                  className="rounded-md bg-accent px-2.5 text-xs font-medium text-accent-ink disabled:opacity-50"
                                >
                                  Set
                                </button>
                              )}
                            </div>
                            {!dirty && s.stake === null && <span className="mt-1 block text-danger">Needed to switch on</span>}
                          </label>
                          <label className="text-[11px] text-ink-muted">
                            Minimum odds
                            <div className="mt-1 flex gap-1.5">
                              <input
                                inputMode="decimal"
                                placeholder="none"
                                className="w-full rounded-md border border-line bg-surface-2 px-3 py-1.5 text-sm text-ink"
                                value={minShown}
                                onChange={(e) => setMinDraft((d) => ({ ...d, [key]: e.target.value }))}
                              />
                              {minDirty && (
                                <button
                                  type="button"
                                  onClick={() => saveMinOdds(key)}
                                  disabled={save.isPending}
                                  className="rounded-md bg-accent px-2.5 text-xs font-medium text-accent-ink disabled:opacity-50"
                                >
                                  {minDraft[key]!.trim() === "" ? "Clear" : "Set"}
                                </button>
                              )}
                            </div>
                          </label>
                          <p className="col-span-2 -mt-1 text-[11px] text-ink-muted">
                            {s.minOdds !== null
                              ? `Your betting software waits for odds of ${s.minOdds.toFixed(2)} or better before it places the bet. Applies to new picks only.`
                              : "Minimum odds are optional: your betting software waits for at least this price before it places the bet."}
                          </p>
                        </div>
                      )}
                      {supported && (
                        <StopLossControls
                          status={s.stopLoss}
                          busy={save.isPending}
                          onSave={(patch) => save.mutate({ stopLoss: { [key]: patch } })}
                        />
                      )}
                      {!s.enabled ? (
                        <button
                          type="button"
                          onClick={() => remove.run(s.label, { alerts: s.alerts, sent: s.sent })}
                          disabled={remove.isPending}
                          className="text-xs text-danger underline disabled:opacity-50"
                        >
                          Remove this strategy
                        </button>
                      ) : (
                        <p className="text-[11px] text-ink-muted">To remove this strategy, switch it off first.</p>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      {/* 3. What is happening right now. */}
      <Card
        title="What would be handed over now"
        subtitle={settings.enabled ? "Picks in the feed at this moment." : "Sending is off, so the feed is empty. This shows what the checks would do."}
      >
        {data.preview.rows.length === 0 ? (
          <p className="text-xs text-ink-muted">Nothing right now.</p>
        ) : (
          <ul className="space-y-2">
            {data.preview.rows.map((r) => (
              <li key={r.pickId} className="rounded-md bg-surface-2 px-3 py-2 text-xs">
                <p className="font-medium text-ink">{r.eventName}</p>
                <p className="text-ink-muted">
                  {r.provider} · {r.selectionName} · £{r.stake.toFixed(2)}
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

      {/* 4. Settings you rarely change, in tabs at the bottom. */}
      <section className="rounded-xl border border-line bg-surface p-3.5">
        <h2 className="text-sm font-medium text-ink">Sending settings</h2>
        <p className="mt-0.5 text-xs text-ink-muted">Settings that apply to every strategy. You rarely need to change these.</p>

        <div role="tablist" aria-label="Sending settings" className="mt-3 grid grid-cols-4 gap-0.5 rounded-lg border border-line bg-surface-2 p-0.5">
          {SETTINGS_TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              onClick={() => setTab(t.id)}
              className={`rounded-md px-1 py-1.5 text-[11px] font-medium leading-tight transition-colors sm:text-xs ${
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
                <p className="mt-0.5 text-[11px] text-ink-muted">Double Chance on the side with the longer pre-match price.</p>
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
                <p className="mt-0.5 text-[11px] text-ink-muted">Match Odds on the side with the shorter live price in the alert.</p>
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
            </div>
          )}

          {tab === "feed" && (
            <div className="space-y-2">
              {data.feedTokenConfigured ? (
                <p className="text-xs text-ink-muted">
                  The link is set up. Its address is your site&rsquo;s web address followed by{" "}
                  <span className="break-all font-mono text-ink">/feeds/bets/YOUR-TOKEN.csv</span>.
                </p>
              ) : (
                <p className="text-xs text-danger">
                  No link exists yet. On the engine component, add a variable named <span className="font-mono">BET_FEED_TOKEN</span> with a long
                  random value (letters and numbers only), then redeploy the engine.
                </p>
              )}
              <p className="text-xs text-ink-muted">
                Last checked by your betting software:{" "}
                <span className="text-ink">{data.lastFeedFetchAt ? whenFmt.format(new Date(data.lastFeedFetchAt)) : "not yet"}</span>
                {data.lastFeedFetcher && (
                  <span className="block truncate text-[11px] text-ink-muted" title={data.lastFeedFetcher}>
                    by {data.lastFeedFetcher}
                  </span>
                )}
              </p>
            </div>
          )}
        </div>

        {tab !== "feed" && (
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
                <span className="text-[11px] text-ink-muted">Unsaved changes (saving covers all tabs)</span>
              </>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
