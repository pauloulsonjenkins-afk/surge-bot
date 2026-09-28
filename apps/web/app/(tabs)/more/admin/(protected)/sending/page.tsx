"use client";

import { useEffect, useState } from "react";
import { Skeleton } from "@/components/ui/Skeleton";
import { QueryError } from "@/components/ui/QueryError";
import { marketName } from "@/lib/markets";
import { useSaveSending, useSending, type SendingSettings } from "@/queries/use-sending";

const whenFmt = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  timeZone: "Europe/London",
});

interface Form {
  maxAgeMinutes: string;
  dailyCap: string;
  bttsMarketType: string;
  bttsSelection: string;
  aliases: string;
}

function toForm(s: SendingSettings): Form {
  return {
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
  const [form, setForm] = useState<Form | null>(null);
  const [saved, setSaved] = useState(false);

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
        "Turn sending ON?\n\nNew picks from strategies that are switched on will be added to the feed your betting software reads. Stakes and price limits stay in your betting software.",
      );
      if (!ok) return;
    }
    save.mutate({ enabled: turningOn });
  }

  function saveLimits() {
    save.mutate(
      {
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
            The link is set up. Its address is your engine&rsquo;s public address followed by{" "}
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
        </p>
      </Card>

      <Card title="Strategies" subtitle="Each one is off until you switch it on.">
        {data.strategies.length === 0 ? (
          <p className="text-xs text-ink-muted">Strategies appear here as picks arrive.</p>
        ) : (
          <ul className="divide-y divide-line">
            {data.strategies.map((s) => {
              const supported = s.market === "NEXT_GOAL" || s.market === "BOTH_TEAMS_TO_SCORE";
              const note = !s.market ? "No market set" : !supported ? "Can't be sent yet" : marketName(s.market);
              return (
                <li key={s.label} className="flex items-center justify-between gap-3 py-2.5">
                  <div className="min-w-0">
                    <p className="truncate text-sm text-ink">{s.label}</p>
                    <p className={`text-xs ${supported ? "text-ink-muted" : "text-danger"}`}>{note}</p>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={s.enabled}
                    disabled={!supported || save.isPending}
                    onClick={() => save.mutate({ strategies: { [s.label.toLowerCase()]: !s.enabled } })}
                    className={`h-6 w-11 shrink-0 rounded-full p-0.5 transition-colors disabled:opacity-40 ${
                      s.enabled ? "bg-accent" : "bg-surface-2"
                    }`}
                  >
                    <span
                      className={`block h-5 w-5 rounded-full bg-ink transition-transform ${s.enabled ? "translate-x-5" : ""}`}
                    />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <Card title="Safety limits">
        <div className="grid grid-cols-2 gap-3">
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
                  {r.provider} · {r.selectionName} · <span className="font-mono">{r.marketType}</span>
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
