"use client";

import { useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient, type UseMutationResult } from "@tanstack/react-query";
import { OctagonX } from "lucide-react";
import { Card, PageHeader } from "@/components/ui/Card";
import { Skeleton } from "@/components/ui/Skeleton";
import { QueryError } from "@/components/ui/QueryError";
import { useDialog } from "@/components/ui/ConfirmDialog";
import { getJson } from "@/queries/fetch-json";
import { useMe } from "@/queries/use-me";
import { btn, btnPrimary, input, when } from "@/components/members/ui";

interface Overview {
  members: Array<{
    userId: number;
    email: string;
    name: string;
    username: string | null;
    active: boolean;
    visited: boolean;
    lastLoginAt: string | null;
    tier: string;
    tierOverride: string | null;
    trialStartedAt: string | null;
    trialEndsAt: string | null;
    trialStrategies: string[];
    paidUntil: string | null;
    paidSource: string | null;
    subscriptionStatus: string | null;
    liveEnabled: boolean;
    automationPaused: boolean;
    connection: string;
    createdAt: string;
  }>;
  funnel: Array<{ event: string; count: number; members: number }>;
  bets: { sim: number; live: number; failedLive: Array<{ id: number; userId: number; reason: string | null; createdAt: string }> };
  audit: Array<{ id: number; at: string; userId: number | null; actor: string; action: string; object: string | null; result: string; detail: string | null }>;
  stripe: { configured: boolean };
}

interface ConfigResp {
  config: {
    flags: Record<string, boolean>;
    trialDays: number;
    trialStrategyLimit: number;
    freeHistoryDays: number;
    defaultSimBank: number;
    simSlippagePct: number;
    commissionPct: number;
    publishedStrategies: string[];
    liveApprovedStrategies: string[];
    paidPriceLabel: string;
  };
  strategies: Array<{ key: string; name: string }>;
}

const FLAG_LABEL: Record<string, string> = {
  trial: "7-day trial offered",
  community: "Community leaderboard (off = Coming soon)",
  strategyCreation: "Members can create strategies",
  strategySharing: "Members can share strategies",
  betfairConnections: "Betfair connections",
  liveBetting: "LIVE member betting (master switch)",
  advancedAnalytics: "Advanced analytics",
};

/** Account actions (sign-ups switch, password, disable, delete) go to the site's accounts API. */
async function account(body: Record<string, unknown>) {
  const res = await fetch("/api/admin/users", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new Error(data.error ?? "That didn't work.");
  return data;
}

async function post(path: string, body: unknown) {
  const res = await fetch(`/api/admin/members/${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new Error(data.error ?? "That didn't work.");
  return data;
}


/** The admin's view of the Members platform: accounts, commercial rules, live betting and its STOP switch, activity. */
export default function AdminMembersPage() {
  const qc = useQueryClient();
  const me = useMe();
  const overview = useQuery({ queryKey: ["admin-members"], queryFn: ({ signal }) => getJson<Overview>("/api/admin/members/overview", "members", signal), refetchInterval: 30_000 });
  const config = useQuery({ queryKey: ["admin-members-config"], queryFn: ({ signal }) => getJson<ConfigResp>("/api/admin/members/config", "members settings", signal) });
  const act = useMutation({ mutationFn: (b: Record<string, unknown>) => post("member", b), onSuccess: () => void qc.invalidateQueries({ queryKey: ["admin-members"] }) });
  const acct = useMutation({ mutationFn: account, onSuccess: () => void qc.invalidateQueries({ queryKey: ["admin-members"] }) });
  const signups = useQuery({ queryKey: ["admin-signups"], queryFn: ({ signal }) => getJson<{ signupsOpen: boolean }>("/api/admin/users", "sign-ups", signal) });
  const setSignups = useMutation({ mutationFn: (open: boolean) => account({ action: "signups", open }), onSuccess: () => void qc.invalidateQueries({ queryKey: ["admin-signups"] }) });
  const stopAll = useMutation({ mutationFn: () => post("stop-all-live", {}), onSuccess: () => void qc.invalidateQueries() });
  const { confirm } = useDialog();
  const [search, setSearch] = useState("");

  const members = overview.data?.members ?? [];
  const q = search.trim().toLowerCase();
  const shown = q ? members.filter((m) => m.email.toLowerCase().includes(q) || m.name.toLowerCase().includes(q) || m.tier.includes(q)) : members;
  const liveOn = config.data?.config.flags.liveBetting === true || members.some((m) => m.liveEnabled);

  return (
    <div className="space-y-6">
      <PageHeader
        as="h2"
        title="Members"
        subtitle="The Members platform (beta): accounts, memberships, the members' rules and live betting."
        actions={
          <Link href="/members" className="rounded-md border border-line px-3 py-1.5 text-xs font-medium text-ink hover:bg-surface-2">
            Open the members area
          </Link>
        }
      />

      {me.data?.publicView && (
        <p className="rounded-lg border border-warn bg-warn/10 px-3 py-2 text-sm text-ink">
          Public view is ON (Settings). While it is on, anyone can open Live, Trade Log and the Dashboard with every alert in full, which gives away what Members pay for. Switch it off.
        </p>
      )}

      {/* While any live betting could happen, the stop button sits at the top where it can't be missed. */}
      {liveOn && <StopAllButton stopAll={stopAll} confirm={confirm} />}

      {overview.error ? (
        <QueryError error={overview.error} next="/more/admin/members" />
      ) : overview.isLoading || !overview.data ? (
        <Skeleton className="h-64 w-full" />
      ) : (
        <Card
          title={`Accounts (${members.length})`}
          subtitle={`Everyone with a sign-in. Last 30 days: ${overview.data.bets.sim} simulated bets, ${overview.data.bets.live} live. Stripe ${overview.data.stripe.configured ? "set up" : "not set up yet"}.`}
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <label className="flex items-center gap-2 text-sm text-ink">
              <input type="checkbox" checked={signups.data?.signupsOpen === true} disabled={!signups.data || setSignups.isPending} onChange={(e) => setSignups.mutate(e.target.checked)} />
              New sign-ups open
            </label>
            {members.length > 8 && <input className={`${input} sm:w-64`} placeholder="Search email, name or membership" value={search} onChange={(e) => setSearch(e.target.value)} />}
          </div>
          {(setSignups.error || signups.error) && <p className="mt-2 text-sm text-destructive">{(setSignups.error ?? signups.error)?.message}</p>}
          <ul className="mt-2 divide-y divide-line">
            {shown.map((m) => (
              <MemberRow key={m.userId} m={m} onAction={(b) => act.mutate({ userId: m.userId, ...b })} onAccount={(b) => acct.mutate({ id: m.userId, ...b })} confirm={confirm} />
            ))}
            {shown.length === 0 && <li className="py-2 text-sm text-ink-muted">{q ? "No account matches." : "No accounts yet."}</li>}
          </ul>
          {(act.error || acct.error) && <p className="mt-2 text-sm text-destructive">{(act.error ?? acct.error)?.message}</p>}
        </Card>
      )}

      {config.error ? (
        <QueryError error={config.error} next="/more/admin/members" />
      ) : (
        config.data && <ConfigCard key={JSON.stringify(config.data.config)} data={config.data} onSaved={() => void qc.invalidateQueries({ queryKey: ["admin-members-config"] })} />
      )}

      <Card title="Live betting" subtitle="Real-money member bets. Off unless the switch in the rules above and the engine setting MEMBERS_LIVE_BETTING = allow are both on; today only admin members on the GoalBrew Betfair account.">
        {!liveOn && <StopAllButton stopAll={stopAll} confirm={confirm} />}
        {liveOn && <p className="text-sm text-ink">The stop button is at the top of this page.</p>}
        {overview.data && overview.data.bets.failedLive.length > 0 ? (
          <>
            <p className="mt-3 text-sm font-medium text-ink">Not placed (30 days)</p>
            <ul className="mt-1 space-y-1 text-xs">
              {overview.data.bets.failedLive.map((b) => (
                <li key={b.id} className="text-ink-muted">
                  {when(b.createdAt)} · {members.find((m) => m.userId === b.userId)?.email ?? `member ${b.userId}`}: {b.reason}
                </li>
              ))}
            </ul>
          </>
        ) : (
          <p className="mt-3 text-xs text-ink-muted">No live bets refused or failed in the last 30 days.</p>
        )}
      </Card>

      {overview.data && (
        <>
          <Card title="Funnel (30 days)" subtitle="Product events: how many times, and how many members.">
            {overview.data.funnel.length === 0 ? (
              <p className="text-sm text-ink-muted">No events yet.</p>
            ) : (
              <ul className="grid gap-1 text-sm sm:grid-cols-2">
                {overview.data.funnel.map((f) => (
                  <li key={f.event} className="flex justify-between">
                    <span className="text-ink">{f.event.replace(/_/g, " ")}</span>
                    <span className="tabular-nums text-ink-muted">
                      {f.count} · {f.members} members
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card title="Audit log" subtitle="The latest 100 important actions.">
            {overview.data.audit.length === 0 ? (
              <p className="text-sm text-ink-muted">Nothing yet.</p>
            ) : (
              <ul className="max-h-96 space-y-1 overflow-y-auto text-xs">
                {overview.data.audit.map((a) => (
                  <li key={a.id} className={a.result === "ok" ? "text-ink-muted" : "text-warn"}>
                    {when(a.at)} · {a.actor}
                    {a.userId !== null ? ` (${members.find((m) => m.userId === a.userId)?.email ?? `member ${a.userId}`})` : ""} · {a.action.replace(/_/g, " ")}
                    {a.object ? ` · ${a.object}` : ""} · {a.result}
                    {a.detail ? ` · ${a.detail}` : ""}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </>
      )}
    </div>
  );
}

function StopAllButton({ stopAll, confirm }: { stopAll: UseMutationResult<{ error?: string }, Error, void>; confirm: ReturnType<typeof useDialog>["confirm"] }) {
  return (
    <div>
      <button
        type="button"
        disabled={stopAll.isPending}
        onClick={async () => {
          if (await confirm({ title: "Stop ALL members' live betting?", body: "Live betting switches off for every member, waiting live bets are cancelled and all live follows go back to simulation.", confirmLabel: "Stop all live betting", tone: "danger" }))
            stopAll.mutate();
        }}
        className="flex w-full items-center justify-center gap-2 rounded-xl bg-loss px-4 py-3 text-sm font-bold text-white disabled:opacity-60"
      >
        <OctagonX size={18} /> STOP ALL MEMBERS&apos; LIVE BETTING
      </button>
      {stopAll.isSuccess && <p className="mt-2 text-sm text-ink">Stopped. {String((stopAll.data as { cancelled?: number }).cancelled ?? 0)} waiting bet(s) cancelled.</p>}
      {stopAll.error && <p className="mt-2 text-sm text-destructive">{stopAll.error.message}</p>}
    </div>
  );
}

function MemberRow({
  m,
  onAction,
  onAccount,
  confirm,
}: {
  m: Overview["members"][number];
  onAction: (b: Record<string, unknown>) => void;
  onAccount: (b: Record<string, unknown>) => void;
  confirm: ReturnType<typeof useDialog>["confirm"];
}) {
  const [open, setOpen] = useState(false);
  const [until, setUntil] = useState("");
  const [password, setPassword] = useState("");
  return (
    <li className="py-2">
      <button type="button" onClick={() => setOpen((o) => !o)} className="flex w-full items-start justify-between gap-2 text-left">
        <span className="min-w-0">
          <span className="block truncate text-sm text-ink">
            {m.email}
            {m.name ? ` · ${m.name}` : ""}
            {m.username ? ` · @${m.username}` : ""}
            {!m.active && <span className="text-destructive"> · disabled</span>}
          </span>
          <span className="block text-xs text-ink-muted">
            {m.visited ? m.tier : "free · hasn't opened Members"}
            {m.lastLoginAt ? ` · last sign-in ${when(m.lastLoginAt)}` : ""}
            {m.trialEndsAt ? ` · trial ${m.trialStartedAt ? when(m.trialStartedAt) : ""} → ${when(m.trialEndsAt)} (${m.trialStrategies.join(", ")})` : ""}
            {m.paidUntil ? ` · paid until ${when(m.paidUntil)} (${m.paidSource ?? ""}${m.subscriptionStatus ? `, ${m.subscriptionStatus}` : ""})` : ""}
            {m.liveEnabled ? " · LIVE on" : ""}
            {m.connection !== "none" ? ` · Betfair: ${m.connection}` : ""}
          </span>
        </span>
        <span className="text-xs text-ink-muted">{open ? "Close" : "Manage"}</span>
      </button>
      {open && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <button
            type="button"
            className={btn}
            onClick={async () => {
              if (m.tierOverride === "admin") return onAction({ action: "set_override", value: null });
              if (await confirm({ title: `Make ${m.email} an admin member?`, body: "Admin members get everything on /members, including live betting on the GoalBrew Betfair account when it is switched on.", confirmLabel: "Make admin" }))
                onAction({ action: "set_override", value: "admin" });
            }}
          >
            {m.tierOverride === "admin" ? "Remove admin" : "Make admin"}
          </button>
          <button type="button" className={btn} onClick={() => onAction({ action: "set_override", value: m.tierOverride === "suspended" ? null : "suspended" })}>
            {m.tierOverride === "suspended" ? "Unsuspend" : "Suspend"}
          </button>
          <button
            type="button"
            className={btn}
            onClick={async () => {
              if (await confirm({ title: `Reset ${m.email}'s trial?`, body: "Their trial and its 3 strategies are cleared, and they can start one more trial.", confirmLabel: "Reset trial" })) onAction({ action: "reset_trial" });
            }}
          >
            Reset trial
          </button>
          {m.trialEndsAt && (
            <button type="button" className={btn} onClick={() => onAction({ action: "extend_trial", days: 3 })}>
              Extend trial 3 days
            </button>
          )}
          <input type="date" aria-label="Paid until" className={`${input} w-40`} value={until} onChange={(e) => setUntil(e.target.value)} />
          <button type="button" className={btn} disabled={!until} onClick={() => onAction({ action: "grant_paid", until: `${until}T23:59:59Z` })}>
            Paid until date
          </button>
          {m.paidSource === "admin" && (
            <button type="button" className={btn} onClick={() => onAction({ action: "grant_paid", until: null })}>
              Remove paid
            </button>
          )}
          {m.liveEnabled && (
            <button type="button" className={btn} onClick={() => onAction({ action: "stop_live" })}>
              Stop their live betting
            </button>
          )}
          <span className="basis-full" />
          <input type="text" aria-label="New password" placeholder="New password (10+ characters)" className={`${input} w-56`} value={password} onChange={(e) => setPassword(e.target.value)} />
          <button
            type="button"
            className={btn}
            disabled={password.length < 10}
            onClick={() => {
              onAccount({ action: "update", password });
              setPassword("");
            }}
          >
            Set password
          </button>
          <button type="button" className={btn} onClick={() => onAccount({ action: "update", signOutEverywhere: true })}>
            Sign out everywhere
          </button>
          <button type="button" className={btn} onClick={() => onAccount({ action: "update", active: !m.active })}>
            {m.active ? "Disable account" : "Enable account"}
          </button>
          <button
            type="button"
            className={btn}
            onClick={async () => {
              if (await confirm({ title: `Delete ${m.email}?`, body: "The account is deleted and can't sign in. This can't be undone.", confirmLabel: "Delete account", tone: "danger" })) onAccount({ action: "delete" });
            }}
          >
            Delete account
          </button>
        </div>
      )}
    </li>
  );
}

const NUM_KEYS = ["trialDays", "trialStrategyLimit", "freeHistoryDays", "defaultSimBank", "commissionPct", "simSlippagePct"] as const;
type NumKey = (typeof NUM_KEYS)[number];

function ConfigCard({ data, onSaved }: { data: ConfigResp; onSaved: () => void }) {
  const [c, setC] = useState(data.config);
  const [nums, setNums] = useState<Record<NumKey, string>>(() => Object.fromEntries(NUM_KEYS.map((k) => [k, String(data.config[k])])) as Record<NumKey, string>);
  const bad = NUM_KEYS.filter((k) => nums[k].trim() === "" || !Number.isFinite(Number(nums[k])));
  const save = useMutation({ mutationFn: () => post("config", { ...c, ...Object.fromEntries(NUM_KEYS.map((k) => [k, Number(nums[k])])) }), onSuccess: onSaved });
  const num = (k: NumKey) => (
    <input className={`${input} mt-1 ${bad.includes(k) ? "border-destructive" : ""}`} inputMode="decimal" value={nums[k]} onChange={(e) => setNums((x) => ({ ...x, [k]: e.target.value }))} />
  );
  const toggleList = (k: "publishedStrategies" | "liveApprovedStrategies", key: string) =>
    setC((x) => ({ ...x, [k]: x[k].includes(key) ? x[k].filter((s) => s !== key) : [...x[k], key] }));
  return (
    <Card title="Members' rules" subtitle="What each membership gets, the trial, the simulation and the price wording. Changes apply straight away.">
      <div className="space-y-4">
        <div className="grid gap-2 sm:grid-cols-2">
          {Object.keys(FLAG_LABEL).map((f) => (
            <label key={f} className={`flex items-center gap-2 text-sm ${f === "liveBetting" ? "font-semibold text-loss" : "text-ink"}`}>
              <input type="checkbox" checked={c.flags[f] === true} onChange={(e) => setC((x) => ({ ...x, flags: { ...x.flags, [f]: e.target.checked } }))} />
              {FLAG_LABEL[f]}
            </label>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <label className="text-xs text-ink-muted">Trial days{num("trialDays")}</label>
          <label className="text-xs text-ink-muted">Trial strategies{num("trialStrategyLimit")}</label>
          <label className="text-xs text-ink-muted">Free history (days){num("freeHistoryDays")}</label>
          <label className="text-xs text-ink-muted">Default simulation bank (£){num("defaultSimBank")}</label>
          <label className="text-xs text-ink-muted">Commission (%){num("commissionPct")}</label>
          <label className="text-xs text-ink-muted">Simulation slippage (%){num("simSlippagePct")}</label>
          <label className="col-span-2 text-xs text-ink-muted sm:col-span-3">
            Price shown on the upgrade page (e.g. &quot;£19 a month&quot;)
            <input className={`${input} mt-1`} value={c.paidPriceLabel} onChange={(e) => setC((x) => ({ ...x, paidPriceLabel: e.target.value }))} />
          </label>
        </div>
        <div>
          <p className="text-sm font-medium text-ink">Strategies offered to members</p>
          <p className="text-xs text-ink-muted">None ticked = all of them.</p>
          <div className="mt-1 flex flex-wrap gap-2">
            {data.strategies.map((s) => (
              <label key={s.key} className="flex items-center gap-1 text-xs text-ink">
                <input type="checkbox" checked={c.publishedStrategies.includes(s.key)} onChange={() => toggleList("publishedStrategies", s.key)} />
                {s.name}
              </label>
            ))}
          </div>
        </div>
        <div>
          <p className="text-sm font-medium text-ink">Approved for live betting</p>
          <div className="mt-1 flex flex-wrap gap-2">
            {data.strategies.map((s) => (
              <label key={s.key} className="flex items-center gap-1 text-xs text-ink">
                <input type="checkbox" checked={c.liveApprovedStrategies.includes(s.key)} onChange={() => toggleList("liveApprovedStrategies", s.key)} />
                {s.name}
              </label>
            ))}
          </div>
        </div>
        <button type="button" className={btnPrimary} disabled={save.isPending || bad.length > 0} onClick={() => save.mutate()}>
          Save rules
        </button>
        {save.error && <p className="text-sm text-destructive">{save.error.message}</p>}
        {save.isSuccess && <p className="text-xs text-hit">Saved.</p>}
      </div>
    </Card>
  );
}
