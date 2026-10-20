/**
 * How long each part of a report takes (ms). The engine reads alerts and places bets on the same thread, so a slow
 * report holds them up: the parts go in the report's data as "timings", and the whole is logged when over a second.
 */
import { log } from "./log";

export function reportTimings(name: string) {
  const timings: Record<string, number> = {};
  return {
    timed<T>(part: string, work: () => T): T {
      const t = performance.now();
      const out = work();
      timings[part] = Math.round(performance.now() - t);
      return out;
    },
    /** The parts so far, logged when together they took over a second. */
    done(): Record<string, number> {
      const total = Object.values(timings).reduce((a, b) => a + b, 0);
      if (total > 1000) log.warn(`${name} took ${total} ms: ${Object.entries(timings).map(([k, v]) => `${k} ${v}`).join(", ")}.`);
      return timings;
    },
  };
}
