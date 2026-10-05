"use client";

import Link from "next/link";
import { Check, Minus } from "lucide-react";
import { PageHeader, Card } from "@/components/ui/Card";
import { Skeleton } from "@/components/ui/Skeleton";
import { useMembersAction, useMembersMe, useMembersPlans } from "@/queries/use-members";
import { btnPrimary, SaferGambling, when } from "@/components/members/ui";

/** Membership: the comparison (from the configured rules, not hard-coded), and the way to subscribe or trial. */
export default function UpgradePage() {
  const me = useMembersMe();
  const plans = useMembersPlans();
  const checkout = useMembersAction<Record<string, never>, { url: string }>("billing/checkout");
  if (!me.data || !plans.data) return <Skeleton className="h-96 w-full" />;
  const m = me.data;
  const p = plans.data;
  const scopeText = (scope: string) => (scope === "all" ? "Every strategy" : scope === "selected" ? `${p.trialStrategyLimit} chosen strategies` : "–");
  const label: Record<string, string> = { free: "Free", trial: `${p.trialDays}-day trial`, paid: "Member" };

  return (
    <div className="space-y-5">
      <PageHeader title="Membership" subtitle="Free shows the results. Members get the information behind them, and the tools to use it." />
      {(m.tier === "paid" || m.tier === "admin") && (
        <Card>
          <p className="text-sm text-ink">You have full access{m.paid.until ? ` until ${when(m.paid.until)}` : ""}. Thank you.</p>
        </Card>
      )}
      {m.tier !== "paid" && m.tier !== "admin" && (
        <Card title={p.priceLabel ? `Full membership · ${p.priceLabel}` : "Full membership"}>
          <p className="text-sm text-ink-muted">Every strategy in full, all selections and opportunities, full history and analytics, your own strategies, and Betfair features where available. Cancel any time.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {m.billing.available ? (
              <button type="button" className={`${btnPrimary} px-5 py-2 text-sm`} disabled={checkout.isPending} onClick={() => checkout.mutate({}, { onSuccess: (r) => (window.location.href = r.url) })}>
                {checkout.isPending ? "Opening…" : "Subscribe"}
              </button>
            ) : (
              <p className="text-sm text-ink-muted">Subscriptions open soon.</p>
            )}
            {m.trial.state === "available" && (
              <Link href="/members/trial" className="rounded-md border border-line px-5 py-2 text-sm font-medium text-ink">
                Or try it free for {p.trialDays} days
              </Link>
            )}
          </div>
          {checkout.error && <p className="mt-2 text-sm text-destructive">{checkout.error.message}</p>}
        </Card>
      )}

      <Card title="Compare">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[30rem] text-sm">
            <thead>
              <tr className="text-left text-xs text-ink-muted">
                <th className="py-1 font-medium">Feature</th>
                {p.tiers.map((t) => (
                  <th key={t.tier} className="py-1 text-center font-medium">
                    {label[t.tier]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {p.capabilities.map((c) => (
                <tr key={c.key}>
                  <td className="py-1.5 text-ink">{c.label}</td>
                  {p.tiers.map((t) => (
                    <td key={t.tier} className="py-1.5 text-center">
                      {t.caps[c.key] ? <Check size={16} className="inline text-hit" aria-label="Yes" /> : <Minus size={16} className="inline text-ink-muted" aria-label="No" />}
                    </td>
                  ))}
                </tr>
              ))}
              <tr>
                <td className="py-1.5 text-ink">Strategies in full</td>
                {p.tiers.map((t) => (
                  <td key={t.tier} className="py-1.5 text-center text-xs text-ink-muted">
                    {scopeText(t.strategyScope)}
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-xs text-ink-muted">Live betting also needs a Betfair connection, your own explicit switch-on, and a strategy approved for live.</p>
      </Card>
      <SaferGambling />
    </div>
  );
}
