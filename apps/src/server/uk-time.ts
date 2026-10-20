/** UK-day helpers, so "today", "yesterday" and a chosen date always mean the UK calendar day, in summer and winter time. */

const ukDay = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" });

export function isUkDate(v: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T12:00:00Z`));
}

export function ukDateOf(d: Date): string {
  return ukDay.format(d);
}

/**
 * ukDateOf for a stored time (ISO), kept for each hour: a UK day starts on the hour (midnight GMT or BST) and the clocks
 * change on the hour, so every moment in one hour has the same UK day. For reports that date every pick: working it out
 * afresh for each was a sixth of their time.
 */
const dayByHour = new Map<number, string>();
export function ukDateOfIso(at: string): string {
  const ms = Date.parse(at);
  if (!Number.isFinite(ms)) return ukDay.format(new Date(at));
  const hour = Math.floor(ms / 3_600_000);
  let day = dayByHour.get(hour);
  if (day === undefined) {
    if (dayByHour.size > 50_000) dayByHour.clear();
    dayByHour.set(hour, (day = ukDay.format(hour * 3_600_000)));
  }
  return day;
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
