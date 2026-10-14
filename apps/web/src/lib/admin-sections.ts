/**
 * The admin pages, grouped by how often they're used, in the order they appear in the desktop sidebar, the phone
 * admin row and the More page:
 * - Every day: today at a glance, each strategy, and the betting itself (bets placed, limits, the Betfair check).
 * - Money: profit and loss.
 * - Research: leagues (ours and their past seasons), pre-match value, the goal model. Opened now and then.
 * - Site: members, settings, and fixing a result.
 * - Horses: the separate racing log, one page with tabs.
 * On phones only "Every day" sits in the admin row; the rest are a tap away on More (see AdminNav).
 * Settled picks live on the Trade Log; "Fix a result" is the admin's editing view of it (raw alerts on a second tab).
 * Old addresses (reconcile, history, horse-log, horse-stats, direct, picks, telegram) redirect to their new places.
 */
export const ADMIN_GROUPS = [
  {
    label: "Every day",
    daily: true,
    items: [
      { href: "/more/admin/today", label: "Today", description: "One glance: betting on or off, today's result, money out, limits, alert health, speed and why picks weren't placed." },
      { href: "/more/admin/strategies", label: "Strategies", description: "Each strategy's results, Live / Sim, stake, minimum odds and stop loss." },
      { href: "/more/admin/sending", label: "Betting", description: "Bets placed on Betfair, the on / off switch and safety limits, and the check against Betfair's real results." },
    ],
  },
  {
    label: "Money",
    daily: false,
    items: [{ href: "/more/admin/winloss", label: "Profit", description: "Profit and loss by day and strategy, and running costs." }],
  },
  {
    label: "Research",
    daily: false,
    items: [
      { href: "/more/admin/leagues", label: "Leagues", description: "Hide leagues, reset stats, set country and tier, and how each league played over past seasons." },
      { href: "/more/admin/edge", label: "Fixtures and value bets", short: "Fixtures", description: "Pre-match insight and value bets for every fixture in the next 48 hours." },
      { href: "/more/admin/goal-model", label: "Goal model", short: "Model", description: "Our own model of the in-play stats, in shadow: does it beat the market price? You get a notification once it's proved." },
    ],
  },
  {
    label: "Site",
    daily: false,
    items: [
      { href: "/more/admin/members", label: "Members", description: "Accounts, sign-ups, trials and full access, and the members' rules." },
      { href: "/more/admin/settings", label: "Settings", description: "Public view, Telegram and webhook alerts, download every pick, fresh start." },
      { href: "/more/admin/results", label: "Fix a result", short: "Fixes", description: "Correct a hit or miss, or remove a pick." },
    ],
  },
  {
    label: "Horses",
    daily: false,
    items: [{ href: "/more/admin/horses", label: "Horses", description: "Today's NAP and choices, every day's log, and how it's going." }],
  },
] as const;

export type AdminSection = (typeof ADMIN_GROUPS)[number]["items"][number];

export const ADMIN_SECTIONS: AdminSection[] = ADMIN_GROUPS.flatMap((g): readonly AdminSection[] => g.items);
