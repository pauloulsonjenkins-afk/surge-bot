"use client";

import { useEffect, useState } from "react";
import { Skeleton } from "@/components/ui/Skeleton";
import { QueryError } from "@/components/ui/QueryError";
import { marketName } from "@/lib/markets";
import { useRemoveStrategy, useSaveSending, useSending, type SendingSettings } from "@/queries/use-sending";

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
  aliases: string;
}

function toForm(s: SendingSettings): Form {
  return {
    maxStake: String(s.maxStake),
    maxAgeMinutes: String(s.maxAgeMinutes),
    dailyCap: String(s.dailyCap),
    bttsMarketType: s.bttsMarketType,
    bttsSelection: s.bttsSelection,
    aliases: s.aliases,
  };
}

function Card({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-line bg-surface p-3.5">
      <h2 className="text-sm font-medium text-ink">{title}</h2>
      {subtitle && <p className="mt-0.5 text-xs text-ink-muted">{subtitle}</p>}
      <div className="mt-3">{children}</div>
    </section>
  );
}

const inputCls = "w-full rounded-md border border-line bg-surface-2 px-3 py-2 text-sm text-ink";

export default function SendingPage() {
  const { data, isLoading, error } = useSending();
  const save = useSaveSending();
  const remove = useRemoveStrategy();
  const [form, setForm] = useState<Form | null>(null);
  const [saved, setSaved] = useState(false);
  // What has been typed into each strategy's stake box but not saved yet, keyed by lower-case name.
  const [stakeDraft, setStakeDraft] = useState<Record<string, string>>({});
  const [stakeError, setStakeError] = useState<string | null>(null);

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

  function removeStrategy(label: string) {
    const ok = window.confirm(
      `Remove "${label}" from the app?\n\nIts saved alerts are deleted, along with its stake and switch. Alerts that were already sent are kept. Nothing changes in your betting software.`,
    );
    if (!ok) return;
    remove.mutate(label, {
      onSuccess: (r) => {
        if (r.keptBecauseSent > 0) {
          window.alert(`${r.removed} alert(s) removed. ${r.keptBecauseSent} were already sent, so they were kept.`);
        }
      },
    });
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

  function saveLimits() {
    save.mutate(
      {
        maxStake: Number(form!.maxStake),
        maxAgeMinutes: Number(form!.maxAgeMinutes),
        dailyCap: Number(form!.dailyCap),
        bttsMarketType: form!.bttsMarketType,
        bttsSelection: form!.bttsSelection,
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

  return (
    <div className="space-y-3">
      <div>
        <h2 className="text-lg font-medium tracking-tight text-ink">Sending</h2>
        <p className="text-xs text-ink-muted">Controls which picks are handed to your betting software.</p>
      </div>

      {save.error && <p className="text-sm text-danger">{save.error.message}</p>}
      {remove.error && <p className="text-sm text-danger">{remove.error.message}</p>}

      <Card title="Master switch" subtitle="Nothing is handed over while this is off.">
        <div className="flex items-center justify-between gap-3">
          <span
            className={`rounded-full px-2.5 py-1 text-xs font-medium ${
              settings.enabled ? "bg-accent text-accent-ink" : "bg-surface-2 text-ink-muted"
            }`}
          >
            {settings.enabled ? "Sending is ON" : "Sending is OFF"}
          </span>
          <button
            type="button"
            onClick={toggleMaster}
            disabled={save.isPending}
            className={`rounded-md px-3 py-2 text-sm font-medium ${
              settings.enabled ? "border border-line text-ink" : "bg-accent text-accent-ink"
            } disabled:opacity-50`}
          >
            {settings.enabled ? "Turn off" : "Turn on"}
          </button>
        </div>
      </Card>

      <Card title="Feed link" subtitle="The private address your betting software reads.">
        {data.feedTokenConfigured ? (
          <p className="text-xs text-ink-muted">
            The link is set up. Its address is your site&rsquo;s web address followed by{" "}
            <span className="break-all font-mono text-ink">/feeds/bets/YOUR-TOKEN.csv</span>.
          </p>
        ) : (
          <p className="text-xs text-danger">
            No link exists yet. On the engine component, add a variable named{" "}
            <span className="font-mono">BET_FEED_TOKEN</span> with a long random value (letters and numbers only),
            then redeploy the engine.
          </p>
        )}
        <p className="mt-2 text-xs text-ink-muted">
          Last checked by your betting software:{" "}
          <span className="text-ink">{data.lastFeedFetchAt ? whenFmt.format(new Date(data.lastFeedFetchAt)) : "not yet"}</span>
          {data.lastFeedFetcher && (
            <span className="block truncate text-[11px] text-ink-muted" title={data.lastFeedFetcher}>
              by {data.lastFeedFetcher}
            </span>
          )}
        </p>
      </Card>

      <Card title="Strategies" subtitle="Set a stake for each strategy, then switch it on. Each one is off until you do.">
        {stakeError && <p className="mb-2 text-xs text-danger">{stakeError}</p>}
        {data.strategies.length === 0 ? (
          <p className="text-xs text-ink-muted">Strategies appear here as picks arrive.</p>
        ) : (
          <ul className="divide-y divide-line">
            {data.strategies.map((s) => {
              const key = s.label.toLowerCase();
              const supported = s.market === "NEXT_GOAL" || s.market === "BOTH_TEAMS_TO_SCORE";
              const note = !s.market ? "No market set" : !supported ? "Can't be sent yet" : marketName(s.market);
              const draft = stakeDraft[key];
              const shown = draft ?? (s.stake !== null ? s.stake.toFixed(2) : "");
              const dirty = draft !== undefined && draft.trim() !== (s.stake !== null ? s.stake.toFixed(2) : "");
              const canSwitch = supported && s.stake !== null && !dirty && !save.isPending;
              return (
                <li key={s.label} className="py-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm text-ink">{s.label}</p>
                      <p className={`text-xs ${supported ? "text-ink-muted" : "text-danger"}`}>{note}</p>
                    </div>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={s.enabled}
                      disabled={!canSwitch}
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
                  {!supported && !s.enabled && (
                    <button
                      type="button"
                      onClick={() => removeStrategy(s.label)}
                      disabled={remove.isPending}
                      className="mt-1 text-xs text-danger underline disabled:opacity-50"
                    >
                      Remove this strategy
                    </button>
                  )}
                  {supported && (
                    <div className="mt-2 flex items-center gap-2">
                      <span className="whitespace-nowrap text-xs text-ink-muted">Stake £</span>
                      <input
                        inputMode="decimal"
                        placeholder="0.00"
                        className="w-24 rounded-md border border-line bg-surface-2 px-3 py-1.5 text-sm text-ink"
                        value={shown}
                        onChange={(e) => setStakeDraft((d) => ({ ...d, [key]: e.target.value }))}
                      />
                      {dirty && (
                        <button
                          type="button"
                          onClick={() => saveStake(key)}
                          disabled={save.isPending}
                          className="rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-accent-ink disabled:opacity-50"
                        >
                          Set
                        </button>
                      )}
                      {!dirty && s.stake === null && <span className="text-xs text-danger">Needed to switch on</span>}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <Card title="Safety limits" subtitle="Save changes with the button under Match names.">
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
      </Card>

      <Card title="Match names" subtitle="If your betting software can't find a match, fix the name here. One per line: alert name = exchange name.">
        <textarea
          rows={4}
          className={`${inputCls} font-mono text-xs`}
          placeholder={"OHiggins = O'Higgins"}
          value={form.aliases}
          onChange={(e) => setForm({ ...form, aliases: e.target.value })}
        />
        <div className="mt-3 grid grid-cols-2 gap-3">
          <label className="text-xs text-ink-muted">
            Both teams to score: market code
            <input
              className={`${inputCls} mt-1 font-mono text-xs`}
              value={form.bttsMarketType}
              onChange={(e) => setForm({ ...form, bttsMarketType: e.target.value })}
            />
          </label>
          <label className="text-xs text-ink-muted">
            Selection name
            <input
              className={`${inputCls} mt-1 font-mono text-xs`}
              value={form.bttsSelection}
              onChange={(e) => setForm({ ...form, bttsSelection: e.target.value })}
            />
          </label>
        </div>
        <button
          type="button"
          onClick={saveLimits}
          disabled={save.isPending}
          className="mt-3 rounded-md bg-accent px-3 py-2 text-sm font-medium text-accent-ink disabled:opacity-50"
        >
          {save.isPending ? "Saving…" : saved ? "Saved" : "Save changes"}
        </button>
      </Card>

      <Card
        title="What would be handed over now"
        subtitle={settings.enabled ? "Picks in the feed at this moment." : "Sending is off, so the feed is empty. This shows what the gates would do."}
      >
        {data.preview.rows.length === 0 ? (
          <p className="text-xs text-ink-muted">Nothing right now.</p>
        ) : (
          <ul className="space-y-2">
            {data.preview.rows.map((r) => (
              <li key={r.pickId} className="rounded-md bg-surface-2 px-3 py-2 text-xs">
                <p className="font-medium text-ink">{r.eventName}</p>
                <p className="text-ink-muted">
                  {r.provider} · {r.selectionName} · £{r.stake.toFixed(2)} · <span className="font-mono">{r.marketType}</span>
                </p>
              </li>
            ))}
          </ul>
        )}
        {data.preview.skipped.length > 0 && (
          <>
            <p className="mt-3 text-xs font-medium text-ink-muted">Held back</p>
            <ul className="mt-1 space-y-1">
              {data.preview.skipped.map((k) => (
                <li key={k.pickId} className="text-xs text-ink-muted">
                  <span className="text-ink">{k.match}</span> — {k.reason}
                </li>
              ))}
            </ul>
          </>
        )}
      </Card>
    </div>
  );
}