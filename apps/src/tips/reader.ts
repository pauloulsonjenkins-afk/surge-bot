/**
 * Reads the free tip channels the owner chose (Free tips page) over the Telegram login already in use, and stores each
 * message with how classify.ts read it. Read-only: nothing here places or suggests a bet, and the alert channel's
 * handling (telegram/listener.ts) is untouched.
 *
 * The channels are kept as the owner typed them (@name, a t.me link, or a number) in the `tip_channels` setting, so one
 * can be added without a restart. Live messages and edits are stored as they arrive; every few minutes the last
 * messages of each channel are read back too, so anything missed while the engine was down is caught.
 */
import type { TelegramClient, Api } from "telegram";
import { NewMessage, type NewMessageEvent } from "telegram/events";
import { EditedMessage, type EditedMessageEvent } from "telegram/events/EditedMessage";
import type { EngineDb } from "../storage/engine-db";
import { log } from "../server/log";
import { classifyTip } from "./classify";
import { applyLearning, type Reviewed } from "./similar";
import { trackTips } from "./track";
import { getExchangeReader } from "../betfair/exchange";

const KEY = "tip_channels";
const SYNC_EVERY_MS = 5 * 60 * 1000;
const FIRST_READ = 400;
const LATER_READ = 40;

export function getTipChannels(db: EngineDb): string[] {
  try {
    const v = JSON.parse(db.getSetting(KEY) ?? "[]") as unknown;
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

/** "https://t.me/name", "t.me/name", "@name" and "name" are all the same channel; a number is a chat id. */
export function normaliseChannel(raw: string): string {
  // A Telegram Web address (web.telegram.org/a/#-1001401746016) carries the chat's number after the #.
  const web = /web\.telegram\.org\/.*#(-?\d+)/i.exec(raw);
  if (web) return web[1]!;
  const s = raw.trim().replace(/^https?:\/\//i, "").replace(/^t\.me\//i, "").replace(/^@/, "").replace(/[/?#].*$/, "");
  return /^-?\d+$/.test(s) ? s : s ? `@${s}` : "";
}

export function addTipChannel(db: EngineDb, raw: string): string[] {
  const c = normaliseChannel(raw);
  if (!c) throw new Error("Enter a channel name like @freetips, or a t.me link.");
  const all = getTipChannels(db);
  if (!all.some((x) => x.toLowerCase() === c.toLowerCase())) all.push(c);
  db.setSetting(KEY, JSON.stringify(all));
  return all;
}

export function removeTipChannel(db: EngineDb, raw: string): string[] {
  const c = normaliseChannel(raw).toLowerCase();
  const all = getTipChannels(db).filter((x) => x.toLowerCase() !== c);
  db.setSetting(KEY, JSON.stringify(all));
  return all;
}

const STATS_KEY = "tip_channel_stats";

export interface TipChannelStats {
  name: string;
  /** The span of the messages counted. */
  from: string;
  to: string;
  messages: number;
  /** Messages that are a photo (a forwarded bet slip is one). */
  photos: number;
  /** Messages with words in them, which the reader classifies for free. */
  withText: number;
}

export function getTipStats(db: EngineDb): Record<string, TipChannelStats> {
  try {
    return JSON.parse(db.getSetting(STATS_KEY) ?? "{}") as Record<string, TipChannelStats>;
  } catch {
    return {};
  }
}

/** How many photos a channel posts, from its latest messages: what reading the images would cost depends on it. */
function saveTipStats(db: EngineDb, id: string, name: string, messages: Array<{ date: number; message?: string; photo?: unknown }>): void {
  if (messages.length === 0) return;
  const dates = messages.map((m) => m.date);
  const all = getTipStats(db);
  all[id] = {
    name,
    from: new Date(Math.min(...dates) * 1000).toISOString(),
    to: new Date(Math.max(...dates) * 1000).toISOString(),
    messages: messages.length,
    photos: messages.filter((m) => !!m.photo).length,
    withText: messages.filter((m) => (m.message ?? "").trim().length > 0).length,
  };
  db.setSetting(STATS_KEY, JSON.stringify(all));
}

/** The owner's calls from this channel in the last 60 days: what new messages are compared with (similar.ts). */
function reviewedIn(db: EngineDb, chatKey: string): Reviewed[] {
  const since = new Date(Date.now() - 60 * 86_400_000).toISOString();
  return db
    .listChannelTips(since, 2000)
    .filter((t) => t.chatKey === chatKey && (t.review === "tip" || t.review === "not"))
    .map((t) => ({ text: t.text, review: t.review as "tip" | "not" }));
}

function readWithLearning(db: EngineDb, chatKey: string, text: string) {
  return applyLearning(classifyTip(text), text, reviewedIn(db, chatKey));
}

/**
 * After the owner confirms or rejects a message: reads this channel's other recent messages again, so ones that look like it
 * move too. Messages the owner has already called are left alone. Returns how many readings changed.
 */
export function rescoreChannel(db: EngineDb, chatKey: string): number {
  const since = new Date(Date.now() - 14 * 86_400_000).toISOString();
  const reviewed = reviewedIn(db, chatKey);
  let changed = 0;
  for (const t of db.listChannelTips(since, 2000)) {
    if (t.chatKey !== chatKey || t.review !== null) continue;
    // Not compared with itself: it has no call, so it isn't in `reviewed`.
    const r = applyLearning(classifyTip(t.text), t.text, reviewed);
    if (r.verdict === t.verdict && r.reasons.length === t.reasons.length) continue;
    db.upsertChannelTip({ chatKey: t.chatKey, messageId: t.messageId, channel: t.channel, postedAt: t.postedAt, text: t.text, verdict: r.verdict, reasons: r.reasons, match: r.match, selection: r.selection, odds: r.odds, stake: r.stake });
    changed++;
  }
  return changed;
}

/** Classifies and stores one message. Returns true when something was written. */
export function recordTip(db: EngineDb, m: { chatKey: string; messageId: number; date: number; text: string; channel: string }): boolean {
  const text = m.text.trim();
  if (!text) return false;
  if (db.getChannelTipText(m.chatKey, m.messageId) === m.text) return false;
  const r = readWithLearning(db, m.chatKey, m.text);
  db.upsertChannelTip({
    chatKey: m.chatKey,
    messageId: m.messageId,
    channel: m.channel,
    postedAt: new Date(m.date * 1000).toISOString(),
    text: m.text,
    verdict: r.verdict,
    reasons: r.reasons,
    match: r.match,
    selection: r.selection,
    odds: r.odds,
    stake: r.stake,
  });
  return true;
}

interface Active {
  client: TelegramClient;
  db: EngineDb;
  stopped: () => boolean;
  /** Marked chat id (as message.chatId prints it) to the channel's display name. */
  known: Map<string, string>;
  firstDone: Set<string>;
}

let active: Active | null = null;
let timer: NodeJS.Timeout | null = null;
let attachedClient: TelegramClient | null = null;

async function resolve(a: Active): Promise<void> {
  const next = new Map<string, string>();
  let dialogsLoaded = false;
  for (const ref of getTipChannels(a.db)) {
    try {
      const ask = () => a.client.getEntity(/^-?\d+$/.test(ref) ? Number(ref) : ref);
      let entity;
      try {
        entity = await ask();
      } catch (err) {
        // A number only works once the login has seen the chat; loading the chat list teaches it (as the alert listener does).
        if (dialogsLoaded || !/^-?\d+$/.test(ref)) throw err;
        dialogsLoaded = true;
        await a.client.getDialogs({ limit: 200 });
        entity = await ask();
      }
      const id = (await a.client.getPeerId(entity)).toString();
      const e = entity as { title?: string; username?: string };
      next.set(id, e.title ?? (e.username ? `@${e.username}` : ref));
    } catch (err) {
      log.warn(`Free tips: couldn't find the channel ${ref}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  a.known = next;
}

async function sync(a: Active): Promise<void> {
  if (a.stopped()) return;
  try {
    await resolve(a);
    let stored = 0;
    for (const [id, name] of a.known) {
      const first = !a.firstDone.has(id);
      const messages = (await a.client.getMessages(Number(id), { limit: first ? FIRST_READ : LATER_READ })) as Api.Message[];
      a.firstDone.add(id);
      if (first) saveTipStats(a.db, id, name, messages);
      for (const m of [...messages].reverse()) {
        if (recordTip(a.db, { chatKey: id, messageId: m.id, date: m.date, text: m.message ?? "", channel: name })) stored++;
      }
    }
    if (stored > 0) log.info(`Free tips: stored ${stored} message(s) from ${a.known.size} channel(s).`);
    // Tips that can be placed on Betfair become Sim picks of the "Telegram tips" strategy (tips/track.ts).
    const betfair = getExchangeReader();
    if (betfair) await trackTips(a.db, betfair);
  } catch (err) {
    log.error(`Free tips read failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/** Re-reads the channel list now (after one is added), without waiting for the next pass. */
export async function refreshTipChannels(): Promise<void> {
  if (active) await sync(active);
}

/**
 * Starts reading the chosen channels on this Telegram client. `stopped` says when this attachment is no longer current
 * (the listener was stopped or reconnected), so an old client's handlers do nothing.
 */
export function startTipReader(client: TelegramClient, db: EngineDb, stopped: () => boolean): void {
  const a: Active = { client, db, stopped, known: new Map(), firstDone: new Set() };
  active = a;
  if (attachedClient !== client) {
    attachedClient = client;
    const handle = (event: NewMessageEvent | EditedMessageEvent) => {
      try {
        if (!active || active.client !== client || active.stopped()) return;
        const message = event.message;
        const id = message.chatId?.toString();
        const name = id ? active.known.get(id) : undefined;
        if (!id || !name) return;
        recordTip(db, { chatKey: id, messageId: message.id, date: message.date, text: message.message ?? "", channel: name });
      } catch (err) {
        log.error(`Free tips couldn't store a message: ${err instanceof Error ? err.message : String(err)}`);
      }
    };
    client.addEventHandler((e: NewMessageEvent) => handle(e), new NewMessage({}));
    client.addEventHandler((e: EditedMessageEvent) => handle(e), new EditedMessage({}));
  }
  if (timer) clearInterval(timer);
  timer = setInterval(() => void sync(a), SYNC_EVERY_MS);
  timer.unref();
  void sync(a);
}

export function stopTipReader(): void {
  active = null;
  if (timer) clearInterval(timer);
  timer = null;
}
