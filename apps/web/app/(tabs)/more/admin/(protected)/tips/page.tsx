"use client";

import { useState } from "react";
import { PageHeader } from "@/components/ui/Card";
import { Skeleton } from "@/components/ui/Skeleton";
import { QueryError } from "@/components/ui/QueryError";
import { useChangeTips, useTips, type ChannelTip } from "@/queries/use-tips";
import { useWinLoss } from "@/queries/use-winloss";
import { WinLossLines, gbp } from "@/components/admin/WinLossLines";

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

const STRATEGY_KEY = "telegram tips";

/** The Telegram tips strategy's cumulative profit and loss, from the Profit page's data. */
function ResultsGraph() {
  const { data } = useWinLoss("all");
  if (!data) return null;
  const line = data.strategies.find((s) => s.key === STRATEGY_KEY);
  if (!line) {
    return <p className="rounded-xl border border-line bg-surface p-3.5 text-sm text-ink-muted">Results will appear here once the first tip has been placed in Sim and has finished.</p>;
  }
  const rows = data.series.ytd.map((p) => ({ label: p.label.slice(5), t: p.s[STRATEGY_KEY] ?? 0 }));
  const last = rows.length ? rows[rows.length - 1]!.t : 0;
  return (
    <section className="rounded-xl border border-line bg-surface p-3.5">
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-sm font-medium text-ink">Telegram tips: results</p>
        <p className={`text-sm font-medium tabular-nums ${last > 0 ? "text-hit" : last < 0 ? "text-loss" : "text-ink-muted"}`}>{gbp(last)}</p>
      </div>
      <p className="text-xs text-ink-muted">{line.counted} bets so far this year, in Sim at the strategy&apos;s stake, priced at Betfair&apos;s price when each tip was read.</p>
      <div className="mt-2">
        <WinLossLines data={rows} series={[{ key: "t", name: "Telegram tips", color: "var(--chart)" }]} />
      </div>
    </section>
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
  if (error) return <QueryError error={error} next="/more/admin/tips" />;
  if (isLoading || !data) return <Skeleton className="h-40 w-full" />;

  const counts: Record<Shown, number> = { tip: 0, maybe: 0, advert: 0, other: 0 };
  for (const t of data.tips) counts[effective(t)]++;
  const rows = data.tips.filter((t) => effective(t) === tab);
  const hint = TABS.find((x) => x.id === tab)!.hint;

  return (
    <div className="space-y-4">
      <PageHeader
        as="h2"
        title="Free tips"
        subtitle="Telegram channels you follow, read for real bets. Adverts for premium groups are filtered out. Tips that can be placed on Betfair are recorded in Sim as the strategy Telegram tips (it stays in Sim until you switch it Live)."
      />

      <ResultsGraph />

      <section className="rounded-xl border border-line bg-surface p-3.5">
        <p className="text-sm font-medium text-ink">Channels</p>
        <ul className="mt-2 space-y-1.5">
          {data.channels.length === 0 && <li className="text-sm text-ink-muted">None yet. Add a channel below (the Telegram account GoalBrew is logged in as must already be a member).</li>}
          {data.channels.map((c) => (
            <li key={c} className="flex items-center justify-between gap-3 text-sm text-ink">
              <span className="min-w-0 truncate">{c}</span>
              <button type="button" disabled={change.isPending} onClick={() => change.mutate({ action: "remove", channel: c })} className="shrink-0 rounded-md border border-line px-3 py-2 text-xs font-medium text-ink">
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
            className="min-w-0 flex-1 rounded-md border border-line bg-surface px-3 py-2 text-sm text-ink"
          />
          <button type="submit" disabled={change.isPending} className="shrink-0 rounded-md bg-ink px-4 py-2 text-sm font-medium text-surface">
            Add
          </button>
        </form>
        {change.error && <p className="mt-2 text-sm text-destructive">{change.error.message}</p>}
        {data.stats.map((s) => {
          const days = Math.max((Date.parse(s.to) - Date.parse(s.from)) / 86_400_000, 1);
          const perDay = s.photos / days;
          // About 0.2p to read one slip image with a small Claude model (an estimate, not a quote).
          const perMonth = perDay * 30 * 0.002;
          return (
            <p key={s.name} className="mt-2 text-xs text-ink-muted">
              {s.name}: {s.photos} photos and {s.withText} text posts in the last {Math.round(days)} days, about {Math.round(perDay)} photos a day. Reading the images would cost roughly £{perMonth.toFixed(2)} a month.
            </p>
          );
        })}
      </section>

      <div className="flex gap-1.5 overflow-x-auto" role="tablist">
        {TABS.map((x) => (
          <button
            key={x.id}
            type="button"
            role="tab"
            aria-selected={tab === x.id}
            onClick={() => setTab(x.id)}
            className={`shrink-0 rounded-full border px-3 py-2 text-xs font-medium ${tab === x.id ? "border-ink bg-ink text-surface" : "border-line text-ink"}`}
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
          {rows.map((t) => (
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
              <div className="mt-2 flex gap-2">
                <button type="button" disabled={change.isPending} onClick={() => change.mutate({ action: "review", chatKey: t.chatKey, messageId: t.messageId, review: t.review === "tip" ? null : "tip" })} className={`rounded-md border px-3 py-2 text-xs font-medium ${t.review === "tip" ? "border-ink bg-ink text-surface" : "border-line text-ink"}`}>
                  Tip
                </button>
                <button type="button" disabled={change.isPending} onClick={() => change.mutate({ action: "review", chatKey: t.chatKey, messageId: t.messageId, review: t.review === "not" ? null : "not" })} className={`rounded-md border px-3 py-2 text-xs font-medium ${t.review === "not" ? "border-ink bg-ink text-surface" : "border-line text-ink"}`}>
                  Not a tip
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
