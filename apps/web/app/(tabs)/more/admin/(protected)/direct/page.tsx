"use client";

import { useState } from "react";
import { useHydrated } from "@/queries/use-me";
import { Check, Download, Minus, X } from "lucide-react";
import { Card, PageHeader, Segmented } from "@/components/ui/Card";
import { Chip, type ChipTone } from "@/components/ui/Chip";
import { Skeleton } from "@/components/ui/Skeleton";
import { QueryError } from "@/components/ui/QueryError";
import { useDialog } from "@/components/ui/ConfirmDialog";
import { useDirect, useSaveDirect } from "@/queries/use-direct";
import type { DirectBetRow, DirectMode, DirectSettings, DirectStatus } from "@/server/engine-client";

const timeFmt = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const money = (n: number) => `£${n.toFixed(2)}`;

const MODES: ReadonlyArray<{ value: DirectMode; label: string }> = [
  { value: "off", label: "Off" },
  { value: "shadow", label: "Shadow" },
  { value: "live", label: "Live" },
];

const MODE_TEXT: Record<DirectMode, string> = {
  off: "Nothing happens. BF Bot Manager places your bets from the feed, as now.",
  shadow:
    "BF Bot Manager still places your bets. For each pick it's sent, GoalBrew works out what it would bet itself (market, price, checks) and lists it below, without placing anything. Compare the two before going Live.",
  live: "GoalBrew places your bets on Betfair itself. The feed gives BF Bot Manager nothing new, so stop its strategies (or the VPS) once you're happy.",
};

export default function DirectBettingPage() {
  const { data, isLoading, error } = useDirect();
  if (error) return <QueryError error={error} next="/more/admin/direct" />;
  return (
    <div className="space-y-4">
      <PageHeader
        as="h2"
        title="Direct betting"
        subtitle="Place bets on Betfair straight from GoalBrew, without BF Bot Manager or the VPS. Off until you switch it on."
      />
      {isLoading || !data ? (
        <Skeleton className="h-64 w-full" />
      ) : (
        <>
          <ModeCard data={data} />
          <Readiness data={data} />
          <Limits data={data} />
          <Webhooks data={data} />
          <Activity bets={data.bets} />
        </>
      )}
    </div>
  );
}

function ModeCard({ data }: { data: DirectStatus }) {
  const save = useSaveDirect();
  const dialog = useDialog();
  const s = data.settings;

  async function choose(mode: DirectMode) {
    if (mode === s.mode) return;
    if (mode === "live") {
      const ok = await dialog.confirm({
        title: "Place bets from GoalBrew?",
        confirmLabel: "Go Live",
        tone: "money",
        body: (
          <>
            <p>From now on GoalBrew places each new pick on Betfair with real money, using your stakes, minimum odds, stop losses and daily limit from Sending.</p>
            <p>
              BF Bot Manager gets nothing new from the feed. Up to <strong>{money(s.dailyStakeLimit)}</strong> a day can be staked here; unmatched stake is
              cancelled after {s.cancelUnmatchedSeconds} seconds.
            </p>
            <p>Picks already sent to BF Bot Manager are left to it.</p>
          </>
        ),
      });
      if (!ok) return;
    } else if (s.mode === "live") {
      const ok = await dialog.confirm({
        title: mode === "off" ? "Stop direct betting?" : "Back to Shadow?",
        confirmLabel: mode === "off" ? "Switch off" : "Back to Shadow",
        body: <p>No more bets are placed from GoalBrew; the feed goes back to BF Bot Manager straight away. Bets already placed stay on Betfair.</p>,
      });
      if (!ok) return;
    }
    save.mutate({ mode });
  }

  const blocked = s.mode === "live" && data.effectiveMode !== "live";
  return (
    <Card title="Mode" subtitle={MODE_TEXT[s.mode]}>
      <Segmented label="Direct betting mode" options={MODES} value={s.mode} onChange={(m) => void choose(m)} />
      {save.isPending && <p className="mt-2 text-xs text-ink-muted">Saving…</p>}
      {save.error && <p className="mt-2 text-xs text-destructive">{save.error.message}</p>}
      {blocked && (
        <p className="mt-2 text-xs text-warn">
          Live is set but the engine doesn&apos;t allow it, so it&apos;s acting as Shadow. Add BF_DIRECT_BETTING = allow to the engine in DigitalOcean.
        </p>
      )}
      {s.mode !== "off" && <p className="mt-2 text-xs text-ink-muted">Taking picks sent since {timeFmt.format(new Date(s.since))}.</p>}
      {data.effectiveMode === "live" && (
        <p className="mt-2 text-xs text-ink">
          Staked directly today: <strong className="tabular-nums">{money(data.stakedToday)}</strong> of {money(s.dailyStakeLimit)}.
        </p>
      )}
    </Card>
  );
}

function Tick({ state }: { state: boolean | null }) {
  if (state === null) return <Minus size={16} className="text-ink-muted" aria-label="Not known" />;
  return state ? <Check size={16} className="text-hit" aria-label="Yes" /> : <X size={16} className="text-loss" aria-label="No" />;
}

function Readiness({ data }: { data: DirectStatus }) {
  const r = data.readiness;
  const lastWebhook = data.webhooks[0];
  const rows: Array<{ ok: boolean | null; label: string; detail: string }> = [
    {
      ok: r.betfairLinked,
      label: "Betfair link set up on the engine",
      detail: r.betfairLinked ? "App key, login and certificate are there." : "Add BF_APP_KEY, BF_USERNAME, BF_PASSWORD and the certificate to the engine.",
    },
    {
      ok: r.loginOk,
      label: "Betfair login works",
      detail: r.loginOk === false ? (r.error ?? "Login failed.") : r.loginOk ? "Logged in." : "Checked once direct betting can reach Betfair.",
    },
    {
      ok: r.available === null ? null : r.available > 0,
      label: "Money in the account",
      detail: r.available === null ? "Not read yet." : `${money(r.available)} available to bet${r.exposure ? `, ${money(Math.abs(r.exposure))} in open bets` : ""}.`,
    },
    {
      ok: r.delayedKey === null ? null : !r.delayedKey,
      label: "Live app key (prices without delay)",
      detail:
        r.delayedKey === null
          ? "Couldn't tell which key this is."
          : r.delayedKey
            ? "This is Betfair's delayed key: prices can be up to a few minutes old, so bets may miss. Betfair's live key is needed for betting in play."
            : "Live key: prices are current.",
    },
    {
      ok: data.sendingOn,
      label: "Sending switched on",
      detail: data.sendingOn ? "Strategies set Live on Sending are bet." : "The master switch on Sending is off, so nothing is bet either way.",
    },
    {
      ok: r.liveAllowed,
      label: "Engine allows Live",
      detail: r.liveAllowed ? "BF_DIRECT_BETTING is set to allow." : "Live stays locked until BF_DIRECT_BETTING = allow is added to the engine in DigitalOcean. Shadow works without it.",
    },
    {
      ok: lastWebhook ? lastWebhook.understood : null,
      label: "InPlayGuru webhook arriving",
      detail: lastWebhook
        ? `Last one ${timeFmt.format(new Date(lastWebhook.receivedAt))}${lastWebhook.understood ? "" : ", but it didn't read as an alert (see Webhook alerts)"}.`
        : "None received yet. Optional: alerts still come by Telegram.",
    },
  ];
  return (
    <Card title="Ready for Live?" subtitle={r.checkedAt ? `Checked ${timeFmt.format(new Date(r.checkedAt))}` : undefined}>
      <ul className="space-y-2.5">
        {rows.map((row) => (
          <li key={row.label} className="flex gap-2.5">
            <span className="mt-0.5 shrink-0">
              <Tick state={row.ok} />
            </span>
            <span className="min-w-0">
              <span className="block text-sm text-ink">{row.label}</span>
              <span className="block text-xs text-ink-muted">{row.detail}</span>
            </span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function NumberField({ label, value, onChange, suffix, step = 1 }: { label: string; value: string; onChange: (v: string) => void; suffix?: string; step?: number }) {
  return (
    <label className="block">
      <span className="block text-xs text-ink-muted">{label}</span>
      <span className="mt-1 flex items-center gap-1.5">
        <input
          type="number"
          inputMode="decimal"
          step={step}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-24 rounded-md border border-line bg-surface-2 px-2 py-1.5 text-sm tabular-nums text-ink"
        />
        {suffix && <span className="text-xs text-ink-muted">{suffix}</span>}
      </span>
    </label>
  );
}

type Form = { maxSpreadPct: string; minOverround: string; maxOverround: string; cancelUnmatchedSeconds: string; dailyStakeLimit: string; acceptBelowPct: string; limits: Record<string, { spread: string; over: string }> };

function toForm(s: DirectSettings, strategies: string[]): Form {
  const limits: Form["limits"] = {};
  for (const label of strategies) {
    const l = s.strategyLimits[label.toLowerCase()] ?? {};
    limits[label.toLowerCase()] = { spread: l.maxSpreadPct?.toString() ?? "", over: l.maxOverround?.toString() ?? "" };
  }
  return {
    maxSpreadPct: String(s.maxSpreadPct),
    minOverround: String(s.minOverround),
    maxOverround: String(s.maxOverround),
    cancelUnmatchedSeconds: String(s.cancelUnmatchedSeconds),
    dailyStakeLimit: String(s.dailyStakeLimit),
    acceptBelowPct: String(s.acceptBelowPct),
    limits,
  };
}

function Limits({ data }: { data: DirectStatus }) {
  const save = useSaveDirect();
  // The saved values, until the admin starts editing; then their edits until saved or undone.
  const [edit, setEdit] = useState<Form | null>(null);
  const form = edit ?? toForm(data.settings, data.strategies);
  const dirty = edit !== null;
  const reset = () => setEdit(null);

  const set = (patch: Partial<Form>) => setEdit({ ...form, ...patch });
  const setLimit = (key: string, patch: Partial<{ spread: string; over: string }>) =>
    setEdit({ ...form, limits: { ...form.limits, [key]: { ...(form.limits[key] ?? { spread: "", over: "" }), ...patch } } });

  function submit() {
    const strategyLimits: DirectSettings["strategyLimits"] = {};
    for (const [k, v] of Object.entries(form.limits)) {
      const l: { maxSpreadPct?: number; maxOverround?: number } = {};
      if (v.spread.trim()) l.maxSpreadPct = Number(v.spread);
      if (v.over.trim()) l.maxOverround = Number(v.over);
      if (l.maxSpreadPct !== undefined || l.maxOverround !== undefined) strategyLimits[k] = l;
    }
    save.mutate(
      {
        maxSpreadPct: Number(form.maxSpreadPct),
        minOverround: Number(form.minOverround),
        maxOverround: Number(form.maxOverround),
        cancelUnmatchedSeconds: Number(form.cancelUnmatchedSeconds),
        dailyStakeLimit: Number(form.dailyStakeLimit),
        acceptBelowPct: Number(form.acceptBelowPct),
        strategyLimits,
      },
      { onSuccess: () => reset() },
    );
  }

  return (
    <Card
      title="Checks before each bet"
      subtitle="The same checks BF Bot Manager runs. A pick that fails one waits and is checked again until it's too old to bet. Stakes, minimum odds and stop losses come from Sending."
    >
      <div className="flex flex-wrap gap-4">
        <NumberField label="Back/lay gap at most" value={form.maxSpreadPct} onChange={(v) => set({ maxSpreadPct: v })} suffix="%" />
        <NumberField label="Overround from" value={form.minOverround} onChange={(v) => set({ minOverround: v })} suffix="%" />
        <NumberField label="Overround up to" value={form.maxOverround} onChange={(v) => set({ maxOverround: v })} suffix="%" />
        <NumberField label="Cancel unmatched after" value={form.cancelUnmatchedSeconds} onChange={(v) => set({ cancelUnmatchedSeconds: v })} suffix="seconds" />
        <NumberField label="Most staked a day" value={form.dailyStakeLimit} onChange={(v) => set({ dailyStakeLimit: v })} suffix="£" />
      </div>
      <p className="mt-4 text-xs text-ink-muted">
        Price asked for: each bet asks for a price this far under the one shown (never under the strategy&apos;s minimum odds), and Betfair matches it at the
        best price really on offer. That way a price a few seconds old doesn&apos;t stop the bet matching. 0 asks for exactly the price shown.
      </p>
      <div className="mt-2">
        <NumberField label="Accept down to" value={form.acceptBelowPct} onChange={(v) => set({ acceptBelowPct: v })} suffix="% under the price shown" />
      </div>

      <details className="mt-4">
        <summary className="cursor-pointer text-sm font-medium text-ink">Per strategy (leave blank to use the above)</summary>
        <div className="mt-2 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-ink-muted">
                <th className="py-1.5 pr-3 font-medium">Strategy</th>
                <th className="py-1.5 pr-3 font-medium">Gap %</th>
                <th className="py-1.5 font-medium">Overround up to %</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {data.strategies.map((label) => {
                const key = label.toLowerCase();
                const v = form.limits[key] ?? { spread: "", over: "" };
                return (
                  <tr key={key}>
                    <td className="py-1.5 pr-3 text-ink">{label}</td>
                    <td className="py-1.5 pr-3">
                      <input
                        aria-label={`${label}: back/lay gap at most`}
                        type="number"
                        inputMode="decimal"
                        value={v.spread}
                        placeholder={String(data.settings.maxSpreadPct)}
                        onChange={(e) => setLimit(key, { spread: e.target.value })}
                        className="w-20 rounded-md border border-line bg-surface-2 px-2 py-1 tabular-nums text-ink"
                      />
                    </td>
                    <td className="py-1.5">
                      <input
                        aria-label={`${label}: overround up to`}
                        type="number"
                        inputMode="decimal"
                        value={v.over}
                        placeholder={String(data.settings.maxOverround)}
                        onChange={(e) => setLimit(key, { over: e.target.value })}
                        className="w-20 rounded-md border border-line bg-surface-2 px-2 py-1 tabular-nums text-ink"
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </details>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={!dirty || save.isPending}
          onClick={submit}
          className="rounded-md bg-accent px-3 py-2 text-sm font-medium text-accent-ink disabled:opacity-50"
        >
          {save.isPending ? "Saving…" : "Save checks"}
        </button>
        {dirty && (
          <button type="button" onClick={() => reset()} className="rounded-md border border-line px-3 py-2 text-sm font-medium text-ink">
            Undo changes
          </button>
        )}
        {save.error && <p className="text-xs text-destructive">{save.error.message}</p>}
      </div>
    </Card>
  );
}

function Webhooks({ data }: { data: DirectStatus }) {
  const save = useSaveDirect();
  const dialog = useDialog();
  const use = data.settings.webhook === "use";
  // This site's own address, read after load so the server and browser render the same thing first.
  const origin = useHydrated() ? window.location.origin : "https://YOUR-SITE";

  async function toggle(next: "record" | "use") {
    if (next === data.settings.webhook) return;
    if (next === "use") {
      const ok = await dialog.confirm({
        title: "Use webhook alerts as picks?",
        confirmLabel: "Use them",
        body: (
          <>
            <p>Alerts arriving by InPlayGuru&apos;s webhook become picks like Telegram&apos;s, so whichever arrives first is used. The same alert coming both ways is kept once.</p>
            <p>Telegram keeps running alongside for results.</p>
          </>
        ),
      });
      if (!ok) return;
    }
    save.mutate({ webhook: next });
  }

  return (
    <Card
      title="Webhook alerts"
      subtitle="InPlayGuru can send each alert straight to GoalBrew, as well as to Telegram. Give InPlayGuru this address, with your INPLAYGURU_WEBHOOK_PATH_TOKEN from the engine's settings in place of TOKEN:"
    >
      <code className="block break-all rounded-md bg-surface-2 px-2 py-1.5 text-xs text-ink">{origin}/engine/webhooks/inplayguru/TOKEN</code>
      <div className="mt-3">
        <Segmented
          label="Webhook alerts"
          options={[
            { value: "record", label: "Record only" },
            { value: "use", label: "Use as picks" },
          ]}
          value={use ? "use" : "record"}
          onChange={(v) => void toggle(v)}
        />
        {save.error && <p className="mt-2 text-xs text-destructive">{save.error.message}</p>}
      </div>
      {data.webhooks.length === 0 ? (
        <p className="mt-3 text-xs text-ink-muted">No webhooks from InPlayGuru yet.</p>
      ) : (
        <ul className="mt-3 divide-y divide-line">
          {data.webhooks.map((w) => (
            <li key={w.receivedAt + w.sample.length} className="py-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs tabular-nums text-ink-muted">{timeFmt.format(new Date(w.receivedAt))}</span>
                {w.understood ? <Chip tone="neutral">Reads as an alert</Chip> : <Chip tone="warn">Not understood</Chip>}
                {w.signatureVerified && <Chip tone="muted">Signed</Chip>}
              </div>
              {w.summary && <p className="mt-1 text-sm text-ink">{w.summary}</p>}
              <details className="mt-1">
                <summary className="cursor-pointer text-xs text-ink-muted">What arrived</summary>
                <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap break-all rounded-md bg-surface-2 p-2 text-xs text-ink">{w.sample}</pre>
              </details>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

const STATE: Record<DirectBetRow["state"], { label: string; tone: ChipTone }> = {
  waiting: { label: "Waiting", tone: "muted" },
  placing: { label: "Placing", tone: "muted" },
  placed: { label: "Placed", tone: "neutral" },
  shadow: { label: "Would bet", tone: "neutral" },
  skipped: { label: "Not bet", tone: "warn" },
  failed: { label: "Failed", tone: "warn" },
};

function Activity({ bets }: { bets: DirectBetRow[] }) {
  return (
    <Card
      title="Recent"
      subtitle="The latest 50 picks direct betting has looked at, newest first. In Shadow, compare with what BF Bot Manager got. The download has every one."
      actions={
        <a
          href="/api/admin/direct/export"
          download
          className="inline-flex items-center gap-1.5 rounded-md border border-line px-3 py-1.5 text-xs font-medium text-ink hover:bg-surface-2"
        >
          <Download size={14} aria-hidden />
          Download for Excel
        </a>
      }
    >
      {bets.length === 0 ? (
        <p className="text-xs text-ink-muted">Nothing yet. Picks show here once direct betting is in Shadow or Live and the feed sends one.</p>
      ) : (
        <ul className="divide-y divide-line">
          {bets.map((b) => {
            const st = STATE[b.state];
            return (
              <li key={b.pickId} className="py-2.5">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs tabular-nums text-ink-muted">{timeFmt.format(new Date(b.createdAt))}</span>
                  <Chip tone={st.tone}>{st.label}</Chip>
                  {b.mode === "shadow" && <Chip tone="muted">Shadow</Chip>}
                  <span className="text-xs text-ink-muted">{b.strategy}</span>
                </div>
                <p className="mt-1 text-sm text-ink">
                  {b.home && b.away ? `${b.home} v ${b.away}` : b.eventName}
                  <span className="text-ink-muted"> · {b.selectionName} · {money(b.stake)}</span>
                </p>
                <p className="mt-0.5 text-xs text-ink-muted">
                  {b.state === "placed" && (
                    <>
                      Matched {money(b.sizeMatched ?? 0)}
                      {b.avgPrice ? ` at ${b.avgPrice.toFixed(2)}` : ""}
                      {b.cancelled ? `, ${money(b.cancelled)} not matched` : ""}.{" "}
                    </>
                  )}
                  {b.state !== "placed" && b.price !== null && `Price ${b.price.toFixed(2)}${b.bestLay ? ` / lay ${b.bestLay.toFixed(2)}` : ""}${b.overround ? ` · overround ${b.overround}%` : ""}. `}
                  {b.reason}
                </p>
                {b.mode === "shadow" && (
                  <p className="mt-0.5 text-xs text-ink">
                    BF Bot Manager: {b.feedMatched ? `matched ${money(b.feedMatched)}${b.feedOdds ? ` at ${b.feedOdds.toFixed(2)}` : ""}` : "no matched bet seen yet"}.
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
