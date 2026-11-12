/**
 * How long the engine's one thread keeps things waiting (site review A1, 12 Nov 2026).
 *
 * Alerts, bet placing and every page share one thread: while a report is worked out (seconds, on the live data) nothing
 * else moves. This measures it, so "the pages feel slow" becomes a figure that can be watched and compared before and
 * after a change. Node's own histogram samples the delay every 20 ms; each minute the worst and the 99th percentile
 * are kept, and a long one is logged.
 */
import { monitorEventLoopDelay } from "node:perf_hooks";
import { log } from "./log";

export interface LoopDelay {
  /** The last full minute: 99th percentile and worst delay, in milliseconds. Null until a minute has passed. */
  p99Ms: number | null;
  maxMs: number | null;
  /** The worst delay in any minute since the engine started, and when. */
  worstMs: number | null;
  worstAt: string | null;
}

const WARN_MS = 500;
let state: LoopDelay = { p99Ms: null, maxMs: null, worstMs: null, worstAt: null };
let started = false;

/** Starts measuring (once). Safe to call again. */
export function startLoopDelay(everyMs = 60_000): void {
  if (started) return;
  started = true;
  const h = monitorEventLoopDelay({ resolution: 20 });
  h.enable();
  setInterval(() => {
    // Nanoseconds; the sampling interval itself is taken off, so an idle loop reads about 0.
    const ms = (ns: number) => Math.max(0, Math.round(ns / 1e6 - 20));
    const p99 = ms(h.percentile(99));
    const max = ms(h.max);
    h.reset();
    const worse = state.worstMs === null || max > state.worstMs;
    state = { p99Ms: p99, maxMs: max, worstMs: worse ? max : state.worstMs, worstAt: worse ? new Date().toISOString() : state.worstAt };
    if (max >= WARN_MS) log.warn(`The engine's thread was held up for ${max} ms in the last minute (99th percentile ${p99} ms): alerts and bets waited that long.`);
  }, everyMs).unref?.();
}

export function loopDelay(): LoopDelay {
  return state;
}
