/**
 * Reads the free tip channels the owner chose (Free tips page) over the Telegram login already in use, and stores each
 * message with how classify.ts read it. Read-only: nothing here places or suggests a bet, and the alert channel's
 * handling (telegram/listener.ts) is untouched.
 *
 * The channels are kept as the owner typed them (@name, a t.me link, or a number) in the `tip_channels` setting, so one
 * can be added without a restart. Live messages and edits are stored as they arrive; every few minutes the last
 * messages of each channel are read back too, so anything missed while the engine was down is caught.
 */
// First: GramJS must load with the newer Telegram schema (use-new-layer.ts).
import "../telegram/use-new-layer";
import { loadChatList } from "../telegram/chat-list";
import type { TelegramClient, Api } from "telegram";
import { NewMessage, type NewMessageEvent } from "telegram/events";
import { EditedMessage, type EditedMessageEvent } from "telegram/events/EditedMessage";
import type { EngineDb } from "../storage/engine-db";
import { log } from "../server/log";
import { classifyTip } from "./classify";
import { applyLearning, type Reviewed } from "./similar";
import { trackTips } from "./track";
import { buildScreenCards, claudeVision, notifyScreenPost, parseVision, visionPrompt } from "./tipman-screens";
import { storeCards } from "./tipman-cards";
import { notifyNewTips } from "./notify";
import { getExchangeReader } from "../betfair/exchange";
import { messageWords, richMessageIsPart, richMessageText } from "./rich-text";

const KEY = "tip_channels";
const SYNC_EVERY_MS = 5 * 60 * 1000;
const FIRST_READ = 400;
const LATER_READ = 40;

/** The channels, each in its normal form and once only (older entries typed without the minus sign are put right here). */
export function getTipChannels(db: EngineDb): string[] {
  try {
    const v = JSON.parse(db.getSetting(KEY) ?? "[]") as unknown;
    const list = Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").map(normaliseChannel).filter(Boolean) : [];
    return list.filter((c, i) => list.findIndex((x) => x.toLowerCase() === c.toLowerCase()) === i);
  } catch {
    return [];
  }
}

/**
 * "https://t.me/name", "t.me/name", "@name" and "name" are all the same channel; a number is a chat id. A channel's id is
 * -100 followed by ten digits: typed without the minus sign (as Telegram Web's address sometimes reads) it would be taken
 * for a person, so the sign is put back.
 */
export function normaliseChannel(raw: string): string {
  // A Telegram Web address (web.telegram.org/a/#-1001401746016) carries the chat's number after the #.
  const web = /web\.telegram\.org\/.*#(-?\d+)/i.exec(raw);
  const s = web ? web[1]! : raw.trim().replace(/^https?:\/\//i, "").replace(/^t\.me\//i, "").replace(/^@/, "").replace(/[/?#].*$/, "");
  if (/^100\d{10}$/.test(s)) return `-${s}`;
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
  /**
   * What the messages are, by Telegram type and media type ("Message/MessageMediaPhoto": 12). Both Teams to Score's
   * freebies were never read (9 Nov 2026): only 13 of its 400 latest messages had words, so this shows what the rest are.
   */
  kinds?: Record<string, number>;
  /** The latest messages without words: what each is, so a format the reader misses can be found. */
  wordless?: Array<{ id: number; at: string; kind: string; album: boolean; buttons: boolean; fields: string[] }>;
}

type StatMessage = { id?: number; date: number; message?: string; photo?: unknown; className?: string; media?: { className?: string } | null; groupedId?: unknown; replyMarkup?: unknown; richMessage?: unknown };

function kindOf(m: StatMessage): string {
  return `${m.className ?? "?"}/${m.media?.className ?? "text"}${m.richMessage ? "+rich" : ""}`;
}

/** The message's own fields that hold something: a field the reader doesn't look at may be where the words went. */
function filledFields(m: StatMessage): string[] {
  return Object.entries(m as Record<string, unknown>)
    .filter(([k, v]) => !k.startsWith("_") && v !== undefined && v !== null && v !== false && typeof v !== "function" && !(Array.isArray(v) && v.length === 0) && !["CONSTRUCTOR_ID", "SUBCLASS_OF_ID", "classType", "originalArgs"].includes(k))
    .map(([k]) => k)
    .slice(0, 30);
}

export function getTipStats(db: EngineDb): Record<string, TipChannelStats> {
  try {
    return JSON.parse(db.getSetting(STATS_KEY) ?? "{}") as Record<string, TipChannelStats>;
  } catch {
    return {};
  }
}

/** How many photos a channel posts, from its latest messages: what reading the images would cost depends on it. */
function saveTipStats(db: EngineDb, id: string, name: string, messages: StatMessage[]): void {
  if (messages.length === 0) return;
  const dates = messages.map((m) => m.date);
  const all = getTipStats(db);
  all[id] = {
    name,
    from: new Date(Math.min(...dates) * 1000).toISOString(),
    to: new Date(Math.max(...dates) * 1000).toISOString(),
    messages: messages.length,
    photos: messages.filter((m) => !!m.photo).length,
    withText: messages.filter((m) => messageWords(m).trim().length > 0).length,
    kinds: messages.reduce<Record<string, number>>((acc, m) => ((acc[kindOf(m)] = (acc[kindOf(m)] ?? 0) + 1), acc), {}),
    wordless: messages
      .filter((m) => !messageWords(m).trim())
      .slice(0, 12)
      .map((m) => ({ id: m.id ?? 0, at: new Date(m.date * 1000).toISOString(), kind: kindOf(m), album: m.groupedId != null, buttons: m.replyMarkup != null, fields: filledFields(m) })),
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

/**
 * Reads this channel's other recent messages again (default: the last 14 days), so ones that look like a message the owner
 * just confirmed or rejected move too. Messages the owner has already called are left alone. A message whose reading
 * changed is also offered for tracking again. Returns how many changed.
 */
export function rescoreChannel(db: EngineDb, chatKey: string, days = 14): number {
  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  const reviewed = reviewedIn(db, chatKey);
  let changed = 0;
  for (const t of db.listChannelTips(since, 5000)) {
    if (t.chatKey !== chatKey || t.review !== null) continue;
    // Not compared with itself: it has no call, so it isn't in `reviewed`.
    const r = applyLearning(classifyTip(t.text), t.text, reviewed);
    if (r.verdict === t.verdict && r.match === t.match && r.selection === t.selection && r.odds === t.odds && r.stake === t.stake && r.reasons.join("|") === t.reasons.join("|")) continue;
    db.upsertChannelTip({ chatKey: t.chatKey, messageId: t.messageId, channel: t.channel, postedAt: t.postedAt, text: t.text, verdict: r.verdict, reasons: r.reasons, match: r.match, selection: r.selection, odds: r.odds, stake: r.stake });
    if (t.tracked !== "done") db.setChannelTipTracked(t.chatKey, t.messageId, null);
    changed++;
  }
  return changed;
}

/** Bumped whenever the wording rules (classify.ts) improve: every stored message is then read again, once. */
const CLASSIFIER_VERSION = "8";
const VERSION_KEY = "tips_classifier_version";

/** Reads every stored message again with today's rules if they have changed since it last did. */
export function rescoreIfRulesChanged(db: EngineDb): number {
  if (db.getSetting(VERSION_KEY) === CLASSIFIER_VERSION) return 0;
  const since = new Date(Date.now() - 60 * 86_400_000).toISOString();
  const chats = [...new Set(db.listChannelTips(since, 5000).map((t) => t.chatKey))];
  let changed = 0;
  for (const chat of chats) changed += rescoreChannel(db, chat, 60);
  // Tips set aside under the old rules get another look: the new rules read more bets and can record at the channel's price.
  changed += db.resetSetAsideTips(new Date(Date.now() - 36 * 3_600_000).toISOString());
  db.setSetting(VERSION_KEY, CLASSIFIER_VERSION);
  if (changed > 0) log.info(`Free tips: ${changed} stored message(s) read again with the improved rules.`);
  return changed;
}

/**
 * Classifies and stores one message. Returns true when something was written. `reviewed` is the channel's confirmed and
 * rejected messages: pass it when storing a batch, so it is read once instead of once per message.
 */
export function recordTip(db: EngineDb, m: { chatKey: string; messageId: number; date: number; text: string; channel: string }, reviewed?: Reviewed[]): boolean {
  const text = m.text.trim();
  if (!text) return false;
  if (db.getChannelTipText(m.chatKey, m.messageId) === m.text) return false;
  const r = applyLearning(classifyTip(m.text), m.text, reviewed ?? reviewedIn(db, m.chatKey));
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

type WordsMessage = { id: number; message?: string; richMessage?: unknown; entities?: unknown; replyMarkup?: unknown };

/**
 * The bookmaker links in a post: "Betfair - add to betslip" in TipMan Tips Premium is a word linked to the bet itself, with
 * the selections only in a screenshot (20 Nov 2026). Telegram sends the address apart from the words (a text-link entity,
 * or a button), so it was being dropped. Each is returned as "label: address", for links whose label or address names a
 * betslip or Betfair. Pure.
 */
export function betslipLinks(m: { message?: string; entities?: unknown; replyMarkup?: unknown }): string[] {
  const out: string[] = [];
  const text = m.message ?? "";
  const keep = (label: string, url: string) => {
    const l = label.trim().replace(/\s+/g, " ");
    if (!/^https?:\/\//i.test(url) || !/betslip|betfair|bet\s*builder/i.test(`${l} ${url}`)) return;
    const line = `${l || "Link"}: ${url}`;
    if (!out.includes(line)) out.push(line);
  };
  for (const e of Array.isArray(m.entities) ? (m.entities as Array<{ className?: string; offset?: number; length?: number; url?: string }>) : []) {
    if (e.className === "MessageEntityTextUrl" && typeof e.url === "string") keep(text.substr(e.offset ?? 0, e.length ?? 0), e.url);
  }
  const rows = (m.replyMarkup as { rows?: Array<{ buttons?: Array<{ text?: string; url?: string }> }> } | null | undefined)?.rows ?? [];
  for (const row of rows) for (const b of row.buttons ?? []) if (typeof b.url === "string") keep(b.text ?? "", b.url);
  return out;
}

/** The links wordsWithLinks stored with a post, read back for the Free tips page's "Open betslip" buttons. Pure. */
export function storedLinks(text: string): Array<{ label: string; url: string }> {
  const out: Array<{ label: string; url: string }> = [];
  for (const line of text.split("\n")) {
    const m = /^(.{1,80}?): (https?:\/\/\S+)\s*$/.exec(line.trim());
    if (m && /betslip|betfair|bet\s*builder/i.test(line)) out.push({ label: m[1]!, url: m[2]! });
  }
  return out;
}

/** The post's words with its bookmaker links (betslipLinks) added at the end, one a line. */
export function wordsWithLinks(words: string, m: WordsMessage): string {
  const links = betslipLinks(m);
  return links.length === 0 || !words.trim() ? words : `${words.trimEnd()}\n\n${links.join("\n")}`;
}

/**
 * A message's words: its text, else its rich part's (rich-text.ts). Telegram sends only the start of a long rich post
 * ("part"); the whole post is then asked for once (messages.getRichMessage), falling back to the start if that fails.
 */
async function wordsOf(client: TelegramClient, chatId: string, m: unknown): Promise<string> {
  const msg = m as WordsMessage;
  const words = messageWords(msg);
  if (!richMessageIsPart(msg.richMessage) || (msg.message ?? "").trim()) return words;
  try {
    // The request is newer than GramJS's typings (layer 233, use-new-layer.ts), so it is reached by name.
    const api = (await import("telegram")).Api as unknown as { messages: Record<string, new (args: Record<string, unknown>) => unknown> };
    const Req = api.messages.GetRichMessage;
    if (!Req) return words;
    const res = (await client.invoke(new Req({ peer: await client.getInputEntity(Number(chatId)), id: msg.id }) as never)) as { messages?: WordsMessage[] };
    const full = res.messages?.find((x) => x.id === msg.id) ?? res.messages?.[0];
    const fullWords = full ? richMessageText(full.richMessage) : "";
    return fullWords.length > words.length ? fullWords : words;
  } catch (err) {
    log.warn(`Free tips: couldn't fetch the whole of rich post ${msg.id}: ${err instanceof Error ? err.message : String(err)}`);
    return words;
  }
}

interface Active {
  client: TelegramClient;
  db: EngineDb;
  stopped: () => boolean;
  /** Marked chat id (as message.chatId prints it) to the channel's display name. */
  known: Map<string, string>;
  firstDone: Set<string>;
}

// --------------------------------------------------------------------------- TipMan Premium's screenshots

const SCREENS_KEY = "tipman_screens_done";
const SCREENS_VERSION_KEY = "tipman_screens_version";
const SCREENS_VERSION = "3";
const SCREEN_TRIES = 3;
const SCREEN_MAX_AGE_S = 30 * 3600;
const SCREENS_PER_PASS = 3;
const isTipmanPremium = (name: string) => /tip\s*man/i.test(name) && /premium/i.test(name);
let screensKeyWarned = false;

function screensDone(db: EngineDb): Record<string, number> {
  try {
    return JSON.parse(db.getSetting(SCREENS_KEY) ?? "{}") as Record<string, number>;
  } catch {
    return {};
  }
}

/**
 * The TipMan Premium channel posts its bets as screenshots with a caption ("1pt for all 3 doubles and a 1pt treble"). New photo
 * posts of the last 30 hours (an album is one post) are read with Claude's image reading, built into the bets the caption
 * sets up (tips/tipman-screens.ts), stored for tracking (tips/tipman-cards.ts) and notified once, with a tap that opens
 * Betfair's betslip. Each post is read once (three tries if the reading fails); racing posts are left to the Horses page.
 * Needs ANTHROPIC_API_KEY on the engine.
 */
async function readTipmanScreens(a: Active, chatId: string, name: string, messages: Api.Message[]): Promise<void> {
  if (!isTipmanPremium(name)) return;
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) {
    if (!screensKeyWarned) log.info("TipMan screenshots: ANTHROPIC_API_KEY isn't set on the engine, so the images aren't read.");
    screensKeyWarned = true;
    return;
  }
  // 22 Nov 2026: the reader now reports each bet in an image separately (a Bet of the Day and an accumulator in one image
  // had been merged, and a bet builder's advised points and price missed). The first posts read before that are read again.
  // Version 3: "3 doubles and a treble" on bookings in one match had been built as a single treble; now four separate bets.
  if (a.db.getSetting(SCREENS_VERSION_KEY) !== SCREENS_VERSION) {
    const gone = a.db.deleteTipmanCardsStartingWith("tg");
    a.db.setSetting(SCREENS_KEY, "{}");
    a.db.setSetting(SCREENS_VERSION_KEY, SCREENS_VERSION);
    if (gone > 0) log.info(`TipMan screenshots: ${gone} bet(s) read by the earlier reader cleared, to be read again.`);
  }
  const done = screensDone(a.db);
  const groups = new Map<string, Api.Message[]>();
  for (const m of [...messages].reverse()) {
    if (!(m as unknown as { photo?: unknown }).photo || Date.now() / 1000 - m.date > SCREEN_MAX_AGE_S) continue;
    if (m.id < Number(a.db.getSetting("tipman_ignore_before") ?? 0)) continue; // cleared: not read again
    const gid = (m as unknown as { groupedId?: unknown }).groupedId;
    const key = `${chatId}:${gid != null ? `g${String(gid)}` : `m${m.id}`}`;
    (groups.get(key) ?? groups.set(key, []).get(key)!).push(m);
  }
  let read = 0;
  for (const [key, msgs] of groups) {
    if ((done[key] ?? 0) >= SCREEN_TRIES || done[key] === -1 || read >= SCREENS_PER_PASS || a.stopped()) continue;
    const caption = msgs.map((m) => (m.message ?? "").trim()).find(Boolean) ?? "";
    if (/racing|horse|\bnap\b|each[- ]way|\be\/?w\b/i.test(caption)) {
      done[key] = -1;
      continue;
    }
    read++;
    try {
      const images: Array<{ data: Buffer; mime: string }> = [];
      for (const m of msgs.slice(0, 4)) {
        const buf = (await a.client.downloadMedia(m, {})) as Buffer | string | undefined;
        if (Buffer.isBuffer(buf) && buf.length > 0 && buf.length < 6_000_000) images.push({ data: buf, mime: "image/jpeg" });
      }
      if (images.length === 0) throw new Error("no image could be downloaded");
      const links = msgs.flatMap((m) => betslipLinks(m as unknown as WordsMessage)).map((l) => {
        const i = l.indexOf(": ");
        return { label: l.slice(0, i), url: l.slice(i + 2) };
      });
      const reply = await claudeVision(apiKey)(visionPrompt(caption), images);
      const parsed = parseVision(reply);
      if (!parsed) throw new Error("the reply wasn't a reading of the image");
      const cards = buildScreenCards({ messageId: msgs[0]!.id, caption, read: parsed, links, now: new Date() });
      const added = storeCards(a.db, cards);
      done[key] = -1;
      if (added.length > 0) {
        log.info(`TipMan screenshots: ${added.length} bet(s) from post ${msgs[0]!.id}: ${added[0]!.group?.label ?? added[0]!.name}.`);
        // Tracked either way; only a post from the last 3 hours is worth a "send to bet?" (an old one found on start-up isn't).
        if (Date.now() / 1000 - msgs[0]!.date < 3 * 3600) await notifyScreenPost(a.db, added, links);
      } else if (parsed.kind === "selections") log.info(`TipMan screenshots: post ${msgs[0]!.id} read, nothing new to store.`);
    } catch (err) {
      done[key] = (done[key] ?? 0) + 1;
      log.warn(`TipMan screenshots: couldn't read post ${msgs[0]!.id} (try ${done[key]} of ${SCREEN_TRIES}): ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  // Kept short: only keys from posts still in the window matter.
  const keep = new Set(groups.keys());
  a.db.setSetting(SCREENS_KEY, JSON.stringify(Object.fromEntries(Object.entries(done).filter(([k]) => keep.has(k)))));
}

let screensTimer: NodeJS.Timeout | null = null;

/** A photo has just arrived in the TipMan Premium channel: reads it shortly, so the whole album is there. */
function readScreensSoon(a: Active, chatId: string, name: string): void {
  if (screensTimer) clearTimeout(screensTimer);
  screensTimer = setTimeout(() => {
    screensTimer = null;
    if (active !== a || a.stopped()) return;
    void a.client
      .getMessages(Number(chatId), { limit: 20 })
      .then((msgs) => readTipmanScreens(a, chatId, name, msgs as Api.Message[]))
      .catch((err) => log.warn(`TipMan screenshots: ${err instanceof Error ? err.message : String(err)}`));
  }, 20_000);
  screensTimer.unref?.();
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
        await loadChatList(a.client, 200);
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
    let fetches = 0;
    for (const [id, name] of a.known) {
      const first = !a.firstDone.has(id);
      const messages = (await a.client.getMessages(Number(id), { limit: first ? FIRST_READ : LATER_READ })) as Api.Message[];
      a.firstDone.add(id);
      if (first) saveTipStats(a.db, id, name, messages as unknown as StatMessage[]);
      const reviewed = reviewedIn(a.db, id);
      await readTipmanScreens(a, id, name, messages);
      for (const m of [...messages].reverse()) {
        // Whole rich posts are asked for only for the last two days' posts, at most 10 a pass: Telegram limits requests.
        const recent = Date.now() / 1000 - m.date < 2 * 86_400 && fetches < 10;
        if (recent && richMessageIsPart((m as { richMessage?: unknown }).richMessage) && !(m.message ?? "").trim()) fetches++;
        const text = wordsWithLinks(recent ? await wordsOf(a.client, id, m) : messageWords(m as WordsMessage), m as WordsMessage);
        if (recordTip(a.db, { chatKey: id, messageId: m.id, date: m.date, text, channel: name }, reviewed)) stored++;
      }
    }
    if (stored > 0) log.info(`Free tips: stored ${stored} message(s) from ${a.known.size} channel(s).`);
    // Tips that can be placed on Betfair become Sim picks of the "Telegram tips" strategy (tips/track.ts).
    const betfair = getExchangeReader();
    await notifyNewTips(a.db);
    if (betfair) await trackTips(a.db, betfair);
  } catch (err) {
    log.error(`Free tips read failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

let tracking = false;

/** Prices any new tips on Betfair now (one run at a time; the five-minute read also does this). */
export async function trackSoon(db: EngineDb): Promise<void> {
  if (tracking) return;
  tracking = true;
  try {
    const betfair = getExchangeReader();
    if (betfair) await trackTips(db, betfair);
  } catch (err) {
    log.warn(`Free tips: pricing a new tip failed: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    tracking = false;
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
  try {
    rescoreIfRulesChanged(db);
  } catch (err) {
    log.warn(`Free tips: couldn't read the stored messages again: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (attachedClient !== client) {
    attachedClient = client;
    const handle = (event: NewMessageEvent | EditedMessageEvent) => {
      try {
        if (!active || active.client !== client || active.stopped()) return;
        const message = event.message;
        const id = message.chatId?.toString();
        const name = id ? active.known.get(id) : undefined;
        if (!id || !name) return;
        // A message that arrives live is priced straight away, not at the next five-minute read: an in-play tip's price
        // only means something if it is read within minutes.
        if (isTipmanPremium(name) && (message as unknown as { photo?: unknown }).photo) readScreensSoon(active, id, name);
        const store = (text: string) => {
          if (recordTip(db, { chatKey: id, messageId: message.id, date: message.date, text: wordsWithLinks(text, message as WordsMessage), channel: name })) {
            void notifyNewTips(db);
            void trackSoon(db);
          }
        };
        const rich = (message as { richMessage?: unknown }).richMessage;
        if (richMessageIsPart(rich)) void wordsOf(client, id, message).then(store, () => store(messageWords(message as WordsMessage)));
        else store(messageWords(message as WordsMessage));
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
