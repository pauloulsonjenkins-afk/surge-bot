"use client";

import { useState } from "react";
import { PageHeader } from "@/components/ui/Card";
import { Skeleton } from "@/components/ui/Skeleton";
import { QueryError } from "@/components/ui/QueryError";
import { useShowMore } from "@/components/ui/ShowMore";
import { useChangeTips, useChannelEquity, useTips, type ChannelTip } from "@/queries/use-tips";
import Link from "next/link";
import { useAdminStrategies } from "@/queries/use-strategies";
import { WinLossLines, gbp, type LineSeries } from "@/components/admin/WinLossLines";
import { units } from "@/lib/format";
import { strategyHref } from "../strategies/page";

const when = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", weekday: "short", hour: "2-digit", minute: "2-digit" });

type Shown = "tip" | "maybe" | "advert" | "other";

/** What a message counts as: the owner's call if they made one, else the reading. */
function effective(t: ChannelTip): Shown {
  if (t.review === "tip") return "tip";
  if (t.review === "not") return "other";
  return t.verdict;
}

const TABS: Array<{ id: Shown; label: string; hint: string }> = [
  { id: "tip", label: "Tips", hint: "A match, a bet and a price, with no selling." },
  { id: "maybe", label: "Check", hint: "Looks like a tip but is mixed with selling or is missing something. Your call." },
  { id: "advert", label: "Adverts", hint: "Selling VIP, premium or a service. Hidden from the tips." },
  { id: "other", label: "Other", hint: "Chatter, results and anything you marked 'Not a tip'." },
];

const BADGE: Record<Shown, string> = {
  tip: "bg-hit/20 text-ink",
  maybe: "bg-warn/20 text-warn-ink",
  advert: "bg-destructive/15 text-danger-ink",
  other: "bg-surface-2 text-ink-muted",
};

const PREFIX = "Telegram: ";
const PALETTE = ["#d98a00", "#0fa37f", "#3f7ce0", "#a266d9", "#d6497a", "#2ea3b5", "#8c6d1f", "#5b8c2a"];
const dayLabel = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", day: "numeric", month: "short" });

/**
 * Results, one line per channel (each channel is a strategy of its own, "Telegram: <channel>"): every settled bet counts
 * as a win or a loss, drawn as running units (profit at a flat 1 unit a bet, so a stake change can't skew it) or in £.
 */
function ResultsGraph() {
  const { data } = useAdminStrategies(null);
  const channels = (data?.strategies ?? []).filter((r) => r.label.startsWith(PREFIX));
  const curves = useChannelEquity(channels.map((c) => c.label));
  const [inUnits, setInUnits] = useState(true);
  if (!data) return null;
  if (channels.length === 0) {
    return <p className="rounded-xl border border-line bg-surface p-3.5 text-sm text-ink-muted">Results will appear here, one line per channel, once the first tip has been placed in Sim and has finished.</p>;
  }
  const series: LineSeries[] = channels.map((c, i) => ({ key: `k${i}`, name: c.label.slice(PREFIX.length), color: PALETTE[i % PALETTE.length]! }));
  const events = curves
    .flatMap((q, i) => (q.data?.points ?? []).map((p) => ({ at: p.at, i, v: inUnits ? (p.units ?? 0) : p.total })))
    .sort((a, b) => a.at.localeCompare(b.at));
  const running = channels.map(() => 0);
  const rows = events.map((e) => {
    running[e.i] = e.v;
    const row: Record<string, number | string> = { label: dayLabel.format(new Date(e.at)) };
    running.forEach((v, i) => (row[`k${i}`] = v));
    return row;
  });
  return (
    <section className="rounded-xl border border-line bg-surface p-3.5">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-medium text-ink">Results by channel</p>
        <div className="inline-flex rounded-md border border-line p-0.5" role="group" aria-label="Show results in">
          {([[true, "Units"], [false, "£"]] as const).map(([u, label]) => (
            <button key={label} type="button" aria-pressed={inUnits === u} onClick={() => setInUnits(u)} className={`min-h-10 rounded px-4 py-2 text-xs font-medium ${inUnits === u ? "bg-accent text-accent-ink" : "text-ink"}`}>
              {label}
            </button>
          ))}
        </div>
      </div>
      <p className="text-xs text-ink-muted">In Sim at each channel&apos;s stake, priced at Betfair&apos;s price when the tip was read. One unit is a flat stake on every bet. Tap a channel in the key to highlight its line.</p>
      {rows.length === 0 ? (
        <p className="mt-2 text-sm text-ink-muted">No tip has finished yet, so there is nothing to draw.</p>
      ) : (
        <div className="mt-2">
          <WinLossLines data={rows} series={series} inUnits={inUnits} selectable />
        </div>
      )}
      <ul className="mt-3 divide-y divide-line">
        {channels.map((c, i) => {
          const pts = curves[i]?.data?.points ?? [];
          const wins = pts.filter((p) => p.result === "hit").length;
          const losses = pts.length - wins;
          const last = pts[pts.length - 1];
          return (
            <li key={c.label}>
              <Link href={strategyHref(c.label)} className="flex min-h-12 items-center justify-between gap-3 py-2">
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium text-ink">{c.label.slice(PREFIX.length)}</span>
                  <span className="text-xs text-ink-muted">
                    {pts.length} bets: {wins} won, {losses} lost{pts.length > 0 ? ` · ${Math.round((100 * wins) / pts.length)}% hit` : ""}
                  </span>
                </span>
                <span className="shrink-0 text-right text-sm font-medium tabular-nums">
                  <span className={(last?.units ?? 0) > 0 ? "text-hit" : (last?.units ?? 0) < 0 ? "text-loss" : "text-ink-muted"}>{last ? units(last.units ?? 0) : "–"}</span>
                  <span className="block text-xs font-normal text-ink-muted">{last ? gbp(last.total) : ""}</span>
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}


type BetKind = "home" | "away" | "draw" | "over" | "under" | "btts-yes" | "btts-no" | "other";
const LINES = [0.5, 1.5, 2.5, 3.5, 4.5, 5.5];

/**
 * Tell GoalBrew what the bet is when it couldn't tell, and how it ended when it can't find out: a bet Betfair lists is priced and
 * settled from Betfair; with a result given, or for a bet it can't price (a first half, corners), it is recorded by hand at the
 * odds you give. It counts in the channel's results like any other pick.
 */
function BetPanel({ t, change, onDone }: { t: ChannelTip; change: ReturnType<typeof useChangeTips>; onDone: () => void }) {
  const [home = "", away = ""] = (t.match ?? "").split(" v ");
  const [kind, setKind] = useState<BetKind | null>(null);
  const [line, setLine] = useState(2.5);
  const [text, setText] = useState("");
  const [result, setResult] = useState<"" | "won" | "lost">("");
  const [odds, setOdds] = useState(t.myOdds ? String(t.myOdds) : t.odds ? String(t.odds) : "");
  const kinds: Array<{ id: BetKind; label: string }> = [
    ...(t.match ? [{ id: "home" as const, label: `${home} to win` }, { id: "away" as const, label: `${away} to win` }] : []),
    { id: "draw", label: "Draw" },
    { id: "over", label: "Over goals" },
    { id: "under", label: "Under goals" },
    { id: "btts-yes", label: "Both score: Yes" },
    { id: "btts-no", label: "Both score: No" },
    { id: "other", label: "Something else" },
  ];
  const needsResult = kind === "other";
  const oddsNum = Number(odds);
  const oddsOk = odds.trim() !== "" && oddsNum > 1;
  const ready = kind !== null && (kind !== "other" || text.trim() !== "") && (!needsResult || result !== "") && (result === "" || oddsOk);
  const save = () => {
    if (!kind) return;
    change.mutate(
      {
        action: "bet",
        chatKey: t.chatKey,
        messageId: t.messageId,
        bet: kind === "over" || kind === "under" ? { kind, line } : kind === "other" ? { kind, text } : { kind },
        odds: odds.trim() === "" ? null : oddsNum,
        result: result || null,
      },
      { onSuccess: onDone },
    );
  };
  const chip = (on: boolean) => `min-h-11 rounded-full border px-3 py-2 text-xs font-medium ${on ? "border-ink bg-ink text-surface" : "border-line text-ink"}`;
  return (
    <div className="mt-3 space-y-3 rounded-lg bg-surface-2 p-3">
      <p className="whitespace-pre-line text-sm text-ink">{t.text}</p>
      {!t.match && <p className="text-xs text-warn-ink">No match was read from this post, so team bets aren&apos;t offered and it can&apos;t be recorded by hand.</p>}
      <div>
        <p className="text-xs font-medium text-ink">What is the bet?</p>
        <div className="mt-1.5 flex flex-wrap gap-2" role="group" aria-label="The bet">
          {kinds.map((k) => (
            <button key={k.id} type="button" aria-pressed={kind === k.id} onClick={() => setKind(k.id)} className={chip(kind === k.id)}>
              {k.label}
            </button>
          ))}
        </div>
        {(kind === "over" || kind === "under") && (
          <label className="mt-2 flex items-center gap-2 text-xs text-ink-muted">
            Goals line
            <select value={line} onChange={(e) => setLine(Number(e.target.value))} className="min-h-11 rounded-md border border-line bg-surface px-3 text-base text-ink">
              {LINES.map((l) => (
                <option key={l} value={l}>
                  {kind === "over" ? "Over" : "Under"} {l}
                </option>
              ))}
            </select>
          </label>
        )}
        {kind === "other" && (
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            maxLength={80}
            placeholder="e.g. 1st half over 0.5 goals"
            aria-label="What the bet is"
            enterKeyHint="done"
            className="mt-2 min-h-11 w-full rounded-md border border-line bg-surface px-3 text-base text-ink"
          />
        )}
      </div>
      {kind !== null && (
        <div>
          <p className="text-xs font-medium text-ink">{needsResult ? "How did it end?" : "Already finished? (otherwise GoalBrew prices it and finds the result itself)"}</p>
          <div className="mt-1.5 flex flex-wrap gap-2" role="group" aria-label="How it ended">
            {!needsResult && (
              <button type="button" aria-pressed={result === ""} onClick={() => setResult("")} className={chip(result === "")}>
                Not yet
              </button>
            )}
            <button type="button" aria-pressed={result === "won"} onClick={() => setResult("won")} className={chip(result === "won")}>
              Won
            </button>
            <button type="button" aria-pressed={result === "lost"} onClick={() => setResult("lost")} className={chip(result === "lost")}>
              Lost
            </button>
          </div>
          {(result !== "" || needsResult) && (
            <label className="mt-2 flex items-center gap-2 text-xs text-ink-muted">
              Odds (decimal)
              <input value={odds} onChange={(e) => setOdds(e.target.value)} inputMode="decimal" placeholder="1.85" aria-label="Odds" className="min-h-11 w-28 rounded-md border border-line bg-surface px-3 text-base text-ink" />
            </label>
          )}
        </div>
      )}
      {change.error && <p className="text-sm text-destructive">{change.error.message}</p>}
      <div className="flex gap-2">
        <button type="button" disabled={!ready || change.isPending} onClick={save} className="min-h-11 flex-1 rounded-md bg-ink px-4 py-2 text-sm font-medium text-surface disabled:opacity-40">
          {result === "" ? "Save and track it" : "Record the result"}
        </button>
        <button type="button" onClick={onDone} className="min-h-11 rounded-md border border-line px-4 py-2 text-sm font-medium text-ink">
          Cancel
        </button>
      </div>
    </div>
  );
}

/**
 * Free tips: the Telegram channels you follow, with each message read as a tip, an advert or neither. Read-only: nothing
 * here places a bet. Your Tip / Not a tip buttons override the reading.
 */
export default function TipsPage() {
  const { data, isLoading, error } = useTips();
  const change = useChangeTips();
  const [tab, setTab] = useState<Shown>("tip");
  const [channel, setChannel] = useState("");
  // The tip whose bet is being set ("chatKey:messageId").
  const [setting, setSetting] = useState<string | null>(null);
  // Hundreds of messages in a fortnight made this page about ten phone screens long: twenty at a time.
  const rows = (data?.tips ?? []).filter((t) => effective(t) === tab);
  const { shown, more } = useShowMore(rows, 20, tab);
  if (error) return <QueryError error={error} next="/more/admin/tips" />;
  if (isLoading || !data) return <Skeleton className="h-40 w-full" />;

  const counts: Record<Shown, number> = { tip: 0, maybe: 0, advert: 0, other: 0 };
  for (const t of data.tips) counts[effective(t)]++;
  const hint = TABS.find((x) => x.id === tab)!.hint;

  return (
    <div className="space-y-4">
      <PageHeader
        as="h2"
        title="Free tips"
        subtitle="Telegram channels you follow, read for real bets. Adverts for premium groups are filtered out. Tips that can be placed on Betfair are recorded in Sim as the strategy Telegram tips (it stays in Sim until you switch it Live)."
      />

      <ResultsGraph />

      <details className="rounded-xl border border-line bg-surface p-3.5" open={data.channels.length === 0}>
        <summary className="flex min-h-11 cursor-pointer items-center justify-between gap-3 text-sm font-medium text-ink">
          <span>Settings</span>
          <span className="text-xs font-normal text-ink-muted">
            {data.channels.length} channel{data.channels.length === 1 ? "" : "s"} · costs
          </span>
        </summary>
        <p className="mt-2 text-sm font-medium text-ink">Channels</p>
        <ul className="mt-2 space-y-1.5">
          {data.channels.length === 0 && <li className="text-sm text-ink-muted">None yet. Add a channel below (the Telegram account GoalBrew is logged in as must already be a member).</li>}
          {data.channels.map((c) => (
            <li key={c} className="flex items-center justify-between gap-3 text-sm text-ink">
              <span className="min-w-0 truncate">{c}</span>
              <button type="button" disabled={change.isPending} onClick={() => change.mutate({ action: "remove", channel: c })} className="min-h-11 shrink-0 rounded-md border border-line px-3 py-2 text-xs font-medium text-ink">
                Remove
              </button>
            </li>
          ))}
        </ul>
        <form
          className="mt-3 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (!channel.trim()) return;
            change.mutate({ action: "add", channel }, { onSuccess: () => setChannel("") });
          }}
        >
          <input
            value={channel}
            onChange={(e) => setChannel(e.target.value)}
            placeholder="@freetips or t.me/freetips"
            aria-label="Channel to read"
            className="min-h-11 min-w-0 flex-1 rounded-md border border-line bg-surface px-3 py-2 text-sm text-ink"
          />
          <button type="submit" disabled={change.isPending} className="min-h-11 shrink-0 rounded-md bg-ink px-4 py-2 text-sm font-medium text-surface">
            Add
          </button>
        </form>
        {change.error && <p className="mt-2 text-sm text-destructive">{change.error.message}</p>}
        <p className="mt-4 text-sm font-medium text-ink">Notifications</p>
        <div className="mt-1 space-y-1">
          <label className="flex min-h-11 items-center justify-between gap-3 text-sm text-ink">
            <span>Notify me when a proper tip comes in</span>
            <input type="checkbox" checked={data.notify.on} disabled={change.isPending} onChange={(e) => change.mutate({ action: "notify", on: e.target.checked })} className="h-5 w-5" />
          </label>
          <label className="flex min-h-11 items-center justify-between gap-3 text-sm text-ink">
            <span>Not between 23:00 and 07:00</span>
            <input type="checkbox" checked={data.notify.quiet} disabled={change.isPending || !data.notify.on} onChange={(e) => change.mutate({ action: "notify", quiet: e.target.checked })} className="h-5 w-5" />
          </label>
          <p className="text-xs text-ink-muted">Only tips read as proper ones (or marked Tip) and found within 15 minutes of being posted. Tapping it opens this page.</p>
        </div>

        <p className="mt-4 text-sm font-medium text-ink">Costs</p>
        <p className="mt-1 text-xs text-ink-muted">
          Reading the text posts is free. Today nothing here costs anything: slip images are not read. If they were, each image would cost about 0.2p to read with a small Claude model (an estimate, not a quote), so the monthly figure is what that would add up to.
        </p>
        {data.stats.length === 0 ? (
          <p className="mt-2 text-xs text-ink-muted">Photo counts appear here once the channels have been read.</p>
        ) : (
          (() => {
            const lines = data.stats.map((s) => {
              const days = Math.max((Date.parse(s.to) - Date.parse(s.from)) / 86_400_000, 1);
              const perDay = s.photos / days;
              return { s, days, perDay, perMonth: perDay * 30 * 0.002 };
            });
            const total = lines.reduce((a, l) => a + l.perMonth, 0);
            return (
              <>
                <ul className="mt-2 divide-y divide-line">
                  {lines.map((l) => (
                    <li key={l.s.name} className="flex items-start justify-between gap-3 py-2">
                      <span className="min-w-0 text-xs text-ink-muted">
                        <span className="block truncate text-sm text-ink">{l.s.name}</span>
                        {l.s.photos} photos and {l.s.withText} text posts in the last {Math.round(l.days)} days (about {Math.round(l.perDay)} photos a day)
                      </span>
                      <span className="shrink-0 text-sm tabular-nums text-ink">£{l.perMonth.toFixed(2)}</span>
                    </li>
                  ))}
                </ul>
                <p className="mt-1 flex justify-between text-sm font-medium text-ink">
                  <span>If images were read, per month</span>
                  <span className="tabular-nums">£{total.toFixed(2)}</span>
                </p>
              </>
            );
          })()
        )}
      </details>

      <div className="flex gap-1.5 overflow-x-auto" role="tablist">
        {TABS.map((x) => (
          <button
            key={x.id}
            type="button"
            role="tab"
            aria-selected={tab === x.id}
            onClick={() => setTab(x.id)}
            className={`min-h-11 shrink-0 rounded-full border px-4 py-2 text-xs font-medium ${tab === x.id ? "border-ink bg-ink text-surface" : "border-line text-ink"}`}
          >
            {x.label} {counts[x.id]}
          </button>
        ))}
      </div>
      <p className="text-xs text-ink-muted">{hint} Last 14 days.</p>

      {rows.length === 0 ? (
        <p className="text-sm text-ink-muted">{data.channels.length === 0 ? "Add a channel to start reading." : "Nothing here yet."}</p>
      ) : (
        <ul className="space-y-3">
          {shown.map((t) => (
            <li key={`${t.chatKey}:${t.messageId}`} className="rounded-xl border border-line bg-surface p-3.5">
              <div className="flex items-center justify-between gap-2 text-xs text-ink-muted">
                <span className="min-w-0 truncate">{t.channel}</span>
                <span className="shrink-0">{when.format(new Date(t.postedAt))}</span>
              </div>
              {(t.match || t.selection || t.odds !== null) && (
                <div className="mt-1.5">
                  {t.match && <p className="font-medium text-ink">{t.match}</p>}
                  <p className="text-sm text-ink">
                    {t.selection ?? "Selection not clear"}
                    {t.odds !== null && <span className="tabular-nums"> @ {t.odds}</span>}
                    {t.stake && <span className="text-ink-muted"> · {t.stake}</span>}
                  </p>
                </div>
              )}
              {effective(t) === "tip" && (
                <p className="mt-1 text-xs font-medium text-ink">
                  {t.tracked === "done" ? "Recorded in Sim as Telegram tips" : t.tracked ? `Not tracked: ${t.tracked.replace(/^no: /, "")}` : "Waiting to be priced on Betfair"}
                </p>
              )}
              <p className="mt-1.5 line-clamp-4 whitespace-pre-line text-xs text-ink-muted">{t.text}</p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${BADGE[effective(t)]}`}>{t.review ? "You decided" : "Read as"}: {effective(t) === "other" && t.review ? "not a tip" : effective(t)}</span>
                <span className="text-xs text-ink-muted">{t.reasons.slice(0, 3).join(" · ")}</span>
              </div>
              {t.myBet && (
                <p className="mt-1 text-xs font-medium text-ink">
                  Your bet: {t.myBet}
                  {t.myOdds ? ` @ ${t.myOdds}` : ""}
                </p>
              )}
              <div className="mt-2 flex gap-2">
                <button type="button" disabled={change.isPending} onClick={() => change.mutate({ action: "review", chatKey: t.chatKey, messageId: t.messageId, review: t.review === "tip" ? null : "tip" })} className={`min-h-11 flex-1 rounded-md border px-3 py-2 text-xs font-medium ${t.review === "tip" ? "border-ink bg-ink text-surface" : "border-line text-ink"}`}>
                  Tip
                </button>
                <button type="button" disabled={change.isPending} onClick={() => change.mutate({ action: "review", chatKey: t.chatKey, messageId: t.messageId, review: t.review === "not" ? null : "not" })} className={`min-h-11 flex-1 rounded-md border px-3 py-2 text-xs font-medium ${t.review === "not" ? "border-ink bg-ink text-surface" : "border-line text-ink"}`}>
                  Not a tip
                </button>
              </div>
              {setting === `${t.chatKey}:${t.messageId}` ? (
                <BetPanel t={t} change={change} onDone={() => setSetting(null)} />
              ) : (
                <button type="button" onClick={() => setSetting(`${t.chatKey}:${t.messageId}`)} className="mt-2 min-h-11 w-full rounded-md border border-line px-3 py-2 text-xs font-medium text-accent">
                  {t.tracked === "done" ? "See the whole post" : "Set the bet / record the result"}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {more}
    </div>
  );
}
