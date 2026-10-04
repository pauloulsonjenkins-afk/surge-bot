/**
 * Small helpers for the CSV downloads (Direct betting, and every pick on Settings), written so Excel opens them
 * cleanly: UK times Excel reads as dates, numbers as numbers, text quoted when needed, and a byte order mark so £ and
 * accented team names come out right.
 */

const ukTime = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });
const ukWeekday = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", weekday: "short" });

function parts(iso: string): Record<string, string> {
  return Object.fromEntries(ukTime.formatToParts(new Date(iso)).map((p) => [p.type, p.value]));
}

/** "2026-10-04 19:32:05", UK time. */
export function excelTime(iso: string | null): string {
  if (!iso) return "";
  const p = parts(iso);
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}:${p.second}`;
}

/** The UK date, time of day, weekday and hour of a moment, as separate columns for pivot tables. */
export function ukParts(iso: string): { date: string; time: string; weekday: string; hour: number } {
  const p = parts(iso);
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}:${p.second}`, weekday: ukWeekday.format(new Date(iso)), hour: Number(p.hour) };
}

/** One CSV cell. Text that Excel would run as a formula (starting =, +, -, @) is quoted so it stays text. */
export function cell(v: string | number | boolean | null | undefined): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "boolean") return v ? "yes" : "no";
  if (typeof v === "number") return Number.isFinite(v) ? String(Math.round(v * 10000) / 10000) : "";
  const s = v.replace(/[\r\n]+/g, " ");
  return /[",]/.test(s) || /^[=+\-@]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** A whole CSV file from a header and rows, with the byte order mark Excel needs for UTF-8. */
export function toExcelCsv(header: string[], rows: Array<Array<string | number | boolean | null | undefined>>): string {
  return "\uFEFF" + [header.map(cell).join(","), ...rows.map((r) => r.map(cell).join(","))].join("\r\n") + "\r\n";
}
