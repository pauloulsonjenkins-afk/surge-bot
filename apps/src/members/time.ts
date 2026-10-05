/** UK calendar arithmetic on YYYY-MM-DD dates (the dates themselves carry no time zone, so plain UTC sums are safe). */

export function addDaysUk(date: string, days: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** The Monday of the week a UK date is in. */
export function ukWeekStart(date: string): string {
  const dow = new Date(`${date}T12:00:00Z`).getUTCDay(); // 0 = Sunday
  return addDaysUk(date, -((dow + 6) % 7));
}
