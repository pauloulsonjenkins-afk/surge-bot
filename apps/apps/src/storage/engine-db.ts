/**
 * The engine's SQLite file: one file, no database server.
 *
 * Tables:
 *   inplayguru_webhooks  every verified webhook, stored exactly as received
 *   trade_log            the trade log (one row per TradeLogSink entry)
 *   live_picks           one row per Telegram alert, parsed into fields. Keyed by
 *                        (chat_id, message_id) so that when Telegram EDITS the
 *                        alert after full time, the same row is updated with the
 *                        result instead of a duplicate being added.
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
           minute      = excluded.minute,
           timer_raw   = excluded.timer_raw,
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

  /** Writes a consistent copy of the whole database to `destPath`, safe while the service is running. */
  async snapshotTo(destPath: string): Promise<void> {
    await this.db.backup(destPath);
  }

  close(): void {
    this.db.close();
  }
}
