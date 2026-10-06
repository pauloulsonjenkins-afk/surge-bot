"use client";

/**
 * The Members platform's shared pieces: mode badges (always words, not just colour), tier badge, locked features,
 * upgrade and trial prompts, and small stat formatting. Prompts are shown in place, never as pop-ups.
 */
import Link from "next/link";
import { useEffect } from "react";
import { FlaskConical, Lock, Zap, Crown, Clock } from "lucide-react";
import { trackMemberEvent } from "@/queries/use-members";
import type { BetStatus, MembersMe, Tier, WinLoss } from "@/lib/members/types";

export function pct(n: number | null | undefined, signed = false): string {
  if (n === null || n === undefined) return "–";
  const sign = signed && n > 0 ? "+" : n < 0 ? "−" : "";
  return `${sign}${Math.abs(n).toFixed(1)}%`;
}

export function odds(n: number | null | undefined): string {
  return n === null || n === undefined ? "–" : n.toFixed(2);
}

const timeFmt = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
export const when = (iso: string | null) => (iso ? timeFmt.format(new Date(iso)) : "–");

/** SIMULATION or LIVE, as a labelled badge. */
export function ModeBadge({ mode, large = false }: { mode: "sim" | "live"; large?: boolean }) {
  const sim = mode === "sim";
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border font-semibold uppercase tracking-wide ${large ? "px-3 py-1 text-xs" : "px-2 py-0.5 text-[0.7rem]"} ${
        sim ? "border-accent/40 bg-accent/10 text-ink" : "border-loss/50 bg-loss/10 text-loss"
      }`}
    >
      {sim ? <FlaskConical size={large ? 14 : 12} aria-hidden /> : <Zap size={large ? 14 : 12} aria-hidden />}
      {sim ? "Simulation" : "Live"}
    </span>
  );
}

/** The banner that says, every time, which mode a page is about. */
export function ModeBanner({ mode }: { mode: "sim" | "live" }) {
  return mode === "sim" ? (
    <p className="flex items-center gap-2 rounded-lg border border-accent/30 bg-accent/5 px-3 py-2 text-xs text-ink">
      <ModeBadge mode="sim" /> No real money is placed. Bets are simulated on the house alerts.
    </p>
  ) : (
    <p className="flex items-center gap-2 rounded-lg border border-loss/40 bg-loss/5 px-3 py-2 text-xs text-ink">
      <ModeBadge mode="live" /> Real bets may be placed on the connected Betfair account.
    </p>
  );
}

export const TIER_LABEL: Record<Tier, string> = { free: "Free", trial: "Premium Trial", paid: "Member", expired: "Free", suspended: "Suspended", admin: "Admin" };

export function TierBadge({ tier }: { tier: Tier }) {
  const premium = tier === "paid" || tier === "admin" || tier === "trial";
  return (
    <span className={`inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${premium ? "bg-accent text-accent-ink" : "bg-surface-2 text-ink-muted"}`}>
      {premium && <Crown size={12} aria-hidden />}
      {TIER_LABEL[tier]}
    </span>
  );
}

/** "Premium Trial · 4 days left · Upgrade to keep access", shown from day one, more prominent near the end. */
export function TrialCountdown({ me }: { me: MembersMe }) {
  if (me.tier !== "trial" || me.trial.state !== "active") return null;
  const days = me.trial.daysLeft ?? 0;
  const urgent = (me.trial.hoursLeft ?? 99) <= 48;
  const left = (me.trial.hoursLeft ?? 0) <= 24 ? `${me.trial.hoursLeft} hour${me.trial.hoursLeft === 1 ? "" : "s"} left` : `${days} day${days === 1 ? "" : "s"} left`;
  return (
    <div className={`flex flex-wrap items-center justify-between gap-2 rounded-xl border px-4 py-3 ${urgent ? "border-warn bg-warn/10" : "border-accent/40 bg-accent/5"}`}>
      <p className="flex items-center gap-2 text-sm text-ink">
        <Clock size={16} aria-hidden className={urgent ? "text-warn" : "text-accent"} />
        <span>
          <strong>Premium Trial</strong> · {me.trial.strategies.length} strategies · {left}
        </span>
      </p>
      <Link href="/members/upgrade" onClick={() => trackMemberEvent("upgrade_clicked", { from: "trial_banner" })} className="rounded-md bg-accent px-3 py-1.5 text-xs font-semibold text-accent-ink">
        Upgrade to keep access
      </Link>
    </div>
  );
}

/** After a trial ends: helpful, not pushy. */
export function TrialEnded({ me }: { me: MembersMe }) {
  if (me.tier !== "expired" || me.trial.state !== "used") return null;
  return (
    <div className="rounded-xl border border-line bg-surface p-4">
      <h2 className="text-base font-semibold text-ink">Your Premium Trial has ended</h2>
      <p className="mt-1 text-sm text-ink-muted">
        You&apos;re on the Free membership: results, simulation and your history are all still here. Upgrading brings back detailed strategies,
        qualifying selections, upcoming opportunities, full analytics, every strategy and Betfair features.
      </p>
      <Link href="/members/upgrade" className="mt-3 inline-block text-sm font-medium text-accent underline">
        See membership options
      </Link>
    </div>
  );
}

/**
 * A locked premium feature. Shows what it is (never the content behind it) and the next step: start the trial if the
 * member can, otherwise upgrade.
 */
export function LockedFeature({ title, pitch, me, feature }: { title: string; pitch: string; me: MembersMe | undefined; feature: string }) {
  useEffect(() => {
    trackMemberEvent("upgrade_prompt_shown", { feature });
  }, [feature]);
  const canTrial = me?.trial.state === "available";
  const trialOutsideScope = me?.tier === "trial";
  return (
    <div className="rounded-xl border border-dashed border-line bg-surface p-5 text-center">
      <Lock size={20} aria-hidden className="mx-auto text-ink-muted" />
      <p className="mt-2 text-sm font-semibold text-ink">{title}</p>
      <p className="mx-auto mt-1 max-w-sm text-sm text-ink-muted">{pitch}</p>
      <p className="mt-1 text-xs text-ink-muted">{trialOutsideScope ? "Not one of your trial strategies." : "Members feature"}</p>
      <Link
        href={canTrial ? "/members/trial" : "/members/upgrade"}
        onClick={() => trackMemberEvent("premium_feature_clicked", { feature })}
        className="mt-3 inline-block rounded-md bg-accent px-4 py-2 text-sm font-semibold text-accent-ink"
      >
        {canTrial ? `Start ${me?.trial.days ?? 7}-day trial` : "Upgrade"}
      </Link>
    </div>
  );
}

export function WinLossText({ wl }: { wl: WinLoss }) {
  return (
    <span className="tabular-nums">
      <span className="text-hit">{wl.wins}W</span> <span className="text-ink-muted">/</span> <span className="text-loss">{wl.losses}L</span>
      <span className="text-ink-muted"> · </span>
      <span className="text-ink">{wl.hitRate === null ? "–" : `${wl.hitRate.toFixed(1)}%`}</span>
    </span>
  );
}

export const STATUS_LABEL: Record<BetStatus, string> = {
  pending: "Waiting",
  placing: "Placing",
  matched: "Matched",
  partially_matched: "Part matched",
  rejected: "Not placed",
  failed: "Failed",
  cancelled: "Cancelled",
  won: "Won",
  lost: "Lost",
  void: "Void",
};

export function StatusPill({ status }: { status: BetStatus }) {
  const tone =
    status === "won" ? "bg-hit/15 text-hit" : status === "lost" ? "bg-loss/15 text-loss" : status === "rejected" || status === "failed" ? "bg-warn/15 text-warn" : "bg-surface-2 text-ink-muted";
  return <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${tone}`}>{STATUS_LABEL[status]}</span>;
}

export function Tile({ label, value, sub, tone = "ink" }: { label: string; value: React.ReactNode; sub?: React.ReactNode; tone?: "ink" | "hit" | "loss" | "muted" }) {
  const colour = { ink: "text-ink", hit: "text-hit", loss: "text-loss", muted: "text-ink-muted" }[tone];
  return (
    <div className={`min-w-0 rounded-xl px-3 py-3 ${tone === "hit" ? "kpi-glow kpi-glow-hit" : tone === "loss" ? "kpi-glow kpi-glow-loss" : "border border-line bg-surface"}`}>
      <p className="text-xs text-ink-muted">{label}</p>
      <p className={`mt-1 truncate font-display text-xl font-bold tabular-nums [font-stretch:112%] ${colour}`}>{value}</p>
      {sub && <p className="mt-0.5 truncate text-xs text-ink-muted">{sub}</p>}
    </div>
  );
}

export const btn = "rounded-md border border-line px-3 py-1.5 text-xs font-medium text-ink hover:bg-surface-2 disabled:opacity-50";
export const btnPrimary = "rounded-md bg-accent px-3 py-1.5 text-xs font-semibold text-accent-ink disabled:opacity-50";
export const input = "w-full rounded-md border border-line bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-accent";

/** Responsible-gambling line for anything to do with real money. */
export function SaferGambling() {
  return (
    <p className="text-xs text-ink-muted">
      18+ only. Bet only what you can afford to lose; past results don&apos;t guarantee future ones. Help and support:{" "}
      <a href="https://www.begambleaware.org" target="_blank" rel="noreferrer" className="underline">
        BeGambleAware.org
      </a>
      .
    </p>
  );
}
