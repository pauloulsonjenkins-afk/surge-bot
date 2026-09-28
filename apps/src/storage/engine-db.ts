/**
 * The engine's SQLite file: one file, no database server.
 *
 * Tables:
 *   inplayguru_webhooks  every verified webhook, stored exactly as received
 *   trade_log            the trade log (one row per TradeLogSink entry)
 *   live_picks           one row per Telegram alert, parsed into fields. Keyed by
 *                        (chat_id, message_id) so that when Telegram EDITS the
 *                        alert after full time, the same row is updated with the
 *                        result instead of a duplicate being added. The Dashboard,
 *                        Trade Log and Strategies pages are all computed from it.
 *
 * The file lives on the container's disk, which DigitalOcean wipes on every
 * redeploy or restart. BackupScheduler copies it to your Space after each
 * change, and startup restores it from there (see spaces-sync.ts).
 */
import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { ParsedAlert } from "../inplayguru/parse-alert";

export interface CapturedWebhook {
  receivedAt: string;
  bodySha256: string;
  contentType: string | null;
  signatureVerified: boolean;
  body: string;
}

export interface StoredWebhook extends CapturedWebhook {
  id: number;
}

/** Hit-rate figures for the Dashboard and Strategies pages. Results come from the alert's own Hit/Miss marker. */
export interface HitRateRow {
  label: string;
  alerts: number;
  hits: number;
  misses: number;
  /** Percent 0-100, or null until at least one alert has settled. */
  hitRate: number | null;
}

export interface StrategyStats extends HitRateRow {
  market: string | null;
  lastAlertAt: string;
}

export interface DailyStats {
  /** YYYY-MM-DD, UK date. */
  date: string;
  hits: number;
  misses: number;
  hitRate: number | null;
}

export interface HitRateStats {
  /** Window in days, or null for all time. */
  days: number | null;
  totals: {
    alerts: number;
    hits: number;
    misses: number;
    /** Alerts still waiting for their result. */
    pending: number;
    /** Alerts that could not be mapped to a market or failed a check. */
    needsReview: number;
    hitRate: number | null;
  };
  byStrategy: StrategyStats[];
  byLeague: HitRateRow[];
  /** Hit rate by the match minute the alert fired at, in fixed order. */
  byMinute: HitRateRow[];
  daily: DailyStats[];
}

function rate(hits: number, misses: number): number | null {
  const n = hits + misses;
  return n === 0 ? null : Math.round((hits / n) * 1000) / 10;
}

/** "Both Teams to Score (Favorite conceded first)" and "... (Underdog scored first)" are one strategy. */
function strategyLabel(raw: string): string {
  return raw.replace(/\([^)]*\)/g, "").replace(/\s+/g, " ").trim() || raw;
}

const ukDate = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" });

/** Match-minute buckets for the "when do alerts hit" chart. Upper bound is inclusive. */
const MINUTE_BUCKETS: Array<{ label: string; max: number }> = [
  { label: "1–15'", max: 15 },
  { label: "16–30'", max: 30 },
  { label: "31–45'", max: 45 },
  { label: "46–60'", max: 60 },
  { label: "61–75'", max: 75 },
  { label: "76'+", max: Infinity },
];

/** What the Live tab reads. One per Telegram alert. */
export interface LivePick {
  id: number;
  chatId: string;
  messageId: number;
  firstSeenAt: string;
  updatedAt: string;
  strategy: string;
  market: string | null;
  selection: string | null;
  competition: string | null;
  home: string | null;
  away: string | null;
  minute: number | null;
  timerRaw: string | null;
  goalsHome: number | null;
  goalsAway: number | null;
  htScore: string | null;
  ftScore: string | null;
  result: "hit" | "miss" | null;
  /** captured = live and unsettled; settled = has a result; unmapped/flagged = must not be sent to bet. */
  status: "captured" | "settled" | "unmapped" | "flagged";
  sendable: boolean;
  flags: string[];
  /** The full parsed alert (all stats, odds, etc.) for the detail view. */
  detail: ParsedAlert | null;
  rawText: string;
}

export class EngineDb {
  private readonly db: Database.Database;
  private readonly onChange: () => void;

  constructor(path: string, onChange: () => void) {
    mkdirSync(dirname(path), { recursive: true });
    this.db = new Database(path);
    this.onChange = onChange;
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS inplayguru_webhooks (
        id                  INTEGER PRIMARY KEY AUTOINCREMENT,
        received_at         TEXT NOT NULL,
        body_sha256         TEXT NOT NULL UNIQUE,
        content_type        TEXT,
        signature_verified  INTEGER NOT NULL,
        body                TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS trade_log (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        logged_at   TEXT NOT NULL,
        entry_json  TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS live_picks (
        id             INTEGER PRIMARY KEY AUTOINCREMENT,
        chat_id        TEXT NOT NULL,
        message_id     INTEGER NOT NULL,
        first_seen_at  TEXT NOT NULL,
        updated_at     TEXT NOT NULL,
        strategy       TEXT NOT NULL,
        market         TEXT,
        selection      TEXT,
        competition    TEXT,
        home           TEXT,
        away           TEXT,
        minute         INTEGER,
        timer_raw      TEXT,
        goals_home     INTEGER,
        goals_away     INTEGER,
        ht_score       TEXT,
        ft_score       TEXT,
        result         TEXT,
        status         TEXT NOT NULL,
        sendable       INTEGER NOT NULL,
        flags_json     TEXT NOT NULL,
        parsed_json    TEXT NOT NULL,
        raw_text       TEXT NOT NULL,
        UNIQUE (chat_id, message_id)
      );
    `);
  }

  /** Stores a webhook. Returns false if an identical body was already stored (a retry or replay). */
  saveWebhook(w: CapturedWebhook): boolean {
    const result = this.db
      .prepare(
        `INSERT INTO inplayguru_webhooks (received_at, body_sha256, content_type, signature_verified, body)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(body_sha256) DO NOTHING`,
      )
      .run(w.receivedAt, w.bodySha256, w.contentType, w.signatureVerified ? 1 : 0, w.body);
    const isNew = result.changes === 1;
    if (isNew) this.onChange();
    return isNew;
  }

  /** Storage half of the SQLite trade log sink; the TradeLogSink adapter calls this. */
  appendTradeLogEntry(entry: unknown): void {
    this.db
      .prepare(`INSERT INTO trade_log (logged_at, entry_json) VALUES (?, ?)`)
      .run(new Date().toISOString(), JSON.stringify(entry));
    this.onChange();
  }

  countWebhooks(): number {
    const row = this.db.prepare(`SELECT COUNT(*) AS n FROM inplayguru_webhooks`).get() as { n: number };
    return row.n;
  }

  /** Most recently captured webhooks, newest first. For the admin site's "picks received" view. */
  listRecentWebhooks(limit = 50): StoredWebhook[] {
    const capped = Math.min(Math.max(limit, 1), 200);
    const rows = this.db
      .prepare(
        `SELECT id, received_at, body_sha256, content_type, signature_verified, body
         FROM inplayguru_webhooks
         ORDER BY id DESC
         LIMIT ?`,
      )
      .all(capped) as Array<{
      id: number;
      received_at: string;
      body_sha256: string;
      content_type: string | null;
      signature_verified: number;
      body: string;
    }>;
    return rows.map((r) => ({
      id: r.id,
      receivedAt: r.received_at,
      bodySha256: r.body_sha256,
      contentType: r.content_type,
      signatureVerified: !!r.signature_verified,
      body: r.body,
    }));
  }

  /**
   * Inserts a parsed alert, or, if this Telegram message was already stored
   * (i.e. this is the edit that adds the full-time result), updates that same
   * row. Returns "inserted" or "updated".
   */
  upsertLivePick(chatId: string, messageId: number, rawText: string, parsed: ParsedAlert): "inserted" | "updated" {
    const now = new Date().toISOString();
    const settled = parsed.result !== null || parsed.ftScore !== null;
    const status: LivePick["status"] = settled
      ? "settled"
      : parsed.market === null
        ? "unmapped"
        : parsed.flags.length > 0
          ? "flagged"
          : "captured";

    const existing = this.db
      .prepare(`SELECT id FROM live_picks WHERE chat_id = ? AND message_id = ?`)
      .get(chatId, messageId) as { id: number } | undefined;

    this.db
      .prepare(
        `INSERT INTO live_picks (
           chat_id, message_id, first_seen_at, updated_at, strategy, market, selection, competition,
           home, away, minute, timer_raw, goals_home, goals_away, ht_score, ft_score, result,
           status, sendable, flags_json, parsed_json, raw_text
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(chat_id, message_id) DO UPDATE SET
           updated_at  = excluded.updated_at,
           strategy    = excluded.strategy,
           market      = excluded.market,
           selection   = excluded.selection,
           competition = excluded.competition,
           home        = excluded.home,
           away        = excluded.away,
           minute      = COALESCE(live_picks.minute, excluded.minute),
           timer_raw   = COALESCE(live_picks.timer_raw, excluded.timer_raw),
           goals_home  = excluded.goals_home,
           goals_away  = excluded.goals_away,
           ht_score    = excluded.ht_score,
           ft_score    = excluded.ft_score,
           result      = excluded.result,
           status      = excluded.status,
           sendable    = excluded.sendable,
           flags_json  = excluded.flags_json,
           parsed_json = excluded.parsed_json,
           raw_text    = excluded.raw_text`,
      )
      .run(
        chatId,
        messageId,
        now,
        now,
        parsed.strategyRaw,
        parsed.market,
        parsed.selection,
        parsed.competition,
        parsed.home,
        parsed.away,
        parsed.minute,
        parsed.timerRaw,
        parsed.goalsHome,
        parsed.goalsAway,
        parsed.htScore,
        parsed.ftScore,
        parsed.result,
        status,
        // Once settled, nothing can be sent to bet, whatever the alert said earlier.
        parsed.sendable && !settled ? 1 : 0,
        JSON.stringify(parsed.flags),
        JSON.stringify(parsed),
        rawText,
      );

    this.onChange();
    return existing ? "updated" : "inserted";
  }

  countLivePicks(): number {
    const row = this.db.prepare(`SELECT COUNT(*) AS n FROM live_picks`).get() as { n: number };
    return row.n;
  }

  /** Most recent alerts, newest first. For the Live tab. */
  listLivePicks(limit = 50): LivePick[] {
    const capped = Math.min(Math.max(limit, 1), 200);
    const rows = this.db
      .prepare(`SELECT * FROM live_picks ORDER BY id DESC LIMIT ?`)
      .all(capped) as Array<Record<string, unknown>>;

    return rows.map((r) => {
      let detail: ParsedAlert | null = null;
      let flags: string[] = [];
      try {
        detail = JSON.parse(String(r.parsed_json)) as ParsedAlert;
      } catch {
        detail = null;
      }
      try {
        flags = JSON.parse(String(r.flags_json)) as string[];
      } catch {
        flags = [];
      }
      return {
        id: Number(r.id),
        chatId: String(r.chat_id),
        messageId: Number(r.message_id),
        firstSeenAt: String(r.first_seen_at),
        updatedAt: String(r.updated_at),
        strategy: String(r.strategy),
        market: (r.market as string | null) ?? null,
        selection: (r.selection as string | null) ?? null,
        competition: (r.competition as string | null) ?? null,
        home: (r.home as string | null) ?? null,
        away: (r.away as string | null) ?? null,
        minute: r.minute === null ? null : Number(r.minute),
        timerRaw: (r.timer_raw as string | null) ?? null,
        goalsHome: r.goals_home === null ? null : Number(r.goals_home),
        goalsAway: r.goals_away === null ? null : Number(r.goals_away),
        htScore: (r.ht_score as string | null) ?? null,
        ftScore: (r.ft_score as string | null) ?? null,
        result: (r.result as "hit" | "miss" | null) ?? null,
        status: r.status as LivePick["status"],
        sendable: Number(r.sendable) === 1,
        flags,
        detail,
        rawText: String(r.raw_text),
      };
    });
  }

  /**
   * Hit-rate figures over the last `days` days (null = all time), by strategy,
   * league and UK calendar day. A pick counts as a hit or miss only when the
   * alert itself carries a Hit/Miss marker, so nothing here is guessed.
   */
  hitRateStats(days: number | null): HitRateStats {
    const since = days === null ? null : new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
    const rows = (
      since === null
        ? this.db.prepare(`SELECT first_seen_at, strategy, market, competition, minute, result, status FROM live_picks ORDER BY id`).all()
        : this.db
            .prepare(
              `SELECT first_seen_at, strategy, market, competition, minute, result, status
               FROM live_picks WHERE first_seen_at >= ? ORDER BY id`,
            )
            .all(since)
    ) as Array<{
      first_seen_at: string;
      strategy: string;
      market: string | null;
      competition: string | null;
      minute: number | null;
      result: string | null;
      status: string;
    }>;

    let hits = 0;
    let misses = 0;
    let pending = 0;
    let needsReview = 0;
    const strategies = new Map<string, StrategyStats>();
    const leagues = new Map<string, HitRateRow>();
    const daily = new Map<string, { hits: number; misses: number }>();
    const minutes: HitRateRow[] = MINUTE_BUCKETS.map((b) => ({ label: b.label, alerts: 0, hits: 0, misses: 0, hitRate: null }));

    for (const r of rows) {
      const isHit = r.result === "hit";
      const isMiss = r.result === "miss";
      if (r.status === "captured") pending++;
      if (r.status === "flagged" || r.status === "unmapped") needsReview++;

      const sLabel = strategyLabel(r.strategy);
      const s =
        strategies.get(sLabel.toLowerCase()) ??
        { label: sLabel, alerts: 0, hits: 0, misses: 0, hitRate: null, market: r.market, lastAlertAt: r.first_seen_at };
      s.alerts++;
      s.market = r.market ?? s.market;
      s.lastAlertAt = r.first_seen_at;
      strategies.set(sLabel.toLowerCase(), s);

      const lLabel = r.competition ?? "Unknown league";
      const l = leagues.get(lLabel) ?? { label: lLabel, alerts: 0, hits: 0, misses: 0, hitRate: null };
      l.alerts++;
      leagues.set(lLabel, l);

      const bucketIdx = r.minute === null ? -1 : MINUTE_BUCKETS.findIndex((b) => r.minute! <= b.max);
      const m = bucketIdx >= 0 ? minutes[bucketIdx] : undefined;
      if (m) m.alerts++;

      if (isHit || isMiss) {
        if (isHit) {
          hits++;
          s.hits++;
          l.hits++;
          if (m) m.hits++;
        } else {
          misses++;
          s.misses++;
          l.misses++;
          if (m) m.misses++;
        }
        const day = ukDate.format(new Date(r.first_seen_at));
        const d = daily.get(day) ?? { hits: 0, misses: 0 };
        if (isHit) d.hits++;
        else d.misses++;
        daily.set(day, d);
      }
    }

    const finish = <T extends HitRateRow>(m: Map<string, T>): T[] =>
      [...m.values()].map((x) => ({ ...x, hitRate: rate(x.hits, x.misses) }));

    return {
      days,
      totals: { alerts: rows.length, hits, misses, pending, needsReview, hitRate: rate(hits, misses) },
      byStrategy: finish(strategies).sort((a, b) => b.hits + b.misses - (a.hits + a.misses) || b.alerts - a.alerts),
      byLeague: finish(leagues).sort((a, b) => b.hits + b.misses - (a.hits + a.misses) || b.alerts - a.alerts),
      byMinute: minutes.map((x) => ({ ...x, hitRate: rate(x.hits, x.misses) })),
      daily: [...daily.entries()]
        .sort(([a], [b]) => (a < b ? -1 : 1))
        .map(([date, d]) => ({ date, hits: d.hits, misses: d.misses, hitRate: rate(d.hits, d.misses) })),
    };
  }

  /** Writes a consistent copy of the whole database to `destPath`, safe while the service is running. */
  async snapshotTo(destPath: string): Promise<void> {
    await this.db.backup(destPath);
  }

  close(): void {
    this.db.close();
  }
}
