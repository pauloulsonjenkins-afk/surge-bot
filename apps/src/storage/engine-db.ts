/**
 * The engine's SQLite file: one file, no database server.
 *
 * Tables:
 *   inplayguru_webhooks  every verified webhook, stored exactly as received
 *   trade_log            the trade log (one row per TradeLogSink entry)
 *   settings             small key/value store (currently the "sending" options)
 *   schedule_fixtures    the day's matches from API-Football, for the Schedule tab
 *                        (today and tomorrow, refreshed each morning at 06:00 UK)
 *   live_picks           one row per Telegram alert, parsed into fields. Keyed by
 *                        (chat_id, message_id) so that when Telegram EDITS the
 *                        alert after full time, the same row is updated with the
 *                        result instead of a duplicate being added. The Dashboard,
 *                        Trade Log and Strategies pages are all computed from it.
 *   betfair_bets         settled bets imported from the betting software's bet history, each linked to the
 *                        pick it was placed for (see betfair/reconcile.ts). Keyed by the bet id, so importing
 *                        the same history twice changes nothing.
 *
 * The file lives on the container's disk, which DigitalOcean wipes on every
 * redeploy or restart. BackupScheduler copies it to your Space after each
 * change, and startup restores it from there (see spaces-sync.ts).
 */
import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { leagueCountryFromText, type ParsedAlert } from "../inplayguru/parse-alert";
import type { ScheduleFixture } from "../fixtures/api-football";
import type { SimRecord } from "../server/pricing";

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

/** The name a strategy is reported under (Dashboard, stats): its own name unless it was merged into another. */
function reportLabel(merges: Record<string, string>, raw: string): string {
  const own = strategyLabel(raw);
  return merges[own.toLowerCase()] ?? own;
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

/**
 * Choices made on the admin Leagues page, one entry per league. Stored as JSON in the
 * settings table. Nothing here deletes a pick: hiding and resetting only change what the
 * Dashboard counts.
 */
export interface LeaguePref {
  /** Left out of the Dashboard (its list and its headline figures). */
  hidden?: boolean;
  /** ISO time of the last reset: only alerts that arrived at or after it are counted. */
  resetAt?: string;
  countryOverride?: string;
  tierOverride?: number;
}
interface LeaguePrefs {
  leagues: Record<string, LeaguePref>;
}
const LEAGUE_PREFS_KEY = "league_prefs";

export interface LeaguePatch {
  hidden?: boolean;
  /** true = start counting again from now; false = undo a reset. */
  reset?: boolean;
  /** Empty or null clears the override. */
  country?: string | null;
  /** 1-9, or null to clear the override. */
  tier?: number | null;
}

/** One league as the admin Leagues page shows it. */
export interface AdminLeagueRow {
  key: string;
  league: string;
  country: string | null;
  /** What the Dashboard currently counts (alerts since the last reset). */
  alerts: number;
  hits: number;
  misses: number;
  /** Alerts from before the last reset. Still stored, just not counted. */
  earlierAlerts: number;
  lastAlertAt: string;
  hidden: boolean;
  resetAt: string | null;
  countryOverride: string | null;
  tierOverride: number | null;
}

function leagueKeyPart(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

/** Who a pick's league is: the same league gets the same key however many alerts it has. */
function leagueIdentity(competition: string | null, country: string | null): { key: string; league: string; country: string | null } {
  const cleaned = (competition ?? "").replace(/[\u{E0020}-\u{E007F}]/gu, "").trim();
  const league = stripCountryPrefix(cleaned, country) || "Unknown league";
  return { key: `${leagueKeyPart(country ?? "")}|${leagueKeyPart(league)}`, league, country };
}

/** Strategy merges chosen on the admin Strategies page: lower-case strategy name -> the name it is reported under. */
const STRATEGY_MERGES_KEY = "strategy_merges";
/** Strategies whose new alerts are ignored on arrival: lower-case name -> the name as first written. */
const IGNORED_STRATEGIES_KEY = "ignored_strategies";

/** One strategy as the admin Strategies page shows it. */
/**
 * Live or simulation. A pick is LIVE when it was actually handed to the bet feed (it has a sent time), and a
 * SIMULATION pick otherwise: the alert was recorded and settled exactly the same way, but no bet was placed.
 * It is decided per pick, not by a strategy's switch today, so switching a strategy to Live never rewrites
 * its history. "all" means both.
 */
export type PickMode = "live" | "sim" | "all";

export function parsePickMode(v: unknown): PickMode {
  return v === "live" || v === "sim" ? v : "all";
}

/** SQL condition for a mode, to add to a WHERE clause on live_picks. */
function modeSql(mode: PickMode): string {
  return mode === "live" ? " AND sent_at IS NOT NULL" : mode === "sim" ? " AND sent_at IS NULL" : "";
}

function parseSimRow(raw: string | null): SimRecord | null {
  if (!raw) return null;
  try {
    const s = JSON.parse(raw) as Partial<SimRecord>;
    const stake = typeof s.stake === "number" && s.stake > 0 ? s.stake : null;
    const minPrice = typeof s.minPrice === "number" && s.minPrice > 1 ? s.minPrice : null;
    const skipped = typeof s.skipped === "string" && s.skipped ? s.skipped : null;
    return { stake, minPrice, skipped: skipped ?? (stake === null ? "No stake set" : null) };
  } catch {
    return null;
  }
}

export interface AdminStrategyRow {
  label: string;
  market: string | null;
  /** Hits and misses since the "fresh start" date, split into picks that were sent (live) and not (simulation). */
  liveHits: number;
  liveMisses: number;
  simHits: number;
  simMisses: number;
  /** Every stored pick of this strategy, including ones marked "didn't actually bet". Used for the delete messages. */
  alerts: number;
  /** Stored picks since the "fresh start" date (all of them when there is none). */
  alertsSince: number;
  /** Hits and misses since the "fresh start" date. */
  hits: number;
  misses: number;
  /** Picks already handed to the bet feed. They are kept if the strategy is deleted. */
  sent: number;
  lastAlertAt: string;
  /** The strategy this one is reported under on the Dashboard, or null if it stands alone. */
  mergedInto: string | null;
}

/**
 * Totals for one league / strategy / minute-bucket combination, for the Dashboard's breakdown.
 * Counts only: no timestamps, ids or individual alerts, the same as the other stats.
 */
export interface PerformanceCell {
  /** Identifies the league for the admin Leagues page. */
  leagueKey: string;
  league: string;
  country: string | null;
  /** Set on the admin Leagues page; replaces the built-in country / tier for this league. */
  countryOverride: string | null;
  tierOverride: number | null;
  strategy: string;
  /** Index into MINUTE_BUCKETS (0 = 1-15', 5 = 76'+), or null when the alert had no minute. */
  bucket: number | null;
  alerts: number;
  hits: number;
  misses: number;
}

function stripCountryPrefix(league: string, country: string | null): string {
  if (!country) return league;
  const prefix = `${country.toLowerCase()} `;
  return league.toLowerCase().startsWith(prefix) && league.length > prefix.length ? league.slice(prefix.length).trim() : league;
}

/** What the Live tab reads. One per Telegram alert. */
export interface LivePick {
  id: number;
  chatId: string;
  messageId: number;
  firstSeenAt: string;
  /** When Telegram says the alert was posted. Null for alerts stored before this was recorded. */
  messageAt: string | null;
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
  /** The result in force: your amendment if there is one, otherwise the alert's own Hit/Miss. */
  result: "hit" | "miss" | null;
  /** True when the result was set by hand on the Results admin page. */
  resultOverridden: boolean;
  /** True when marked "didn't actually bet" — left out of every count, kept in the raw Picks log. */
  excluded: boolean;
  /** What the alert itself said, kept even when amended. */
  originalResult: "hit" | "miss" | null;
  /** captured = live and unsettled; settled = has a result; unmapped/flagged = must not be sent to bet. */
  status: "captured" | "settled" | "unmapped" | "flagged";
  sendable: boolean;
  /** When the pick was first handed to the bet feed, or null if it never has been. */
  sentAt: string | null;
  /** The exact feed row (as JSON) that was handed over, kept so later polls repeat it unchanged. */
  sentRowJson: string | null;
  flags: string[];
  /** The full parsed alert (all stats, odds, etc.) for the detail view. */
  detail: ParsedAlert | null;
  rawText: string;
}

/** One bet from the betting software's bet history, as imported. */
export interface BetfairBet {
  betId: string;
  placedAt: string | null;
  settledAt: string | null;
  event: string;
  market: string | null;
  selection: string | null;
  /** "back" or "lay" when the export says. */
  side: string | null;
  /** The tipster / provider column, when the export has one (the bet feed's Provider is the strategy). */
  provider: string | null;
  /**
   * won / lost = settled; matched = matched but not settled yet; pending = placed, waiting to be matched;
   * unmatched = nothing matched (lapsed, cancelled); void = voided or refunded. matched and pending only come from
   * Betfair's own API (the bet history export lists settled bets).
   */
  status: "won" | "lost" | "matched" | "pending" | "unmatched" | "void";
  /** Stake asked for. */
  stake: number | null;
  /** Stake actually matched. */
  matched: number | null;
  /** Average price matched. */
  odds: number | null;
  /** Profit or loss on the bet in £, as the export gives it. */
  profit: number | null;
}

/** One website user as stored. pages is the raw JSON text; server/users.ts parses and checks it. */
export interface AppUserRow {
  id: number;
  email: string;
  name: string;
  passwordHash: string;
  pages: string;
  active: boolean;
  sessionVersion: number;
  createdAt: string;
  lastLoginAt: string | null;
}

export class EngineDb {
  private readonly db: Database.Database;
  private readonly onChange: () => void;

  constructor(path: string, onChange: () => void) {
    mkdirSync(dirname(path), { recursive: true });
    this.db = new Database(path);
    this.onChange = onChange;
    // WAL lets reads carry on while a write or a backup snapshot is in progress.
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("synchronous = NORMAL");
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

      CREATE TABLE IF NOT EXISTS settings (
        key    TEXT PRIMARY KEY,
        value  TEXT NOT NULL
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

      -- Alerts deleted with a strategy. Telegram still holds those messages, so without this note the
      -- catch-up sync (or a full-time edit) would put them straight back.
      CREATE TABLE IF NOT EXISTS deleted_picks (
        chat_id     TEXT NOT NULL,
        message_id  INTEGER NOT NULL,
        deleted_at  TEXT NOT NULL,
        PRIMARY KEY (chat_id, message_id)
      );

      CREATE TABLE IF NOT EXISTS schedule_fixtures (
        uk_date      TEXT NOT NULL,
        fixture_id   INTEGER NOT NULL,
        kickoff      TEXT NOT NULL,
        kickoff_ts   INTEGER NOT NULL,
        status       TEXT NOT NULL,
        status_long  TEXT NOT NULL,
        league_id    INTEGER NOT NULL,
        league       TEXT NOT NULL,
        country      TEXT NOT NULL,
        round        TEXT,
        home         TEXT NOT NULL,
        away         TEXT NOT NULL,
        venue        TEXT,
        pulled_at    TEXT NOT NULL,
        PRIMARY KEY (uk_date, fixture_id)
      );

      -- Real bets from the betting software's bet history export (see betfair/reconcile.ts).
      CREATE TABLE IF NOT EXISTS betfair_bets (
        bet_id        TEXT PRIMARY KEY,
        placed_at     TEXT,
        settled_at    TEXT,
        event         TEXT NOT NULL,
        market        TEXT,
        selection     TEXT,
        side          TEXT,
        provider      TEXT,
        status        TEXT NOT NULL,
        stake         REAL,
        matched       REAL,
        odds          REAL,
        profit        REAL,
        pick_id       INTEGER,
        imported_at   TEXT NOT NULL
      );

      -- Website users who signed up. Passwords are stored only as salted scrypt hashes.
      -- pages is a JSON list of the page groups the admin has switched on for this person.
      CREATE TABLE IF NOT EXISTS app_users (
        id               INTEGER PRIMARY KEY AUTOINCREMENT,
        email            TEXT NOT NULL UNIQUE COLLATE NOCASE,
        name             TEXT NOT NULL DEFAULT '',
        password_hash    TEXT NOT NULL,
        pages            TEXT NOT NULL DEFAULT '[]',
        active           INTEGER NOT NULL DEFAULT 1,
        session_version  INTEGER NOT NULL DEFAULT 1,
        created_at       TEXT NOT NULL,
        last_login_at    TEXT
      );

    `);

    // Databases created before the bet feed existed don't have sent_at yet.
    const liveCols = this.db.prepare(`PRAGMA table_info(live_picks)`).all() as Array<{ name: string }>;
    if (!liveCols.some((c) => c.name === "sent_at")) {
      this.db.exec(`ALTER TABLE live_picks ADD COLUMN sent_at TEXT`);
    }
    if (!liveCols.some((c) => c.name === "excluded")) {
      this.db.exec(`ALTER TABLE live_picks ADD COLUMN excluded INTEGER NOT NULL DEFAULT 0`);
    }
    if (!liveCols.some((c) => c.name === "result_override")) {
      this.db.exec(`ALTER TABLE live_picks ADD COLUMN result_override TEXT`);
      this.db.exec(`ALTER TABLE live_picks ADD COLUMN result_override_at TEXT`);
    }
    if (!liveCols.some((c) => c.name === "sent_row")) {
      this.db.exec(`ALTER TABLE live_picks ADD COLUMN sent_row TEXT`);
    }
    if (!liveCols.some((c) => c.name === "sim_row")) {
      // The simulated bet recorded when a pick that isn't sent arrives (see recordSimBets in bet-feed.ts).
      this.db.exec(`ALTER TABLE live_picks ADD COLUMN sim_row TEXT`);
      this.db.exec(`ALTER TABLE live_picks ADD COLUMN sim_at TEXT`);
    }
    if (!liveCols.some((c) => c.name === "message_at")) {
      // Telegram's own posting time. The bet feed's age check uses it, so an alert delivered late is never treated as fresh.
      this.db.exec(`ALTER TABLE live_picks ADD COLUMN message_at TEXT`);
    }
    if (!liveCols.some((c) => c.name === "country")) {
      // The league's country, read from the flag once when the alert is stored, instead of on every stats request.
      this.db.exec(`ALTER TABLE live_picks ADD COLUMN country TEXT`);
      const rows = this.db.prepare(`SELECT id, raw_text FROM live_picks`).all() as Array<{ id: number; raw_text: string }>;
      const upd = this.db.prepare(`UPDATE live_picks SET country = ? WHERE id = ?`);
      this.db.transaction(() => {
        for (const r of rows) upd.run(leagueCountryFromText(r.raw_text), r.id);
      })();
    }
    const betCols = this.db.prepare(`PRAGMA table_info(betfair_bets)`).all() as Array<{ name: string }>;
    if (!betCols.some((c) => c.name === "acknowledged_at")) {
      // Set when the admin marks an unlinked bet as known (not from the feed), so the list shows only new ones.
      this.db.exec(`ALTER TABLE betfair_bets ADD COLUMN acknowledged_at TEXT`);
    }
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_live_picks_first_seen ON live_picks (first_seen_at);
      CREATE INDEX IF NOT EXISTS idx_live_picks_sent_at ON live_picks (sent_at);
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
  /**
   * Stores or updates one alert. `messageAt` is Telegram's posting time (ISO); it is kept from the first
   * time the alert is seen, so later edits and re-syncs can't make an old alert look new.
   */
  upsertLivePick(
    chatId: string,
    messageId: number,
    rawText: string,
    parsed: ParsedAlert,
    messageAt: string | null = null,
    /** When a new pick counts as first seen. Defaults to now; the catch-up sync passes the posting time. Never changes an existing pick. */
    firstSeenAt?: string,
  ): "inserted" | "updated" {
    const now = new Date().toISOString();
    const seen = firstSeenAt && firstSeenAt < now ? firstSeenAt : now;
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
           status, sendable, flags_json, parsed_json, raw_text, message_at, country
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
           raw_text    = excluded.raw_text,
           message_at  = COALESCE(live_picks.message_at, excluded.message_at),
           country     = excluded.country`,
      )
      .run(
        chatId,
        messageId,
        seen,
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
        messageAt,
        leagueCountryFromText(rawText),
      );

    this.onChange();
    return existing ? "updated" : "inserted";
  }

  /**
   * Every strategy with stored picks, with its market, ignoring the Leagues page's hide/reset
   * choices. The Sending page uses this, so a strategy whose alerts all come from hidden leagues
   * still appears there and can be switched off.
   */
  listStrategiesSeen(): Array<{ label: string; market: string | null }> {
    const rows = this.db
      .prepare(`SELECT strategy, market FROM live_picks WHERE excluded = 0 GROUP BY strategy, market`)
      .all() as Array<{ strategy: string; market: string | null }>;
    const out = new Map<string, { label: string; market: string | null }>();
    for (const r of rows) {
      const label = strategyLabel(r.strategy);
      const cur = out.get(label.toLowerCase());
      if (!cur || (cur.market === null && r.market !== null)) out.set(label.toLowerCase(), { label, market: r.market });
    }
    return [...out.values()].sort((a, b) => a.label.localeCompare(b.label));
  }

  /** UK days that have stored picks, newest first, with how many each and how they went. For the Results page's date picker. */
  listPickDays(limit = 400): Array<{ date: string; picks: number; hits: number; misses: number }> {
    const rows = this.db
      .prepare(`SELECT first_seen_at, excluded, COALESCE(result_override, result) AS result FROM live_picks`)
      .all() as Array<{ first_seen_at: string; excluded: number; result: string | null }>;
    const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" });
    const days = new Map<string, { date: string; picks: number; hits: number; misses: number }>();
    for (const r of rows) {
      const date = fmt.format(new Date(r.first_seen_at));
      const d = days.get(date) ?? { date, picks: 0, hits: 0, misses: 0 };
      d.picks++;
      if (r.excluded !== 1) {
        if (r.result === "hit") d.hits++;
        else if (r.result === "miss") d.misses++;
      }
      days.set(date, d);
    }
    return [...days.values()].sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, limit);
  }

  /** True if this Telegram message was deleted along with its strategy, so it must never be stored again. */
  isPickDeleted(chatId: string, messageId: number): boolean {
    return this.db.prepare(`SELECT 1 FROM deleted_picks WHERE chat_id = ? AND message_id = ?`).get(chatId, messageId) !== undefined;
  }

  /** The stored text of one alert, or null if it isn't stored yet. */
  getLivePickText(chatId: string, messageId: number): string | null {
    const row = this.db
      .prepare(`SELECT raw_text FROM live_picks WHERE chat_id = ? AND message_id = ?`)
      .get(chatId, messageId) as { raw_text: string } | undefined;
    return row ? row.raw_text : null;
  }

  countLivePicks(): number {
    const row = this.db.prepare(`SELECT COUNT(*) AS n FROM live_picks`).get() as { n: number };
    return row.n;
  }

  /** Most recent alerts, newest first. For the Live tab. */
  /**
   * Newest first. With `range`, only picks first seen in [from, to) (ISO strings), and a higher cap so a
   * whole busy day fits; without it, the latest `limit` picks (at most 200).
   */
  listLivePicks(limit = 50, range?: { from: string; to: string }): LivePick[] {
    const capped = Math.min(Math.max(limit, 1), range ? 1000 : 200);
    const rows = (
      range
        ? this.db
            .prepare(`SELECT * FROM live_picks WHERE first_seen_at >= ? AND first_seen_at < ? ORDER BY id DESC LIMIT ?`)
            .all(range.from, range.to, capped)
        : this.db.prepare(`SELECT * FROM live_picks ORDER BY id DESC LIMIT ?`).all(capped)
    ) as Array<Record<string, unknown>>;

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
        messageAt: (r.message_at as string | null) ?? null,
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
        result: ((r.result_override as "hit" | "miss" | null) ?? (r.result as "hit" | "miss" | null)) ?? null,
        resultOverridden: r.result_override !== null && r.result_override !== undefined,
        excluded: Number(r.excluded) === 1,
        originalResult: (r.result as "hit" | "miss" | null) ?? null,
        // A hand-set result settles the pick, so it can never be sent afterwards.
        status: (r.result_override ? "settled" : r.status) as LivePick["status"],
        sendable: Number(r.sendable) === 1,
        sentAt: (r.sent_at as string | null) ?? null,
        sentRowJson: (r.sent_row as string | null) ?? null,
        flags,
        detail,
        rawText: String(r.raw_text),
      };
    });
  }

  /**
   * The picks the Dashboard's figures count over the last `days` days: not excluded, in the mode, with hidden or reset
   * leagues left out and, optionally, only one strategy (as reported, after merges).
   */
  private statsRows(days: number | null, strategy: string | null, mode: PickMode) {
    const since = this.floorSince(days === null ? null : new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString());
    const allRows = (
      since === null
        ? this.db.prepare(`SELECT id, first_seen_at, strategy, market, competition, minute, country,
                  COALESCE(result_override, result) AS result,
                  CASE WHEN result_override IS NOT NULL THEN 'settled' ELSE status END AS status
           FROM live_picks WHERE excluded = 0${modeSql(mode)} ORDER BY id`).all()
        : this.db
            .prepare(
              `SELECT id, first_seen_at, strategy, market, competition, minute, country,
                      COALESCE(result_override, result) AS result,
                      CASE WHEN result_override IS NOT NULL THEN 'settled' ELSE status END AS status
               FROM live_picks WHERE first_seen_at >= ? AND excluded = 0${modeSql(mode)} ORDER BY id`,
            )
            .all(since)
    ) as Array<{
      id: number;
      first_seen_at: string;
      strategy: string;
      market: string | null;
      competition: string | null;
      minute: number | null;
      country: string | null;
      result: string | null;
      status: string;
    }>;
    // Leagues hidden or reset on the admin Leagues page leave the headline figures too.
    const visibleRows = this.applyLeaguePrefs(allRows);
    // Optional: only one strategy (matched on its name without any bracketed note).
    const merges = this.readStrategyMerges();
    const wanted = strategy?.trim().toLowerCase() || null;
    const rows = wanted ? visibleRows.filter((r) => reportLabel(merges, r.strategy).toLowerCase() === wanted) : visibleRows;
    return rows;
  }

  /** Ids of the settled picks hitRateStats counts as hits and misses, so other figures can use exactly the same picks. */
  statsSettledIds(days: number | null, strategy: string | null = null, mode: PickMode = "all"): Set<number> {
    return new Set(this.statsRows(days, strategy, mode).filter((r) => r.result === "hit" || r.result === "miss").map((r) => r.id));
  }

  /**
   * Hit-rate figures over the last `days` days (null = all time), by strategy,
   * league and UK calendar day. A pick counts as a hit or miss only when the
   * alert itself carries a Hit/Miss marker, so nothing here is guessed.
   */
  hitRateStats(days: number | null, strategy: string | null = null, mode: PickMode = "all"): HitRateStats {
    const rows = this.statsRows(days, strategy, mode);
    const merges = this.readStrategyMerges();

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

      const sLabel = reportLabel(merges, r.strategy);
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

  /**
   * Totals over the last `days` days (null = all time), grouped by league, strategy and
   * alert-minute bucket, for the Dashboard's breakdown. Uses the same rules as hitRateStats:
   * picks marked "didn't actually bet" are left out, and an amended result wins over the
   * parsed one. The country is read from the flag in the stored alert text, so alerts saved
   * before the parser knew about countries are covered too.
   */
  performanceCells(days: number | null, mode: PickMode = "all"): PerformanceCell[] {
    const since = this.floorSince(days === null ? null : new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString());
    const cols = `first_seen_at, strategy, competition, minute, COALESCE(result_override, result) AS result, country`;
    const rows = (
      since === null
        ? this.db.prepare(`SELECT ${cols} FROM live_picks WHERE excluded = 0${modeSql(mode)}`).all()
        : this.db.prepare(`SELECT ${cols} FROM live_picks WHERE first_seen_at >= ? AND excluded = 0${modeSql(mode)}`).all(since)
    ) as Array<{
      first_seen_at: string;
      strategy: string;
      competition: string | null;
      minute: number | null;
      result: string | null;
      country: string | null;
    }>;

    const prefs = this.readLeaguePrefs().leagues;
    const merges = this.readStrategyMerges();
    const cells = new Map<string, PerformanceCell>();
    for (const r of rows) {
      const id = leagueIdentity(r.competition, r.country);
      const pref = prefs[id.key];
      if (pref?.hidden) continue;
      if (pref?.resetAt && r.first_seen_at < pref.resetAt) continue;

      const strategy = reportLabel(merges, r.strategy);
      const bucket = r.minute === null ? null : MINUTE_BUCKETS.findIndex((b) => r.minute! <= b.max);
      const bucketIdx = bucket !== null && bucket >= 0 ? bucket : null;

      const key = `${id.key}|${strategy}|${bucketIdx ?? ""}`;
      const cell =
        cells.get(key) ??
        {
          leagueKey: id.key,
          league: id.league,
          country: id.country,
          countryOverride: pref?.countryOverride ?? null,
          tierOverride: pref?.tierOverride ?? null,
          strategy,
          bucket: bucketIdx,
          alerts: 0,
          hits: 0,
          misses: 0,
        };
      cell.alerts++;
      if (r.result === "hit") cell.hits++;
      else if (r.result === "miss") cell.misses++;
      cells.set(key, cell);
    }
    return [...cells.values()];
  }

  private readLeaguePrefs(): LeaguePrefs {
    try {
      const raw = this.getSetting(LEAGUE_PREFS_KEY);
      const parsed = raw ? (JSON.parse(raw) as Partial<LeaguePrefs>) : null;
      if (parsed && typeof parsed === "object" && parsed.leagues && typeof parsed.leagues === "object") {
        return { leagues: parsed.leagues };
      }
    } catch {
      // Unreadable setting: behave as if nothing was ever hidden or reset.
    }
    return { leagues: {} };
  }

  /** Drops picks from leagues that are hidden, or from before that league's last reset. */
  private applyLeaguePrefs<T extends { first_seen_at: string; competition: string | null; country: string | null }>(rows: T[]): T[] {
    const prefs = this.readLeaguePrefs().leagues;
    if (!Object.values(prefs).some((p) => p.hidden || p.resetAt)) return rows;
    return rows.filter((r) => {
      const pref = prefs[leagueIdentity(r.competition, r.country).key];
      if (!pref) return true;
      if (pref.hidden) return false;
      if (pref.resetAt && r.first_seen_at < pref.resetAt) return false;
      return true;
    });
  }

  /** Every league with stored picks, for the admin Leagues page. Hidden leagues are included. */
  listLeaguesForAdmin(): AdminLeagueRow[] {
    const prefs = this.readLeaguePrefs().leagues;
    const rows = this.db
      .prepare(
        `SELECT first_seen_at, competition, COALESCE(result_override, result) AS result, country
         FROM live_picks WHERE excluded = 0`,
      )
      .all() as Array<{ first_seen_at: string; competition: string | null; result: string | null; country: string | null }>;

    const out = new Map<string, AdminLeagueRow>();
    for (const r of rows) {
      const id = leagueIdentity(r.competition, r.country);
      const pref = prefs[id.key];
      const row =
        out.get(id.key) ??
        {
          key: id.key,
          league: id.league,
          country: id.country,
          alerts: 0,
          hits: 0,
          misses: 0,
          earlierAlerts: 0,
          lastAlertAt: r.first_seen_at,
          hidden: pref?.hidden === true,
          resetAt: pref?.resetAt ?? null,
          countryOverride: pref?.countryOverride ?? null,
          tierOverride: pref?.tierOverride ?? null,
        };
      if (pref?.resetAt && r.first_seen_at < pref.resetAt) {
        row.earlierAlerts++;
      } else {
        row.alerts++;
        if (r.result === "hit") row.hits++;
        else if (r.result === "miss") row.misses++;
      }
      if (r.first_seen_at > row.lastAlertAt) row.lastAlertAt = r.first_seen_at;
      out.set(id.key, row);
    }
    return [...out.values()].sort(
      (a, b) => b.hits + b.misses - (a.hits + a.misses) || b.alerts - a.alerts || a.league.localeCompare(b.league),
    );
  }

  /** Saves a change made on the admin Leagues page. Never deletes any picks. */
  updateLeague(key: string, patch: LeaguePatch): void {
    const prefs = this.readLeaguePrefs();
    const cur: LeaguePref = { ...(prefs.leagues[key] ?? {}) };
    if (patch.hidden !== undefined) {
      if (patch.hidden) cur.hidden = true;
      else delete cur.hidden;
    }
    if (patch.reset === true) cur.resetAt = new Date().toISOString();
    else if (patch.reset === false) delete cur.resetAt;
    if (patch.country !== undefined) {
      const country = patch.country?.trim();
      if (country) cur.countryOverride = country.slice(0, 60);
      else delete cur.countryOverride;
    }
    if (patch.tier !== undefined) {
      if (patch.tier !== null && Number.isInteger(patch.tier) && patch.tier >= 1 && patch.tier <= 9) cur.tierOverride = patch.tier;
      else delete cur.tierOverride;
    }
    if (Object.keys(cur).length === 0) delete prefs.leagues[key];
    else prefs.leagues[key] = cur;
    this.setSetting(LEAGUE_PREFS_KEY, JSON.stringify(prefs));
  }

  private readStrategyMerges(): Record<string, string> {
    try {
      const raw = this.getSetting(STRATEGY_MERGES_KEY);
      const parsed = raw ? (JSON.parse(raw) as unknown) : null;
      if (parsed && typeof parsed === "object") {
        const out: Record<string, string> = {};
        for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) if (typeof v === "string" && v) out[k] = v;
        return out;
      }
    } catch {
      // Unreadable setting: behave as if nothing was merged.
    }
    return {};
  }

  /** The strategy merges chosen on the Strategies page: lower-case strategy name -> the name it is reported under. */
  getStrategyMerges(): Record<string, string> {
    return this.readStrategyMerges();
  }

  /**
   * Reports strategy `from` under the name of strategy `into` (null undoes it). This only changes how
   * the Dashboard and stats group alerts. The bet feed, stakes and switches are untouched, so each
   * strategy keeps its own switch and stake.
   */
  setStrategyMerge(from: string, into: string | null): { ok: true } | { ok: false; error: string } {
    const seen = new Map(this.listStrategiesSeen().map((x) => [x.label.toLowerCase(), x.label]));
    const fromLabel = seen.get(strategyLabel(from).toLowerCase());
    if (!fromLabel) return { ok: false, error: "That strategy isn't known." };
    const merges = this.readStrategyMerges();
    const fromKey = fromLabel.toLowerCase();

    if (into === null) {
      delete merges[fromKey];
    } else {
      const intoLabel = seen.get(strategyLabel(into).toLowerCase());
      if (!intoLabel) return { ok: false, error: "The strategy to merge into isn't known." };
      if (intoLabel.toLowerCase() === fromKey) return { ok: false, error: "A strategy can't be merged into itself." };
      // Follow any existing merge so everything ends up under one final name.
      let target = intoLabel;
      for (let hops = 0; merges[target.toLowerCase()] && hops < 10; hops++) target = merges[target.toLowerCase()]!;
      if (target.toLowerCase() === fromKey) return { ok: false, error: "That would merge the two into each other." };
      merges[fromKey] = target;
      // Anything that was merged into `from` now follows it to the new name.
      for (const [k, v] of Object.entries(merges)) if (v.toLowerCase() === fromKey) merges[k] = target;
    }
    this.setSetting(STRATEGY_MERGES_KEY, JSON.stringify(merges));
    return { ok: true };
  }

  /** Strategies whose new alerts are dropped on arrival (lower-case name -> display name). */
  getIgnoredStrategies(): Record<string, string> {
    try {
      const raw = this.getSetting(IGNORED_STRATEGIES_KEY);
      const parsed = raw ? (JSON.parse(raw) as unknown) : null;
      if (parsed && typeof parsed === "object") {
        const out: Record<string, string> = {};
        for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) if (typeof v === "string" && v) out[k] = v;
        return out;
      }
    } catch {
      // Unreadable setting: nothing is ignored.
    }
    return {};
  }

  isStrategyIgnored(rawStrategy: string): boolean {
    return strategyLabel(rawStrategy).toLowerCase() in this.getIgnoredStrategies();
  }

  /** Starts or stops ignoring new alerts of a strategy. Stored alerts are not touched. */
  setStrategyIgnored(label: string, ignored: boolean): void {
    const clean = strategyLabel(label);
    const map = this.getIgnoredStrategies();
    if (ignored) map[clean.toLowerCase()] = clean;
    else delete map[clean.toLowerCase()];
    this.setSetting(IGNORED_STRATEGIES_KEY, JSON.stringify(map));
  }

  /**
   * Takes a strategy's picks that were already sent to bet out of every result and figure (Dashboard,
   * Trade Log, Win/Loss) once they're older than `olderThanIso`. The pick is kept as a record, only marked
   * "removed from results", so it can be put back from the Results page. Recent ones are left alone so a
   * row the betting software may still be reading never changes. Returns how many were taken out.
   */
  excludeSentPicks(label: string, olderThanIso: string): number {
    const target = strategyLabel(label).toLowerCase();
    const rows = this.db
      .prepare(`SELECT id, strategy FROM live_picks WHERE sent_at IS NOT NULL AND sent_at < ? AND excluded = 0`)
      .all(olderThanIso) as Array<{ id: number; strategy: string }>;
    const ids = rows.filter((r) => strategyLabel(r.strategy).toLowerCase() === target).map((r) => r.id);
    const upd = this.db.prepare(`UPDATE live_picks SET excluded = 1 WHERE id = ?`);
    this.db.transaction(() => {
      for (const id of ids) upd.run(id);
    })();
    if (ids.length > 0) this.onChange();
    return ids.length;
  }

  /**
   * Permanently deletes a strategy's picks that were sent to bet before `beforeIso`, so the strategy disappears
   * completely. Picks sent since then are left alone: they still count towards today's daily limit and the bet
   * feed may still be repeating them. Each one is noted so the catch-up sync can't bring it back.
   * Returns how many were deleted.
   */
  removeSentRecords(label: string, beforeIso: string): number {
    const target = strategyLabel(label).toLowerCase();
    const rows = this.db
      .prepare(`SELECT id, strategy, chat_id, message_id FROM live_picks WHERE sent_at IS NOT NULL AND sent_at < ?`)
      .all(beforeIso) as Array<{ id: number; strategy: string; chat_id: string; message_id: number }>;
    const mine = rows.filter((r) => strategyLabel(r.strategy).toLowerCase() === target);
    const del = this.db.prepare(`DELETE FROM live_picks WHERE id = ?`);
    const note = this.db.prepare(`INSERT OR REPLACE INTO deleted_picks (chat_id, message_id, deleted_at) VALUES (?, ?, ?)`);
    const now = new Date().toISOString();
    this.db.transaction(() => {
      for (const r of mine) {
        note.run(r.chat_id, r.message_id, now);
        del.run(r.id);
      }
    })();
    if (mine.length > 0) this.onChange();
    return mine.length;
  }

  /** Forgets every merge that involves a strategy (used when it is deleted). */
  forgetStrategyMerges(label: string): void {
    const key = strategyLabel(label).toLowerCase();
    const merges = this.readStrategyMerges();
    let changed = false;
    for (const [k, v] of Object.entries(merges)) {
      if (k === key || v.toLowerCase() === key) {
        delete merges[k];
        changed = true;
      }
    }
    if (changed) this.setSetting(STRATEGY_MERGES_KEY, JSON.stringify(merges));
  }

  /** Every strategy with stored picks, for the admin Strategies page. Ignores the Leagues page's choices. */
  listStrategiesForAdmin(): AdminStrategyRow[] {
    const merges = this.readStrategyMerges();
    const floor = this.getFreshStart();
    const rows = this.db
      .prepare(
        `SELECT strategy, market, excluded, sent_at, first_seen_at, COALESCE(result_override, result) AS result
         FROM live_picks ORDER BY id`,
      )
      .all() as Array<{ strategy: string; market: string | null; excluded: number; sent_at: string | null; first_seen_at: string; result: string | null }>;
    const out = new Map<string, AdminStrategyRow>();
    for (const r of rows) {
      const label = strategyLabel(r.strategy);
      const key = label.toLowerCase();
      const row =
        out.get(key) ??
        {
          label,
          market: r.market,
          alerts: 0,
          alertsSince: 0,
          hits: 0,
          misses: 0,
          liveHits: 0,
          liveMisses: 0,
          simHits: 0,
          simMisses: 0,
          sent: 0,
          lastAlertAt: r.first_seen_at,
          mergedInto: merges[key] ?? null,
        };
      row.alerts++;
      row.market = r.market ?? row.market;
      if (r.sent_at !== null) row.sent++;
      if (floor === null || r.first_seen_at >= floor) {
        row.alertsSince++;
        if (r.excluded !== 1) {
          const live = r.sent_at !== null;
          if (r.result === "hit") {
            row.hits++;
            if (live) row.liveHits++;
            else row.simHits++;
          } else if (r.result === "miss") {
            row.misses++;
            if (live) row.liveMisses++;
            else row.simMisses++;
          }
        }
      }
      row.lastAlertAt = r.first_seen_at;
      out.set(key, row);
    }
    return [...out.values()].sort((a, b) => a.label.localeCompare(b.label));
  }

  /**
   * Deletes the stored picks of one strategy (matched on its name without any
   * bracketed note). Picks that were already handed to the bet feed are kept,
   * as the record of what was sent. The raw capture log is never touched.
   */
  removeStrategyPicks(label: string): { removed: number; keptBecauseSent: number } {
    const target = label.trim().toLowerCase();
    const rows = this.db.prepare(`SELECT id, strategy, sent_at, chat_id, message_id FROM live_picks`).all() as Array<{
      id: number;
      strategy: string;
      sent_at: string | null;
      chat_id: string;
      message_id: number;
    }>;
    const mine = rows.filter((r) => strategyLabel(r.strategy).toLowerCase() === target);
    const deletable = mine.filter((r) => r.sent_at === null);
    const del = this.db.prepare(`DELETE FROM live_picks WHERE id = ?`);
    const note = this.db.prepare(`INSERT OR REPLACE INTO deleted_picks (chat_id, message_id, deleted_at) VALUES (?, ?, ?)`);
    const now = new Date().toISOString();
    this.db.transaction(() => {
      for (const r of deletable) {
        note.run(r.chat_id, r.message_id, now);
        del.run(r.id);
      }
      // Telegram only ever re-delivers recent messages, so old notes can go.
      this.db.prepare(`DELETE FROM deleted_picks WHERE deleted_at < ?`).run(new Date(Date.now() - 60 * 24 * 3_600_000).toISOString());
    })();
    if (deletable.length > 0) this.onChange();
    return { removed: deletable.length, keptBecauseSent: mine.length - deletable.length };
  }

  /**
   * Sets (or, with null, clears) a hand-made result on one pick. The override
   * survives later edits of the alert, so InPlayGuru's own tick can't undo it.
   * Returns false if there is no such pick.
   */
  /** Marks (or unmarks) a pick as "didn't actually bet". Excluded picks are left out of stats and Win/Loss. */
  setPickExcluded(id: number, excluded: boolean): boolean {
    const info = this.db.prepare(`UPDATE live_picks SET excluded = ? WHERE id = ?`).run(excluded ? 1 : 0, id);
    if (info.changes > 0) this.onChange();
    return info.changes > 0;
  }

  setResultOverride(id: number, result: "hit" | "miss" | null): boolean {
    const info = this.db
      .prepare(`UPDATE live_picks SET result_override = ?, result_override_at = ? WHERE id = ?`)
      .run(result, result === null ? null : new Date().toISOString(), id);
    if (info.changes > 0) this.onChange();
    return info.changes > 0;
  }

  /**
   * Re-reads the stored text of every settled pick with the current parser and
   * updates its result. Run at start-up, so an improvement to how results are
   * worked out also corrects picks that were stored earlier. Hand-made
   * amendments are separate and are never touched. Returns how many results changed.
   */
  recomputeSettledResults(parse: (text: string) => ParsedAlert): number {
    const rows = this.db
      .prepare(`SELECT id, raw_text, result, market FROM live_picks WHERE ft_score IS NOT NULL`)
      .all() as Array<{ id: number; raw_text: string; result: string | null; market: string | null }>;
    const upd = this.db.prepare(`UPDATE live_picks SET result = ?, parsed_json = ? WHERE id = ?`);
    // When a rule change moves a strategy to a different bet type, the stored market and wording follow it.
    const updMarket = this.db.prepare(`UPDATE live_picks SET market = ?, selection = ? WHERE id = ?`);
    let changed = 0;
    for (const r of rows) {
      try {
        const p = parse(r.raw_text);
        upd.run(p.result, JSON.stringify(p), r.id);
        if ((p.market ?? null) !== (r.market ?? null)) updMarket.run(p.market, p.selection, r.id);
        if ((p.result ?? null) !== (r.result ?? null)) changed++;
      } catch {
        // leave this row as it was
      }
    }
    if (rows.length > 0) this.onChange();
    return changed;
  }

  /**
   * Settled picks (hit or miss, with any hand-made amendment applied) since a
   * date, with just what the Win/Loss figures need: the odds printed in the
   * alert, the line it was on, and the stake if it was actually sent.
   */
  listResultsForWinLoss(sinceIso: string): Array<{
    id: number;
    firstSeenAt: string;
    strategy: string;
    market: string | null;
    result: "hit" | "miss";
    targetLine: number | null;
    overLine: number | null;
    overOdds: number | null;
    /** For favourite-to-win picks: the favourite's live win price printed in the alert. */
    favouriteOdds: number | null;
    sentStake: number | null;
    /** True when the pick was handed to the bet feed (a live bet), false for a simulation pick. */
    sent: boolean;
    /** The simulated bet recorded when the pick arrived, or null (sent, or from before recording existed). */
    sim: SimRecord | null;
  }> {
    const rows = this.db
      .prepare(
        `SELECT id, first_seen_at, strategy, market, COALESCE(result_override, result) AS result, parsed_json, sent_row, sent_at, sim_row
         FROM live_picks
         WHERE first_seen_at >= ? AND excluded = 0 AND COALESCE(result_override, result) IN ('hit', 'miss')
         ORDER BY first_seen_at, id`,
      )
      .all(this.floorSince(sinceIso) ?? sinceIso) as Array<{
      id: number;
      first_seen_at: string;
      strategy: string;
      market: string | null;
      result: "hit" | "miss";
      parsed_json: string;
      sent_row: string | null;
      sent_at: string | null;
      sim_row: string | null;
    }>;

    return rows.map((r) => {
      let targetLine: number | null = null;
      let overLine: number | null = null;
      let overOdds: number | null = null;
      let favouriteOdds: number | null = null;
      try {
        const p = JSON.parse(r.parsed_json) as Partial<ParsedAlert>;
        targetLine = typeof p.targetLine === "number" ? p.targetLine : null;
        overLine = typeof p.odds?.overUnderLine === "number" ? p.odds.overUnderLine : null;
        overOdds = typeof p.odds?.over === "number" ? p.odds.over : null;
        const live = p.odds?.live1x2;
        if (p.favourite && Array.isArray(live)) {
          const price = p.favourite === "home" ? live[0] : live[2];
          favouriteOdds = typeof price === "number" && price > 1 ? price : null;
        }
      } catch {
        // leave as null
      }
      let sentStake: number | null = null;
      if (r.sent_row) {
        try {
          const s = JSON.parse(r.sent_row) as { stake?: unknown };
          sentStake = typeof s.stake === "number" && s.stake > 0 ? s.stake : null;
        } catch {
          // leave as null
        }
      }
      return {
        id: r.id,
        firstSeenAt: r.first_seen_at,
        strategy: r.strategy,
        market: r.market,
        result: r.result,
        targetLine,
        overLine,
        overOdds,
        favouriteOdds,
        sentStake,
        sent: r.sent_at !== null,
        sim: r.sent_at === null ? parseSimRow(r.sim_row) : null,
      };
    });
  }

  // ---- Betfair reconciliation ---------------------------------------------------------------

  /**
   * Adds bets, or merges new details into ones already stored (a bet moves from open to settled; the CSV and Betfair's own
   * API describe the same bet by the same id). A detail the new copy lacks keeps its stored value, so the API (which has
   * no tipster) never wipes what the CSV said. Only rows that actually change are written, so a poll that finds nothing
   * new doesn't mark the database as changed (which would start a backup upload every time).
   * Returns new bets, bets already known, and how many rows were written.
   */
  saveBetfairBets(bets: BetfairBet[], importedAt: string): { added: number; updated: number; changed: number } {
    const read = this.db.prepare(`SELECT * FROM betfair_bets WHERE bet_id = ?`);
    const upsert = this.db.prepare(
      `INSERT INTO betfair_bets (bet_id, placed_at, settled_at, event, market, selection, side, provider, status, stake, matched, odds, profit, imported_at)
       VALUES (@betId, @placedAt, @settledAt, @event, @market, @selection, @side, @provider, @status, @stake, @matched, @odds, @profit, @importedAt)
       ON CONFLICT(bet_id) DO UPDATE SET placed_at = excluded.placed_at, settled_at = excluded.settled_at, event = excluded.event,
         market = excluded.market, selection = excluded.selection, side = excluded.side, provider = excluded.provider,
         status = excluded.status, stake = excluded.stake, matched = excluded.matched, odds = excluded.odds, profit = excluded.profit,
         imported_at = excluded.imported_at`,
    );
    const FIELDS = ["placedAt", "settledAt", "event", "market", "selection", "side", "provider", "status", "stake", "matched", "odds", "profit"] as const;
    const COLUMN: Record<(typeof FIELDS)[number], string> = {
      placedAt: "placed_at", settledAt: "settled_at", event: "event", market: "market", selection: "selection", side: "side",
      provider: "provider", status: "status", stake: "stake", matched: "matched", odds: "odds", profit: "profit",
    };
    let added = 0;
    let updated = 0;
    let changed = 0;
    this.db.transaction(() => {
      for (const b of bets) {
        const row = read.get(b.betId) as Record<string, unknown> | undefined;
        if (!row) {
          added++;
          changed++;
          upsert.run({ ...b, importedAt });
          continue;
        }
        updated++;
        const merged: Record<string, unknown> = { betId: b.betId, importedAt };
        let differs = false;
        for (const f of FIELDS) {
          const old = row[COLUMN[f]] ?? null;
          let next: unknown = b[f] ?? old;
          // A stand-in name ("Market 1.234") never replaces a real one.
          if (f === "event" && typeof next === "string" && next.startsWith("Market ") && old) next = old;
          merged[f] = next;
          if (next !== old) differs = true;
        }
        if (differs) {
          changed++;
          upsert.run(merged);
        }
      }
    })();
    if (changed > 0) this.onChange();
    return { added, updated, changed };
  }

  listBetfairBets(): Array<BetfairBet & { pickId: number | null; importedAt: string; acknowledgedAt: string | null }> {
    const rows = this.db.prepare(`SELECT * FROM betfair_bets ORDER BY COALESCE(placed_at, settled_at), bet_id`).all() as Array<Record<string, unknown>>;
    const num = (v: unknown) => (typeof v === "number" ? v : null);
    const str = (v: unknown) => (typeof v === "string" ? v : null);
    return rows.map((r) => ({
      betId: String(r.bet_id),
      placedAt: str(r.placed_at),
      settledAt: str(r.settled_at),
      event: String(r.event),
      market: str(r.market),
      selection: str(r.selection),
      side: str(r.side),
      provider: str(r.provider),
      status: String(r.status) as BetfairBet["status"],
      stake: num(r.stake),
      matched: num(r.matched),
      odds: num(r.odds),
      profit: num(r.profit),
      pickId: num(r.pick_id),
      importedAt: String(r.imported_at),
      acknowledgedAt: str(r.acknowledged_at),
    }));
  }

  /** Marks unlinked bets as acknowledged (at = now) or puts them back (at = null). Re-importing never changes this. */
  acknowledgeBetfairBets(betIds: string[], at: string | null): number {
    const upd = this.db.prepare(`UPDATE betfair_bets SET acknowledged_at = ? WHERE bet_id = ? AND pick_id IS NULL`);
    let changed = 0;
    this.db.transaction(() => {
      for (const id of betIds) changed += upd.run(at, id).changes;
    })();
    if (changed > 0) this.onChange();
    return changed;
  }

  linkBetfairBets(links: Array<{ betId: string; pickId: number | null }>): void {
    const upd = this.db.prepare(`UPDATE betfair_bets SET pick_id = ? WHERE bet_id = ?`);
    this.db.transaction(() => {
      for (const l of links) upd.run(l.pickId, l.betId);
    })();
    if (links.length > 0) this.onChange();
  }

  /** Every pick ever handed to the bet feed, with the row it was sent as. */
  listSentPicks(): Array<{ id: number; strategy: string; sentAt: string; firstSeenAt: string; home: string | null; away: string | null; sentRow: { eventName?: string; selectionName?: string; provider?: string; stake?: number } | null }> {
    const rows = this.db
      .prepare(`SELECT id, strategy, sent_at, first_seen_at, home, away, sent_row FROM live_picks WHERE sent_at IS NOT NULL ORDER BY sent_at, id`)
      .all() as Array<{ id: number; strategy: string; sent_at: string; first_seen_at: string; home: string | null; away: string | null; sent_row: string | null }>;
    return rows.map((r) => {
      let sentRow = null;
      try {
        sentRow = r.sent_row ? (JSON.parse(r.sent_row) as { eventName?: string; selectionName?: string; provider?: string; stake?: number }) : null;
      } catch {
        // leave as null
      }
      return { id: r.id, strategy: r.strategy, sentAt: r.sent_at, firstSeenAt: r.first_seen_at, home: r.home, away: r.away, sentRow };
    });
  }

  // ---- website users -------------------------------------------------------------------------

  private toAppUser(r: Record<string, unknown>): AppUserRow {
    return {
      id: Number(r.id),
      email: String(r.email),
      name: String(r.name ?? ""),
      passwordHash: String(r.password_hash),
      pages: String(r.pages ?? "[]"),
      active: Number(r.active) === 1,
      sessionVersion: Number(r.session_version),
      createdAt: String(r.created_at),
      lastLoginAt: r.last_login_at === null || r.last_login_at === undefined ? null : String(r.last_login_at),
    };
  }

  /** Adds a user with no page access yet. Returns null when that email is already registered. */
  createAppUser(email: string, name: string, passwordHash: string): AppUserRow | null {
    try {
      const info = this.db
        .prepare(`INSERT INTO app_users (email, name, password_hash, created_at) VALUES (?, ?, ?, ?)`)
        .run(email, name, passwordHash, new Date().toISOString());
      this.onChange();
      return this.getAppUserById(Number(info.lastInsertRowid));
    } catch (err) {
      if (err instanceof Error && /UNIQUE/i.test(err.message)) return null;
      throw err;
    }
  }

  getAppUserByEmail(email: string): AppUserRow | null {
    const r = this.db.prepare(`SELECT * FROM app_users WHERE email = ?`).get(email) as Record<string, unknown> | undefined;
    return r ? this.toAppUser(r) : null;
  }

  getAppUserById(id: number): AppUserRow | null {
    const r = this.db.prepare(`SELECT * FROM app_users WHERE id = ?`).get(id) as Record<string, unknown> | undefined;
    return r ? this.toAppUser(r) : null;
  }

  listAppUsers(): AppUserRow[] {
    return (this.db.prepare(`SELECT * FROM app_users ORDER BY created_at DESC, id DESC`).all() as Array<Record<string, unknown>>).map((r) => this.toAppUser(r));
  }

  /** Changes only the fields given. signOutEverywhere makes every existing sign-in for this user invalid. */
  updateAppUser(
    id: number,
    patch: { name?: string; pages?: string; active?: boolean; passwordHash?: string; signOutEverywhere?: boolean },
  ): boolean {
    const sets: string[] = [];
    const values: Array<string | number> = [];
    if (patch.name !== undefined) { sets.push("name = ?"); values.push(patch.name); }
    if (patch.pages !== undefined) { sets.push("pages = ?"); values.push(patch.pages); }
    if (patch.active !== undefined) { sets.push("active = ?"); values.push(patch.active ? 1 : 0); }
    if (patch.passwordHash !== undefined) { sets.push("password_hash = ?"); values.push(patch.passwordHash); }
    if (patch.signOutEverywhere || patch.passwordHash !== undefined || patch.active === false) sets.push("session_version = session_version + 1");
    if (sets.length === 0) return this.getAppUserById(id) !== null;
    const info = this.db.prepare(`UPDATE app_users SET ${sets.join(", ")} WHERE id = ?`).run(...values, id);
    if (info.changes > 0) this.onChange();
    return info.changes > 0;
  }

  /** Deliberately does not trigger a backup: a sign-in shouldn't upload the database. */
  touchAppUserLogin(id: number): void {
    this.db.prepare(`UPDATE app_users SET last_login_at = ? WHERE id = ?`).run(new Date().toISOString(), id);
  }

  deleteAppUser(id: number): boolean {
    const info = this.db.prepare(`DELETE FROM app_users WHERE id = ?`).run(id);
    if (info.changes > 0) this.onChange();
    return info.changes > 0;
  }

  // ---- fresh start ---------------------------------------------------------------------------

  /**
   * "Fresh start": when set, the Dashboard, hit rates, Win/Loss and profit figures count only alerts that arrived
   * at or after this time. Nothing is deleted, so clearing it brings the older figures straight back.
   */
  getFreshStart(): string | null {
    const raw = this.getSetting("fresh_start");
    if (!raw) return null;
    try {
      const at = (JSON.parse(raw) as { at?: unknown }).at;
      return typeof at === "string" && Number.isFinite(Date.parse(at)) ? at : null;
    } catch {
      return null;
    }
  }

  setFreshStart(at: string | null): void {
    this.setSetting("fresh_start", JSON.stringify(at === null ? {} : { at }));
  }

  /** The later of a "since" time and the fresh start time. Null means "no limit". */
  private floorSince(since: string | null): string | null {
    const floor = this.getFreshStart();
    if (floor === null) return since;
    return since === null || floor > since ? floor : since;
  }

  getSetting(key: string): string | null {
    const row = this.db.prepare(`SELECT value FROM settings WHERE key = ?`).get(key) as { value: string } | undefined;
    return row ? row.value : null;
  }

  setSetting(key: string, value: string): void {
    this.db
      .prepare(`INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`)
      .run(key, value);
    this.onChange();
  }

  /**
   * Stamps sent_at, and stores the exact row that was handed over, on picks that
   * haven't been sent before. Already-stamped picks keep their first time and row.
   */
  /** Picks that still need a simulated bet recorded: not sent, not excluded, none recorded yet. */
  listSimCandidates(sinceIso: string): LivePick[] {
    const ids = new Set(
      (
        this.db
          .prepare(`SELECT id FROM live_picks WHERE first_seen_at >= ? AND sent_at IS NULL AND sim_row IS NULL AND excluded = 0`)
          .all(sinceIso) as Array<{ id: number }>
      ).map((r) => r.id),
    );
    if (ids.size === 0) return [];
    return this.listLivePicks(1000, { from: sinceIso, to: new Date(Date.now() + 60_000).toISOString() }).filter((p) => ids.has(p.id));
  }

  /** Stores simulated bets. Never overwrites one already recorded, and never touches a pick that was sent. */
  setSimRows(items: Array<{ id: number; rowJson: string }>, at: string): void {
    if (items.length === 0) return;
    const stmt = this.db.prepare(`UPDATE live_picks SET sim_row = ?, sim_at = ? WHERE id = ? AND sim_row IS NULL AND sent_at IS NULL`);
    this.db.transaction(() => {
      for (const it of items) stmt.run(it.rowJson, at, it.id);
    })();
    this.onChange();
  }

  /** When simulated bets that would have been placed were recorded, from roughly the last day and a half (for the daily limit). */
  recentSimBetTimes(): string[] {
    const since = new Date(Date.now() - 36 * 3_600_000).toISOString();
    const rows = this.db
      .prepare(`SELECT sim_at, sim_row FROM live_picks WHERE sim_at IS NOT NULL AND sim_at >= ? AND sent_at IS NULL`)
      .all(since) as Array<{ sim_at: string; sim_row: string | null }>;
    return rows.filter((r) => parseSimRow(r.sim_row)?.skipped === null).map((r) => r.sim_at);
  }

  markSent(items: Array<{ id: number; rowJson: string }>): void {
    if (items.length === 0) return;
    const now = new Date().toISOString();
    const stmt = this.db.prepare(`UPDATE live_picks SET sent_at = ?, sent_row = ? WHERE id = ? AND sent_at IS NULL`);
    for (const it of items) stmt.run(now, it.rowJson, it.id);
    this.onChange();
  }

  /** sent_at stamps from roughly the last day and a half, for the daily-limit count. */
  recentSentTimes(): string[] {
    const since = new Date(Date.now() - 36 * 60 * 60 * 1000).toISOString();
    const rows = this.db
      .prepare(`SELECT sent_at FROM live_picks WHERE sent_at IS NOT NULL AND sent_at >= ?`)
      .all(since) as Array<{ sent_at: string }>;
    return rows.map((r) => r.sent_at);
  }

  /** Replaces one UK day's schedule with a fresh pull from API-Football. */
  replaceScheduleDay(ukDate: string, fixtures: ScheduleFixture[], pulledAt: string): void {
    const del = this.db.prepare(`DELETE FROM schedule_fixtures WHERE uk_date = ?`);
    const ins = this.db.prepare(
      `INSERT OR REPLACE INTO schedule_fixtures
         (uk_date, fixture_id, kickoff, kickoff_ts, status, status_long, league_id, league, country, round, home, away, venue, pulled_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    this.db.transaction(() => {
      del.run(ukDate);
      for (const f of fixtures) {
        ins.run(ukDate, f.id, f.kickoff, f.timestamp, f.status, f.statusLong, f.leagueId, f.league, f.country, f.round, f.home, f.away, f.venue, pulledAt);
      }
    })();
    this.onChange();
  }

  /** Drops schedule days before `ukDate`, so only a couple of days are ever kept. */
  pruneScheduleBefore(ukDate: string): void {
    const info = this.db.prepare(`DELETE FROM schedule_fixtures WHERE uk_date < ?`).run(ukDate);
    if (info.changes > 0) this.onChange();
  }

  /** One UK day's matches in kick-off order, and when they were pulled (null if that day was never pulled). */
  getScheduleDay(ukDate: string): { fixtures: ScheduleFixture[]; pulledAt: string | null } {
    const rows = this.db
      .prepare(
        `SELECT fixture_id, kickoff, kickoff_ts, status, status_long, league_id, league, country, round, home, away, venue, pulled_at
         FROM schedule_fixtures WHERE uk_date = ? ORDER BY kickoff_ts, country, league, home`,
      )
      .all(ukDate) as Array<{
      fixture_id: number;
      kickoff: string;
      kickoff_ts: number;
      status: string;
      status_long: string;
      league_id: number;
      league: string;
      country: string;
      round: string | null;
      home: string;
      away: string;
      venue: string | null;
      pulled_at: string;
    }>;
    return {
      pulledAt: rows[0]?.pulled_at ?? null,
      fixtures: rows.map((r) => ({
        id: r.fixture_id,
        kickoff: r.kickoff,
        timestamp: r.kickoff_ts,
        status: r.status,
        statusLong: r.status_long,
        leagueId: r.league_id,
        league: r.league,
        country: r.country,
        round: r.round,
        home: r.home,
        away: r.away,
        venue: r.venue,
      })),
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