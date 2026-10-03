/** UK-day helpers for the browser, matching the engine's (apps/src/server/uk-time.ts). */

const ukDay = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" });

/** The UK calendar day `now` falls in, as YYYY-MM-DD. */
export function ukDateOf(now: Date = new Date()): string {
  return ukDay.format(now);
}

/**
 * The moment today (UK time) began, as an ISO string: 00:00 UK is 00:00 UTC in winter and 23:00 UTC the evening before
 * in summer. "Today" on the Dashboard and Strategies means since then, as on Win/Loss and the Trade Log.
 */
export function ukMidnightIso(now: Date = new Date()): string {
  const date = ukDateOf(now);
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  const midnightUtc = Date.UTC(y, m - 1, d);
  for (const offsetHours of [0, 1]) {
    const candidate = midnightUtc - offsetHours * 3_600_000;
    if (ukDay.format(new Date(candidate)) === date && ukDay.format(new Date(candidate - 60_000)) !== date) {
      return new Date(candidate).toISOString();
    }
  }
  return new Date(midnightUtc).toISOString();
}
