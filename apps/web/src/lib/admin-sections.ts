/**
 * The admin's navigation, in one place (rebuilt 14 Nov 2026). The phone's tab bar, the desktop sidebar and the More page
 * all read this, so they can't drift apart: before, the phone and the desktop had different menus, More listed 17 pages
 * (five of them already on the bar) and Golden was reachable from three places.
 *
 *  - Four main pages, the same on every screen: Home, Live, Strategies, Profit.
 *  - "More": the handful of pages opened now and then.
 *  - Families: pages that belong to a main page sit under it as tabs (Golden under Strategies, the Report under
 *    Profit, the notification log under Settings), not as menu rows of their own. The main page's tab stays lit on
 *    all of them.
 */
const A = "/more/admin";

export interface NavItem {
  href: string;
  label: string;
  description?: string;
}

/** The main pages: the phone's tab bar (with More after them) and the top of the desktop sidebar. */
export const ADMIN_MAIN: NavItem[] = [
  { href: `${A}/today`, label: "Home", description: "Is it working, how today is going and what needs you." },
  { href: "/live", label: "Live", description: "Matches in play with their alerts." },
  { href: `${A}/strategies`, label: "Strategies", description: "Results, Live / Sim and stakes." },
  { href: `${A}/winloss`, label: "Profit", description: "Profit by day and strategy." },
];

/** Everything else: the More page on phones, the second group in the desktop sidebar. */
export const ADMIN_MORE: NavItem[] = [
  { href: `${A}/sending`, label: "Betting", description: "Betfair bets, the switch and limits." },
  { href: "/trade-log", label: "Trade Log", description: "Every settled pick." },
  { href: "/schedule", label: "Schedule", description: "Today's fixtures." },
  { href: `${A}/leagues`, label: "Leagues", description: "League results, hiding and tiers." },
  { href: `${A}/horses`, label: "Horses", description: "Today's NAP and the daily log." },
  { href: `${A}/settings`, label: "Settings", description: "Alerts, notifications, fixes and downloads." },
];

/** A main (or More) page and the pages shown as tabs under it. `root` is the menu entry that stays lit. */
export interface NavFamily {
  root: string;
  tabs: NavItem[];
}

export const ADMIN_FAMILIES: NavFamily[] = [
  {
    root: `${A}/strategies`,
    tabs: [
      { href: `${A}/strategies`, label: "Overview" },
      { href: `${A}/golden`, label: "Golden" },
      { href: `${A}/strategies/all`, label: "Full detail" },
      { href: `${A}/archive`, label: "Archive" },
      // Each tip channel is already a strategy of its own ("Telegram: <channel>", tips/track.ts in the engine); this
      // page is where its channels are chosen and its messages checked, so it sits with the strategies.
      { href: `${A}/tips`, label: "Tip channels" },
    ],
  },
  {
    root: `${A}/winloss`,
    tabs: [
      { href: `${A}/winloss`, label: "Profit" },
      { href: `${A}/reports`, label: "Report" },
    ],
  },
  {
    root: `${A}/settings`,
    tabs: [
      { href: `${A}/settings`, label: "Settings" },
      { href: `${A}/notifications`, label: "Notifications" },
      { href: `${A}/results`, label: "Fix a result" },
    ],
  },
];

const under = (pathname: string, href: string) => pathname === href || pathname.startsWith(`${href}/`);

/** The family a page belongs to and which of its tabs is open (the longest address that matches), or null. */
export function familyOf(pathname: string): { family: NavFamily; tab: NavItem | null } | null {
  for (const family of ADMIN_FAMILIES) {
    const tab = [...family.tabs].sort((a, b) => b.href.length - a.href.length).find((t) => under(pathname, t.href)) ?? null;
    if (tab) return { family, tab };
  }
  return null;
}

/** Whether a menu entry is the one to light for this page: the page itself, a page under it, or one of its family. */
export function navActive(pathname: string, href: string): boolean {
  const fam = familyOf(pathname);
  if (fam) return fam.family.root === href;
  return under(pathname, href);
}

/** The old Dashboard is part of Home for the admin. */
export const ADMIN_HOME = `${A}/today`;
