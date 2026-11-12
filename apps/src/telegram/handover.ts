/**
 * A deploy's hand-over of the Telegram session, without the fixed wait (12 Nov 2026).
 *
 * Two containers must never be on the one Telegram session together (Telegram cancels it for good: 20 Oct 2026). So a
 * new container used to wait a fixed 90 seconds before connecting, and the outgoing one only noticed it once a minute:
 * every deploy cost several minutes of alerts. Now the outgoing container looks for a newer one every 10 seconds
 * (spaces-sync.ts watchLease), disconnects, and only THEN writes a note naming the container it released the session
 * to. The new container connects as soon as it reads that note. If no note comes (the outgoing container was killed, or
 * is an older build that writes none) it falls back to the full wait, exactly as before: the note can only make the
 * hand-over quicker, never riskier.
 */

/** The outgoing container's note: who it released the session to, and when. */
export interface Release {
  to: string;
  at: number;
}

export type HandoverResult = "released" | "timed out";

/**
 * Waits until the outgoing container says it has let go for `me`, or `maxMs` has passed. A note that can't be read is
 * treated as not there yet. Never throws.
 */
export async function waitForHandover(opts: {
  readRelease: () => Promise<Release | null>;
  /** This container's lease id. */
  me: string;
  maxMs: number;
  everyMs?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}): Promise<HandoverResult> {
  const now = opts.now ?? Date.now;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const every = opts.everyMs ?? 3_000;
  const until = now() + opts.maxMs;
  while (now() < until) {
    const note = await opts.readRelease().catch(() => null);
    if (note && note.to === opts.me) return "released";
    await sleep(Math.min(every, Math.max(0, until - now())));
  }
  return "timed out";
}
