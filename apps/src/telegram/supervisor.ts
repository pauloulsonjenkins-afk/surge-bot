/**
 * Keeps the Telegram listener connected from the saved session.
 *
 * Until 20 Oct 2026 the engine tried once at start-up: if that failed (Telegram busy with the outgoing container during
 * a deploy, a network blip), alerts stayed off until the next restart, and nothing was bet. Now a failed attempt is
 * tried again after 30 s, 1, 2 and 5 minutes, then every 5 minutes, each given a minute to connect before it is
 * abandoned (the client is then shut down, so a late connection can't leave two clients on one session). When Telegram
 * refuses the session itself, retrying can't help: it says so (the Today page shows it) and tries only every 15 minutes.
 */
import { log } from "../server/log";

export const RETRY_STEPS_MS = [30_000, 60_000, 120_000, 300_000];
export const DEAD_SESSION_RETRY_MS = 15 * 60_000;
export const CONNECT_TIMEOUT_MS = 60_000;

/** Telegram's answers that mean the saved session no longer works: a new login is needed. */
export function isDeadSession(message: string): boolean {
  return /AUTH_KEY_UNREGISTERED|AUTH_KEY_DUPLICATED|AUTH_KEY_INVALID|SESSION_REVOKED|SESSION_EXPIRED|USER_DEACTIVATED/i.test(message);
}

/** How long to wait after failed attempt number `attempt` (1 = the first). */
export function retryDelay(attempt: number, message: string): number {
  if (isDeadSession(message)) return DEAD_SESSION_RETRY_MS;
  return RETRY_STEPS_MS[Math.min(Math.max(attempt, 1), RETRY_STEPS_MS.length) - 1]!;
}

export interface ConnectState {
  error: string | null;
  nextTryAt: string | null;
  dead: boolean;
  attempts: number;
}

/** One attempt: `ready` settles once the listener is attached; `close` shuts this attempt's client down. */
export interface Attempt {
  ready: Promise<void>;
  close: () => Promise<void>;
}

export interface Supervisor {
  start(): void;
  stop(): Promise<void>;
}

const describe = (err: unknown) => (err instanceof Error ? err.message : String(err));

export function superviseTelegram(opts: {
  connect: () => Attempt;
  onState: (s: ConnectState) => void;
  /** True when a listener is already attached some other way (the admin's Telegram login): no need to keep trying. */
  attachedElsewhere?: () => boolean;
  timeoutMs?: number;
  /** The wait before the next attempt (tests shorten it). */
  retryAfter?: (attempt: number, message: string) => number;
  now?: () => number;
}): Supervisor {
  const timeoutMs = opts.timeoutMs ?? CONNECT_TIMEOUT_MS;
  const retryAfter = opts.retryAfter ?? retryDelay;
  const now = opts.now ?? Date.now;
  let running = false;
  let run = 0;
  let attempt = 0;
  let timer: NodeJS.Timeout | null = null;
  let current: Attempt | null = null;

  const tryOnce = async (mine: number): Promise<void> => {
    if (!running || mine !== run) return;
    if (opts.attachedElsewhere?.()) {
      opts.onState({ error: null, nextTryAt: null, dead: false, attempts: 0 });
      return;
    }
    attempt++;
    const a = opts.connect();
    let timeout: NodeJS.Timeout | null = null;
    try {
      await Promise.race([
        a.ready,
        new Promise<never>((_, reject) => {
          timeout = setTimeout(() => reject(new Error(`no answer from Telegram within ${Math.round(timeoutMs / 1000)} seconds`)), timeoutMs);
        }),
      ]);
      if (!running || mine !== run) {
        await a.close().catch(() => {});
        return;
      }
      current = a;
      if (attempt > 1) log.info(`Telegram listener connected on attempt ${attempt}.`);
      attempt = 0;
      opts.onState({ error: null, nextTryAt: null, dead: false, attempts: 0 });
    } catch (err) {
      await a.close().catch(() => {});
      if (!running || mine !== run) return;
      const message = describe(err);
      const delay = retryAfter(attempt, message);
      const dead = isDeadSession(message);
      const nextTryAt = new Date(now() + delay).toISOString();
      opts.onState({ error: message, nextTryAt, dead, attempts: attempt });
      log.error(
        dead
          ? `Telegram refused the saved session (${message}). Log in again on Admin > Settings > Telegram and save the new session as TELEGRAM_SESSION. Trying again at ${nextTryAt}.`
          : `Telegram listener couldn't connect (attempt ${attempt}): ${message}. Trying again at ${nextTryAt}.`,
      );
      timer = setTimeout(() => void tryOnce(mine), delay);
      timer.unref();
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  };

  return {
    start() {
      if (running) return;
      running = true;
      attempt = 0;
      void tryOnce(++run);
    },
    async stop() {
      running = false;
      run++;
      if (timer) clearTimeout(timer);
      timer = null;
      const c = current;
      current = null;
      if (c) await c.close().catch(() => {});
    },
  };
}
