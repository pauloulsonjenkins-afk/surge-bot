/**
 * The admin pages, grouped by job, in the order they appear in the desktop sidebar, the phone admin menu and
 * the More page:
 * - Betting: each strategy (results and its bet settings), how bets reach Betfair, and what really happened there.
 * - Results: how the alerts are doing, and the data behind those figures.
 * - Members and site: who can use the site and what they get.
 * - Horses: the separate horse racing log.
 * Settled picks themselves live on the Trade Log; "Amend results" is the admin's editing view of it (with the raw
 * alerts as a second tab).
 */
export const ADMIN_GROUPS = [
  {
    label: "Betting",
    items: [
      { href: "/more/admin/today", label: "Today", description: "One glance: betting on or off, today's result, money out, limits, alert health, speed and why picks weren't placed." },
      { href: "/more/admin/strategies", label: "Strategies", description: "Each strategy's results, Live / Sim, stake, minimum odds and stop loss." },
      { href: "/more/admin/sending", label: "Sending", description: "Betting on or off, placing bets on Betfair, safety limits and bet wording." },
      { href: "/more/admin/reconcile", label: "Reconcile", description: "Real Betfair results against the app's estimates." },
    ],
  },
  {
    label: "Results",
    items: [
      { href: "/more/admin/winloss", label: "Win/Loss", description: "Profit and loss by day and strategy, and running costs." },
      { href: "/more/admin/leagues", label: "Leagues", description: "Hide leagues, reset stats, set country and tier." },
      { href: "/more/admin/goal-model", label: "Goal model", description: "Our own model of the in-play stats, in shadow: does it beat the market price? You get a notification once it's proved." },
      { href: "/more/admin/history", label: "League history", description: "How each league plays, and strategies tested on past seasons." },
      { href: "/more/admin/results", label: "Amend results", description: "Correct a hit or miss, or remove a pick." },
    ],
  },
  {
    label: "Members and site",
    items: [
      { href: "/more/admin/members", label: "Members", description: "Accounts, sign-ups, memberships, trials and the members' rules." },
      { href: "/more/admin/settings", label: "Settings", description: "Public view, Telegram and webhook alerts, download every pick, fresh start." },
    ],
  },
  {
    label: "Horses",
    items: [
      { href: "/more/admin/horses", label: "Today's bets", description: "Enter your daily NAP and choices, and mark the results." },
      { href: "/more/admin/horse-log", label: "Horse log", description: "Every day’s tipped horses, and what you did with each one." },
      { href: "/more/admin/horse-stats", label: "How it's going", description: "Profit over time, which choice is paying, courses and patterns." },
    ],
  },
] as const;

export type AdminSection = (typeof ADMIN_GROUPS)[number]["items"][number];

export const ADMIN_SECTIONS: AdminSection[] = ADMIN_GROUPS.flatMap((g): readonly AdminSection[] => g.items);
