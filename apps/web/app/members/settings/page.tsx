"use client";

import { useState } from "react";
import { PageHeader, Card } from "@/components/ui/Card";
import { Skeleton } from "@/components/ui/Skeleton";
import { gbp } from "@/lib/format";
import { useDialog } from "@/components/ui/ConfirmDialog";
import { useMembersAction, useMembersMe, useMembersSettings } from "@/queries/use-members";
import type { MemberSettings, RiskLimits } from "@/lib/members/types";
import { btn, btnPrimary, input, when } from "@/components/members/ui";

const RISK_FIELDS: Array<{ key: keyof RiskLimits; label: string; unit: string; basic?: boolean }> = [
  { key: "maxStake", label: "Maximum stake", unit: "£", basic: true },
  { key: "minOdds", label: "Minimum odds", unit: "", basic: true },
  { key: "maxDailyLoss", label: "Maximum loss per day", unit: "£", basic: true },
  { key: "minStake", label: "Minimum stake", unit: "£" },
  { key: "maxDailyStake", label: "Maximum staked per day", unit: "£" },
  { key: "maxBetsPerDay", label: "Maximum bets per day", unit: "" },
  { key: "maxExposure", label: "Maximum open exposure", unit: "£" },
  { key: "maxOdds", label: "Maximum odds", unit: "" },
  { key: "stopLossPct", label: "Stop loss (bank down by)", unit: "%" },
  { key: "minBank", label: "Minimum bank", unit: "£" },
  { key: "priceTolerancePct", label: "Live price tolerance", unit: "%" },
];

export default function SettingsPage() {
  const me = useMembersMe();
  const { data, isLoading } = useMembersSettings();
  if (isLoading || !data || !me.data) return <Skeleton className="h-96 w-full" />;
  return (
    <div className="space-y-5">
      <PageHeader title="Settings" subtitle="Staking, limits, your simulation bank and your membership." />
      {/* Remounts with fresh values whenever the saved settings change. */}
      <StakingCard key={`s-${data.stakingMethod}-${data.stakeValue}`} s={data} />
      <RiskCard key={`r-${JSON.stringify(data.risk)}`} s={data} />
      <SimCard s={data} />
      <Card title="Membership">
        <p className="text-sm text-ink">
          {me.data.tier === "paid" ? `Member${me.data.paid.until ? ` until ${when(me.data.paid.until)} (renews automatically while subscribed)` : ""}` : me.data.tier === "trial" ? `Premium Trial, ends ${when(me.data.trial.endsAt)}` : me.data.tier === "admin" ? "Administrator" : "Free"}
        </p>
        {me.data.paid.canManage && <BillingButton />}
      </Card>
    </div>
  );
}

function BillingButton() {
  const portal = useMembersAction<Record<string, never>, { url: string }>("billing/portal");
  return (
    <>
      <button type="button" className={`${btn} mt-3`} onClick={() => portal.mutate({}, { onSuccess: (r) => (window.location.href = r.url) })}>
        Manage payment or cancel
      </button>
      {portal.error && <p className="mt-2 text-sm text-destructive">{portal.error.message}</p>}
    </>
  );
}

function StakingCard({ s }: { s: MemberSettings }) {
  const save = useMembersAction("settings");
  const [method, setMethod] = useState(s.stakingMethod);
  const [value, setValue] = useState(String(s.stakeValue));
  const pctMethod = method === "percent_bank" || method === "fixed_percent";
  return (
    <Card title="Staking" subtitle="How much each bet is. Recorded on every bet.">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-xs text-ink-muted">
          Method
          <select className={`${input} mt-1`} value={method} onChange={(e) => setMethod(e.target.value)} disabled={!s.advancedStaking}>
            {s.stakingMethods.map((m) => (
              <option key={m.value} value={m.value} disabled={!s.advancedStaking && m.value !== "flat"}>
                {m.label}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs text-ink-muted">
          {pctMethod ? "Percentage" : method === "strategy" ? "Fallback stake (£)" : "Stake (£)"}
          <input className={`${input} mt-1`} inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} />
        </label>
      </div>
      {!s.advancedStaking && <p className="mt-2 text-xs text-ink-muted">Percentage, custom and strategy-defined staking come with the trial and full membership.</p>}
      <button type="button" className={`${btnPrimary} mt-3`} disabled={save.isPending} onClick={() => save.mutate({ stakingMethod: method, stakeValue: Number(value) })}>
        Save staking
      </button>
      {save.error && <p className="mt-2 text-sm text-destructive">{save.error.message}</p>}
      {save.isSuccess && <p className="mt-2 text-xs text-hit">Saved.</p>}
    </Card>
  );
}

function RiskCard({ s }: { s: MemberSettings }) {
  const save = useMembersAction("settings");
  const [vals, setVals] = useState<Record<string, string>>(() => Object.fromEntries(RISK_FIELDS.map((f) => [f.key, s.risk[f.key] === null ? "" : String(s.risk[f.key])])));
  return (
    <Card title="Risk controls" subtitle="Checked before every bet, simulated or live. A bet that breaks one isn't placed, and the reason is recorded. Leave empty for no limit.">
      <div className="grid gap-3 sm:grid-cols-2">
        {RISK_FIELDS.map((f) => {
          const editable = s.advancedRisk || f.basic;
          return (
            <label key={f.key} className="text-xs text-ink-muted">
              {f.label}
              {f.unit ? ` (${f.unit})` : ""}
              <input
                className={`${input} mt-1`}
                inputMode="decimal"
                value={vals[f.key] ?? ""}
                disabled={!editable}
                onChange={(e) => setVals((v) => ({ ...v, [f.key]: e.target.value }))}
              />
            </label>
          );
        })}
      </div>
      {!s.advancedRisk && <p className="mt-2 text-xs text-ink-muted">The other limits come with the trial and full membership.</p>}
      <button
        type="button"
        className={`${btnPrimary} mt-3`}
        disabled={save.isPending}
        onClick={() => save.mutate({ risk: Object.fromEntries(Object.entries(vals).map(([k, v]) => [k, v.trim() === "" ? null : Number(v)])) })}
      >
        Save limits
      </button>
      {save.error && <p className="mt-2 text-sm text-destructive">{save.error.message}</p>}
      {save.isSuccess && <p className="mt-2 text-xs text-hit">Saved.</p>}
    </Card>
  );
}

const BANKS = [100, 500, 1000, 5000, 10000];

function SimCard({ s }: { s: MemberSettings }) {
  const reset = useMembersAction<{ bank: number }>("settings/reset-sim");
  const { confirm } = useDialog();
  const [custom, setCustom] = useState("");
  const start = async (bank: number) => {
    if (await confirm({ title: `Start a new simulation with ${gbp(bank, false)}?`, body: "Your current simulation's bets stay in your history, but the bank starts again.", confirmLabel: "Start new simulation" })) reset.mutate({ bank });
  };
  return (
    <Card title="Simulation bank" subtitle={`Started with ${gbp(s.simBank, false)} on ${when(s.simStartedAt)}.`}>
      <div className="flex flex-wrap gap-2">
        {BANKS.map((b) => (
          <button key={b} type="button" className={btn} onClick={() => void start(b)}>
            {gbp(b, false).replace(".00", "")}
          </button>
        ))}
        <input className={`${input} w-28`} inputMode="decimal" placeholder="Custom £" value={custom} onChange={(e) => setCustom(e.target.value)} />
        <button type="button" className={btn} disabled={!Number(custom)} onClick={() => void start(Number(custom))}>
          Start
        </button>
      </div>
      {reset.error && <p className="mt-2 text-sm text-destructive">{reset.error.message}</p>}
    </Card>
  );
}
