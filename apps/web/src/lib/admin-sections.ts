/** The admin pages, in the order they appear in the admin menu and the desktop sidebar. */
export const ADMIN_SECTIONS = [
  { href: "/more/admin/results", label: "Results" },
  { href: "/more/admin/sending", label: "Sending" },
  { href: "/more/admin/winloss", label: "Win/Loss" },
  { href: "/more/admin/leagues", label: "Leagues" },
  { href: "/more/admin/strategies", label: "Strategies" },
  { href: "/more/admin/picks", label: "Picks" },
  { href: "/more/admin/users", label: "Users" },
  { href: "/more/admin/settings", label: "Settings" },
] as const;
