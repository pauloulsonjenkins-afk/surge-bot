"use client";

import { useState } from "react";
import { PageHeader, Card } from "@/components/ui/Card";
import { Skeleton } from "@/components/ui/Skeleton";
import { gbp } from "@/lib/format";
import { useDialog } from "@/components/ui/ConfirmDialog";
import { useMembersAction, useMembersCommunity, useMembersMe } from "@/queries/use-members";
import type { Community, CommunityRecord } from "@/lib/members/types";
import { btn, btnPrimary, input, LockedFeature, ModeBadge, pct } from "@/components/members/ui";

/**
 * Community. Today: "Coming soon", plus private strategies for paid members (built on the house alerts, so their
 * results are worked out by GoalBrew, never typed in). Sharing and the leaderboard open when the admin switches them on.
 */
export default function CommunityPage() {
  const me = useMembersMe();
  const { data, isLoading } = useMembersCommunity();
  if (isLoading || !data || !me.data) return <Skeleton className="h-96 w-full" />;
  return (
    <div className="space-y-5">
      <PageHeader title="Community" subtitle="Build your own strategies on top of the house alerts, test them, and later share them." />
      {!data.leaderboard.enabled && (
        <Card title="Coming soon">
          <ul className="list-disc space-y-1 pl-5 text-sm text-ink-muted">
            <li>Build strategies from the house alerts with your own filters (minute, odds, leagues).</li>
            <li>Test them on past alerts and track them going forward, in simulation.</li>
            <li>Keep them private, or share them with the community.</li>
            <li>A leaderboard of shared strategies, with results verified by GoalBrew and ranked fairly for sample size.</li>
          </ul>
        </Card>
      )}
      {data.leaderboard.enabled && <Leaderboard rows={data.leaderboard.rows} />}
      {data.canCreate ? (
        <>
          <NewStrategy catalogue={data.catalogue} />
          <OwnStrategies own={data.own} />
        </>
      ) : (
        <LockedFeature me={me.data} feature="create_strategy" title="Create your own strategies" pitch="Members can build private strategies on the house alerts and see how they would have done." />
      )}
    </div>
  );
}

function Record({ r, label }: { r: CommunityRecord; label: string }) {
  return (
    <p className="text-xs text-ink-muted">
      <span className="text-ink">{label}:</span> {r.bets} bets · {r.wins}W/{r.losses}L · hit {pct(r.hitRate)} ·{" "}
      <span className={r.profit > 0 ? "text-hit" : r.profit < 0 ? "text-loss" : ""}>{gbp(r.profit)}</span> · ROI {pct(r.roi, true)} · drawdown {gbp(-r.maxDrawdown)}
    </p>
  );
}

function NewStrategy({ catalogue }: { catalogue: Community["catalogue"] }) {
  const create = useMembersAction("community/create");
  const [name, setName] = useState("");
  const [base, setBase] = useState<string[]>([]);
  const [f, setF] = useState({ minuteMin: "", minuteMax: "", oddsMin: "", oddsMax: "", leagues: "" });
  const n = (v: string) => (v.trim() ? Number(v) : null);
  return (
    <Card title="New private strategy" subtitle="Start from one or more house strategies, then narrow them down.">
      <div className="space-y-3">
        <input className={input} placeholder="Name" maxLength={40} value={name} onChange={(e) => setName(e.target.value)} />
        <div className="flex flex-wrap gap-2">
          {catalogue.map((c) => (
            <button
              key={c.key}
              type="button"
              aria-pressed={base.includes(c.key)}
              onClick={() => setBase((b) => (b.includes(c.key) ? b.filter((x) => x !== c.key) : [...b, c.key]))}
              className={`rounded-full border px-3 py-1 text-xs ${base.includes(c.key) ? "border-accent bg-accent/15 text-ink" : "border-line text-ink-muted"}`}
            >
              {c.name}
            </button>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {(
            [
              ["minuteMin", "From minute"],
              ["minuteMax", "To minute"],
              ["oddsMin", "Odds from"],
              ["oddsMax", "Odds to"],
            ] as const
          ).map(([k, l]) => (
            <label key={k} className="text-xs text-ink-muted">
              {l}
              <input className={`${input} mt-1`} inputMode="decimal" value={f[k]} onChange={(e) => setF((x) => ({ ...x, [k]: e.target.value }))} />
            </label>
          ))}
        </div>
        <label className="block text-xs text-ink-muted">
          Only leagues containing (comma separated, optional)
          <input className={`${input} mt-1`} value={f.leagues} onChange={(e) => setF((x) => ({ ...x, leagues: e.target.value }))} />
        </label>
        <button
          type="button"
          className={btnPrimary}
          disabled={!name.trim() || base.length === 0 || create.isPending}
          onClick={() =>
            create.mutate(
              { name, rules: { base, minuteMin: n(f.minuteMin), minuteMax: n(f.minuteMax), oddsMin: n(f.oddsMin), oddsMax: n(f.oddsMax), leagues: f.leagues.split(",").map((s) => s.trim()).filter(Boolean), excludeLeagues: [] } },
              { onSuccess: () => (setName(""), setBase([])) },
            )
          }
        >
          Create
        </button>
        {create.error && <p className="text-sm text-destructive">{create.error.message}</p>}
      </div>
    </Card>
  );
}

function OwnStrategies({ own }: { own: Community["own"] }) {
  const update = useMembersAction("community/update");
  const del = useMembersAction("community/delete");
  const { confirm } = useDialog();
  if (own.length === 0) return null;
  return (
    <Card title="Your strategies" subtitle="Private to you. Tracked = alerts since you created it, judged by the rules in force at the time.">
      <ul className="divide-y divide-line">
        {own.map(({ strategy: s, record }) => (
          <li key={s.id} className="space-y-1 py-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="flex items-center gap-2 text-sm font-semibold text-ink">
                {s.name} <ModeBadge mode="sim" /> <span className="text-xs font-normal text-ink-muted">v{s.currentVersion} · {s.status}</span>
              </p>
              <span className="flex gap-2">
                <button type="button" className={btn} onClick={() => update.mutate({ id: s.id, status: s.status === "paused" ? "active" : "paused" })}>
                  {s.status === "paused" ? "Resume" : "Pause"}
                </button>
                <button type="button" className={btn} onClick={() => update.mutate({ id: s.id, status: "archived" })}>
                  Archive
                </button>
                <button
                  type="button"
                  className={btn}
                  onClick={async () => {
                    if (await confirm({ title: `Delete ${s.name}?`, confirmLabel: "Delete", tone: "danger" })) del.mutate({ id: s.id });
                  }}
                >
                  Delete
                </button>
              </span>
            </div>
            <Record r={record.tracked} label="Tracked" />
            <Record r={record.backtest} label="Backtest (past alerts, hypothetical)" />
          </li>
        ))}
      </ul>
      {(update.error || del.error) && <p className="text-sm text-destructive">{(update.error ?? del.error)?.message}</p>}
    </Card>
  );
}

function Leaderboard({ rows }: { rows: Community["leaderboard"]["rows"] }) {
  return (
    <Card title="Leaderboard" subtitle="Ranked by ROI adjusted for the number of bets, so a short lucky run doesn't top the table. All results simulated and verified by GoalBrew.">
      {rows.length === 0 ? (
        <p className="text-sm text-ink-muted">No shared strategies yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[36rem] text-sm">
            <thead>
              <tr className="text-left text-xs text-ink-muted">
                {["Strategy", "Creator", "ROI", "Hit rate", "Bets", "Profit", "Drawdown", "Followers"].map((h) => (
                  <th key={h} className="py-1 font-medium">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map((r) => (
                <tr key={r.id} className={r.ranked ? "" : "text-ink-muted"}>
                  <td className="py-1.5">
                    {r.name}
                    <span className="block text-xs text-ink-muted">{r.verification}{r.ranked ? "" : " · not enough bets to rank"}</span>
                  </td>
                  <td className="py-1.5">{r.creator}</td>
                  <td className="py-1.5 tabular-nums">{pct(r.record.roi, true)}</td>
                  <td className="py-1.5 tabular-nums">{pct(r.record.hitRate)}</td>
                  <td className="py-1.5 tabular-nums">{r.record.bets}</td>
                  <td className="py-1.5 tabular-nums">{gbp(r.record.profit)}</td>
                  <td className="py-1.5 tabular-nums">{gbp(-r.record.maxDrawdown)}</td>
                  <td className="py-1.5 tabular-nums">{r.followers}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
