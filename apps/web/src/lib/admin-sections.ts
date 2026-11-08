/**
 * The admin pages, grouped by how often they're used, in the order they appear in the desktop sidebar, the phone
 * admin row and the More page (four groups since the 29 Oct 2026 tidy-up, from six):
 * - Every day: today at a glance, each strategy, its Golden slices, the betting itself, and profit and loss.
 * - Research: leagues (ours and their past seasons). Opened now and then.
 * - Settings and tools: settings, members, the notification log, fixing a result, and the archive of old strategies.
 * - Horses: the separate racing log, one page with tabs.
 * On phones only "Every day" sits in the admin row; the rest are a tap away on More (see AdminNav).
 * Settled picks live on the Trade Log; "Fix a result" is the admin's editing view of it (raw alerts on a second tab).
 */
export const ADMIN_GROUPS = [
  {
    label: "Every day",
    daily: true,
    items: [
      { href: "/more/admin/today", label: "Today", description: "Status, today's result and anything at risk." },
      { href: "/more/admin/strategies", label: "Strategies", description: "Results, Live / Sim and stakes." },
      { href: "/more/admin/golden", label: "Golden", description: "Slices worth more than the rest." },
      { href: "/more/admin/sending", label: "Betting", description: "Betfair bets, the switch and limits." },
      { href: "/more/admin/winloss", label: "Profit", description: "Profit by day and strategy." },
    ],
  },
  {
    label: "Research",
    daily: false,
    items: [
      { href: "/more/admin/leagues", label: "Leagues", description: "League results, hiding and tiers." },
    ],
  },
  {
    // Set once and rarely opened: kept off the phone's admin row.
    label: "Settings and tools",
    daily: false,
    items: [
      { href: "/more/admin/settings", label: "Settings", description: "Public view, alerts and downloads." },
      { href: "/more/admin/members", label: "Members", description: "Accounts, trials and access." },
      { href: "/more/admin/notifications", label: "Notifications", short: "Alerts", description: "The last 60 days of notifications." },
      { href: "/more/admin/results", label: "Fix a result", short: "Fixes", description: "Correct or remove a pick." },
      { href: "/more/admin/reports", label: "Report", description: "Daily and weekly reports." },
      { href: "/more/admin/tips", label: "Free tips", short: "Tips", description: "Telegram tip channels." },
      { href: "/more/admin/archive", label: "Archive", description: "Old strategies kept on record." },
    ],
  },
  {
    label: "Horses",
    daily: false,
    items: [{ href: "/more/admin/horses", label: "Horses", description: "Today's NAP and the daily log." }],
  },
] as const;

export type AdminSection = (typeof ADMIN_GROUPS)[number]["items"][number];

export const ADMIN_SECTIONS: AdminSection[] = ADMIN_GROUPS.flatMap((g): readonly AdminSection[] => g.items);
