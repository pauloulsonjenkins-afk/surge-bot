/** UK-day helpers, so "today", "yesterday" and a chosen date always mean the UK calendar day, in summer and winter time. */

const ukDay = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" });

export function isUkDate(v: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T12:00:00Z`));
}

export function ukDateOf(d: Date): string {
  return ukDay.format(d);
}

/** The moment a UK day starts (00:00 UK time) as a UTC instant. */
function startOfUkDay(date: string): number {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  const midnightUtc = Date.UTC(y, m - 1, d);
  // UK midnight is 00:00 UTC in winter (GMT) and 23:00 UTC the evening before in summer (BST).
  for (const offsetHours of [0, 1]) {
    const candidate = midnightUtc - offsetHours * 3_600_000;
    if (ukDay.format(candidate) === date && ukDay.format(candidate - 60_000) !== date) return candidate;
  }
  return midnightUtc;
}

/** [from, to) as ISO strings covering one whole UK day. */
export function ukDayBounds(date: string): { from: string; to: string } {
  const next = new Date(`${date}T12:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  return {
    from: new Date(startOfUkDay(date)).toISOString(),
    to: new Date(startOfUkDay(ukDay.format(next))).toISOString(),
  };
}
