/**
 * The page groups an admin can switch on for each user. Three groups, because the site's data comes from
 * three places: giving someone "Live" also gives them Trade Log, since both show the same alerts.
 * Admin pages are not in this list: they stay behind the admin password.
 */
export const USER_PAGES = ["dashboard", "live", "schedule"] as const;
export type UserPage = (typeof USER_PAGES)[number];

export const USER_PAGE_LABEL: Record<UserPage, { title: string; detail: string }> = {
  dashboard: { title: "Dashboard", detail: "Dashboard (hit rates by strategy, league and minute)" },
  live: { title: "Live", detail: "Live and Trade Log (the alerts)" },
  schedule: { title: "Schedule", detail: "Today's and tomorrow's fixtures" },
};

/** Which permission each bottom-bar tab needs. More has none: it is always open. */
export const TAB_PAGE: Record<string, UserPage | null> = {
  "/dashboard": "dashboard",
  "/live": "live",
  "/trade-log": "live",
  "/schedule": "schedule",
  "/more": null,
};

/** Only same-site paths, so a sign-in link can't send someone to another website. */
export function safeNext(next: string | null | undefined, fallback = "/more"): string {
  if (typeof next !== "string" || !next.startsWith("/")) return fallback;
  // Resolved the way the browser will: it drops tabs and line breaks and reads "\" as "/", so "/\t/evil.com" becomes
  // "//evil.com", another site. Only a path that still lands on this site is used.
  const base = "https://goalbrew.invalid";
  try {
    const url = new URL(next, base);
    return url.origin === base ? `${url.pathname}${url.search}${url.hash}` : fallback;
  } catch {
    return fallback;
  }
}
