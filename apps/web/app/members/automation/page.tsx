"use client";

import { useState } from "react";
import { OctagonX } from "lucide-react";
import { PageHeader, Card } from "@/components/ui/Card";
import { Skeleton } from "@/components/ui/Skeleton";
import { gbp } from "@/lib/format";
import { useDialog } from "@/components/ui/ConfirmDialog";
import { useMembersAction, useMembersAutomation, useMembersMe } from "@/queries/use-members";
import { btn, btnPrimary, input, LockedFeature, ModeBadge, ModeBanner, SaferGambling, when } from "@/components/members/ui";

/**
 * Betfair Automation: the connection, live betting (off unless every switch is on), the STOP button, and which
 * strategies run in simulation or live. Live never starts because a connection exists: the member must switch it on
 * and type the confirmation.
 */
export default function AutomationPage() {
  const me = useMembersMe();
  const { data, isLoading } = useMembersAutomation();
  const connect = useMembersAction<{ kind: string }>("betfair/connect");
  const disconnect = useMembersAction("betfair/disconnect");
  const live = useMembersAction<{ on: boolean; confirmation?: string }>("live");
  const stop = useMembersAction("live/stop");
  const follow = useMembersAction("follow");
  const { confirm } = useDialog();
  const [words, setWords] = useState("");
  if (isLoading || !data || !me.data) return <Skeleton className="h-96 w-full" />;
  const c = data.connection;

  return (
    <div className="space-y-5">

      <PageHeader title="Betfair Automation" subtitle="Run strategies automatically: in simulation for everyone, and live on Betfair where it's available." />

      {(data.live.enabled || data.follows.some((f) => f.mode === "live")) && (
        <button
          type="button"
          onClick={async () => {
            if (await confirm({ title: "Stop all live betting?", body: "No more real bets will be placed. Waiting bets are cancelled and your strategies go back to simulation.", confirmLabel: "Stop all live betting", tone: "danger" }))
              stop.mutate({});
          }}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-loss px-4 py-3 text-sm font-bold text-white"
        >
          <OctagonX size={18} /> STOP ALL LIVE BETTING
        </button>
      )}

      <Card title="Betfair connection">
        <p className="text-sm text-ink">
          Status: <strong>{c.status === "connected" ? "Connected" : c.status === "error" ? "Not working" : "Not connected"}</strong>
          {c.kind === "house" && " (GoalBrew account)"}
        </p>
        {c.lastTestAt && <p className="text-xs text-ink-muted">Last checked {when(c.lastTestAt)}</p>}
        {c.lastError && <p className="mt-1 text-sm text-destructive">{c.lastError}</p>}
        {c.account && (
          <p className="mt-1 text-xs text-ink-muted">
            Available balance {c.account.available === null ? "unknown" : gbp(c.account.available, false)}
            {c.account.delayedKey ? " · delayed app key (prices up to a few seconds old; bets still match at the best price on offer)" : ""}
          </p>
        )}
        <div className="mt-3 flex flex-wrap gap-2">
          {c.options.house.available && (
            <button type="button" className={btnPrimary} disabled={connect.isPending} onClick={() => connect.mutate({ kind: "house" })}>
              {c.kind === "house" ? "Test connection" : "Connect GoalBrew account"}
            </button>
          )}
          {c.kind !== "none" && (
            <button type="button" className={btn} onClick={() => disconnect.mutate({})}>
              Disconnect
            </button>
          )}
        </div>
        {connect.error && <p className="mt-2 text-sm text-destructive">{connect.error.message}</p>}
        <p className="mt-3 text-xs text-ink-muted">{c.options.vendor.reason}</p>
        {!c.options.house.available && c.options.house.reason && me.data.tier === "admin" && <p className="mt-1 text-xs text-ink-muted">{c.options.house.reason}</p>}
      </Card>

      {!data.live.allowedByMembership ? (
        <LockedFeature me={me.data} feature="live_betting" title="Live betting" pitch="Paid members can run approved strategies on Betfair automatically, with stake limits, loss limits and a stop button." />
      ) : (
        <Card title="Live betting" actions={<ModeBadge mode="live" />}>
          <ModeBanner mode="live" />
          <p className="mt-3 text-sm text-ink">
            Live betting is <strong>{data.live.enabled && !data.live.paused ? "on" : "off"}</strong>.
            {data.live.blockedReason && data.live.enabled ? ` Not placing bets: ${data.live.blockedReason}` : ""}
          </p>
          {!data.live.globalOn && <p className="mt-1 text-xs text-ink-muted">Live betting is currently switched off for all members.</p>}
          {data.live.enabled ? (
            <button type="button" className={`${btn} mt-3`} onClick={() => live.mutate({ on: false })}>
              Switch live betting off
            </button>
          ) : (
            <div className="mt-3 space-y-2">
              <p className="text-xs text-ink-muted">
                To switch live betting on, type <strong className="text-ink">{data.live.confirmation}</strong> below. Set your limits in Settings first: every bet is checked
                against them.
              </p>
              <input className={input} value={words} onChange={(e) => setWords(e.target.value)} placeholder={data.live.confirmation} aria-label="Confirmation" />
              <button type="button" className={btnPrimary} disabled={words !== data.live.confirmation || live.isPending} onClick={() => live.mutate({ on: true, confirmation: words })}>
                Switch live betting on
              </button>
            </div>
          )}
          {live.error && <p className="mt-2 text-sm text-destructive">{live.error.message}</p>}
          <div className="mt-3">
            <SaferGambling />
          </div>
        </Card>
      )}

      <Card title="Strategies you follow" subtitle="Each alert of a followed strategy becomes a bet automatically, in the mode shown.">
        {data.follows.length === 0 ? (
          <p className="text-sm text-ink-muted">You don&apos;t follow any strategies yet. Follow them on Strategies.</p>
        ) : (
          <ul className="divide-y divide-line">
            {data.follows.map((f) => (
              <li key={f.strategyKey} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span className="flex items-center gap-2 text-sm text-ink">
                  {f.strategyName} <ModeBadge mode={f.mode} />
                </span>
                <span className="flex gap-2">
                  {f.mode === "sim" && f.liveApproved && data.live.enabled && (
                    <button
                      type="button"
                      className={btn}
                      onClick={async () => {
                        if (await confirm({ title: `Bet ${f.strategyName} live?`, body: "Each new alert will be placed on Betfair with real money, within your limits.", confirmLabel: "Bet live", tone: "danger" }))
                          follow.mutate({ strategy: f.strategyKey, mode: "live", auto: true });
                      }}
                    >
                      Make live
                    </button>
                  )}
                  {f.mode === "live" && (
                    <button type="button" className={btn} onClick={() => follow.mutate({ strategy: f.strategyKey, mode: "sim", auto: true })}>
                      Back to simulation
                    </button>
                  )}
                  <button type="button" className={btn} onClick={() => follow.mutate({ strategy: f.strategyKey, off: true })}>
                    Stop following
                  </button>
                </span>
              </li>
            ))}
          </ul>
        )}
        {follow.error && <p className="mt-2 text-sm text-destructive">{follow.error.message}</p>}
      </Card>

      <Card title="How a bet is placed">
        <ol className="list-decimal space-y-1 pl-5 text-xs text-ink-muted">
          <li>A house strategy fires an alert.</li>
          <li>For each member following it: simulation or live, as chosen.</li>
          <li>Your limits are checked (stake, daily stake and loss, bets per day, exposure, odds, stop loss, minimum bank).</li>
          <li>The same alert is never bet twice for you.</li>
          <li>Live only: the price on Betfair now must be within your tolerance of the alert&apos;s price.</li>
          <li>The bet is placed (or simulated), confirmed and settled from the result. A bet not placed is recorded with the reason.</li>
        </ol>
      </Card>
    </div>
  );
}
