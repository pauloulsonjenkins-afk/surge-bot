/**
 * The admin pages, grouped by job, in the order they appear in the desktop sidebar, the phone admin menu and
 * the More page. Settled picks themselves live on the Trade Log; "Amend results" is the admin's editing view of
 * it (with the raw alerts as a second tab).
 */
export const ADMIN_GROUPS = [
  {
    label: "Operate",
    items: [
      { href: "/more/admin/sending", label: "Sending", description: "What is sent to your betting software, and stakes." },
      { href: "/more/admin/strategies", label: "Strategies", description: "Hit rate for each strategy, merge or delete." },
      { href: "/more/admin/leagues", label: "Leagues", description: "Hide leagues, reset stats, set country and tier." },
    ],
  },
  {
    label: "Review",
    items: [
      { href: "/more/admin/winloss", label: "Win/Loss", description: "Estimated profit and loss by day and strategy." },
      { href: "/more/admin/results", label: "Amend results", description: "Correct a hit or miss, or remove a pick." },
      { href: "/more/admin/reconcile", label: "Reconcile", description: "Real Betfair results against the app's estimates." },
      { href: "/more/admin/horses", label: "Horses", description: "Your daily NAP and choices: results, returns and patterns." },
    ],
  },
  {
    label: "Setup",
    items: [
      { href: "/more/admin/users", label: "Users", description: "Who can sign in, and which pages they see." },
      { href: "/more/admin/settings", label: "Settings", description: "Public view, and a fresh start for the stats." },
      { href: "/more/admin/direct", label: "Direct betting", description: "Place bets on Betfair from GoalBrew itself (off until you switch it on)." },
    ],
  },
] as const;

export type AdminSection = (typeof ADMIN_GROUPS)[number]["items"][number];

export const ADMIN_SECTIONS: AdminSection[] = ADMIN_GROUPS.flatMap((g): readonly AdminSection[] => g.items);
