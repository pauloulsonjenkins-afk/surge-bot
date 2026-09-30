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
    ],
  },
  {
    label: "Setup",
    items: [
      { href: "/more/admin/users", label: "Users", description: "Who can sign in, and which pages they see." },
      { href: "/more/admin/settings", label: "Settings", description: "Public view, and a fresh start for the stats." },
    ],
  },
] as const;

export const ADMIN_SECTIONS = ADMIN_GROUPS.flatMap((g) => g.items);
