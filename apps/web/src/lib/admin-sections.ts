/**
 * The admin pages, grouped by job, in the order they appear in the desktop sidebar, the phone admin menu and
 * the More page:
 * - Betting: how picks reach Betfair, and checking what really happened there.
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
      { href: "/more/admin/sending", label: "Sending", description: "Which strategies are Live or Sim, stakes, minimum odds and stop losses." },
      { href: "/more/admin/direct", label: "Direct betting", description: "Place bets on Betfair from GoalBrew itself (off until you switch it on)." },
      { href: "/more/admin/reconcile", label: "Reconcile", description: "Real Betfair results against the app's estimates." },
    ],
  },
  {
    label: "Results",
    items: [
      { href: "/more/admin/winloss", label: "Win/Loss", description: "Profit and loss by day and strategy, and running costs." },
      { href: "/more/admin/strategies", label: "Strategies", description: "Return and hit rate for each strategy; rename, merge or delete." },
      { href: "/more/admin/leagues", label: "Leagues", description: "Hide leagues, reset stats, set country and tier." },
      { href: "/more/admin/results", label: "Amend results", description: "Correct a hit or miss, or remove a pick." },
    ],
  },
  {
    label: "Members and site",
    items: [
      { href: "/more/admin/members", label: "Members", description: "Accounts, sign-ups, memberships, trials and the members' rules." },
      { href: "/more/admin/settings", label: "Settings", description: "Public view, Telegram, download every pick, fresh start." },
    ],
  },
  {
    label: "Horses",
    items: [{ href: "/more/admin/horses", label: "Horses", description: "Your daily NAP and choices: results, returns and patterns." }],
  },
] as const;

export type AdminSection = (typeof ADMIN_GROUPS)[number]["items"][number];

export const ADMIN_SECTIONS: AdminSection[] = ADMIN_GROUPS.flatMap((g): readonly AdminSection[] => g.items);
