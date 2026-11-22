/**
 * TIPMAN FROM THE TELEGRAM SCREENSHOTS (owner, 22 Nov 2026). The premium bets are posted in the TipMan Premium Telegram
 * channel as screenshots with a short caption ("Premium Bookings. 1pt for all 3 doubles and a 1pt treble (4pt total)").
 * GoalBrew already reads that channel with its own login, so no TipMan password is needed: the images are read with Claude's
 * image reading, the caption gives the staking, and the bets are built the way the tipster sets them up.
 *
 *   caption   "1pt for all 3 doubles and a 1pt treble" -> every pair of the selections is a 1pt double and all three are a
 *             1pt treble: a Trixie, four bets, 4pt. "1pt double", "2pts treble", "1pt acca" and "2pt single" work the same.
 *   images    each selection (match, selection, odds) and, for a bet builder, its combined price and stake
 *   bets      a double needs two different matches; every selection in one match is a bet builder (one bet, its own price)
 *   price     the product of the legs' odds as the screenshot shows them (a bet builder: the price shown)
 *
 * Reading an image can go wrong (a blurred price, a cropped line), so a card made this way is marked as read from a screenshot
 * and says when the reader wasn't sure or the caption's own total doesn't match: check the legs against the post. Nothing is
 * bet by this: the notification opens Betfair's own betslip with the selections already added, to place there.
 */
import type { EngineDb } from "../storage/engine-db";
import { CATEGORY_LABEL, categoryOf, fractionToDecimal, kickoffOf, pointsOf, sides, settleOf, type TipmanBook, type TipmanCard, type TipmanLeg } from "./tipman-cards";
import { sendPush } from "../server/push";
import { ukDateOf } from "../server/uk-time";

// --------------------------------------------------------------------------- the caption's staking

export type Shape = "single" | "double" | "treble" | "fourfold" | "acca";
const SIZE: Record<Exclude<Shape, "acca">, number> = { single: 1, double: 2, treble: 3, fourfold: 4 };

export interface StakePart {
  shape: Shape;
  pts: number;
}
export interface StakePlan {
  parts: StakePart[];
  /** The caption's own "(4pt total)", when it gives one. */
  totalPts: number | null;
}

const SHAPE_WORDS: Array<[RegExp, Shape[]]> = [
  [/^trixie$/, ["double", "treble"]],
  [/^singles?$/, ["single"]],
  [/^doubles?$/, ["double"]],
  [/^trebles?$/, ["treble"]],
  [/^(?:fourfolds?|4-?folds?)$/, ["fourfold"]],
  [/^(?:accas?|accumulators?)$/, ["acca"]],
];

/** The staking a caption gives. Parts in the order they are written; empty when it names none. Pure. */
export function parseStakePlan(caption: string): StakePlan {
  const parts: StakePart[] = [];
  const re = /(\d+(?:\.\d+)?)\s*(?:pts?|points?)\s*(?:for\s+|on\s+)?(?:all\s+)?(?:(?:\d+|an?|the|each)\s+)?(trixie|singles?|doubles?|trebles?|four-?folds?|4-?folds?|accas?|accumulators?)\b/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(caption)) !== null) {
    const pts = Number(m[1]);
    const word = m[2]!.toLowerCase().replace("four-fold", "fourfold");
    const shapes = SHAPE_WORDS.find(([r]) => r.test(word))?.[1];
    if (!shapes || !(pts > 0 && pts <= 20)) continue;
    for (const shape of shapes) parts.push({ shape, pts });
  }
  const total = /\(\s*(\d+(?:\.\d+)?)\s*(?:pts?|points?)\s*total\s*\)|total\s*(?:of\s*)?(\d+(?:\.\d+)?)\s*(?:pts?|points?)/i.exec(caption);
  const t = total ? Number(total[1] ?? total[2]) : NaN;
  return { parts, totalPts: Number.isFinite(t) && t > 0 ? t : null };
}

/** Every way to pick k of the items, in order. Pure. */
export function combinations<T>(items: T[], k: number): T[][] {
  if (k <= 0 || k > items.length) return [];
  if (k === 1) return items.map((x) => [x]);
  const out: T[][] = [];
  items.forEach((x, i) => {
    for (const rest of combinations(items.slice(i + 1), k - 1)) out.push([x, ...rest]);
  });
  return out;
}

// --------------------------------------------------------------------------- reading the images

export interface VisionSel {
  match: string;
  league: string;
  kickoff: string;
  selection: string;
  market: string;
  odds: string;
}
/** One bet the image shows: a Bet of the Day, an accumulator, a bet builder, or a list to combine by the caption's plan. */
export interface VisionBet {
  name: string;
  shape: "single" | "acca" | "builder" | "multiples";
  /** The advised stake as shown ("5pts", "3 points", "1pt"), else empty. */
  pts: string;
  /** The price shown for the whole bet, else empty. */
  price: string;
  selections: VisionSel[];
}
export interface VisionRead {
  kind: "selections" | "other";
  /** Every selection of every bet, in the order shown. */
  selections: VisionSel[];
  /** The separate bets, when the reader grouped them (several bets can sit in one image). */
  bets?: VisionBet[];
  totalOdds: string;
  stake: string;
  confidence: "high" | "low";
  notes: string;
}

/** Sends the images and a prompt to a vision model and returns its text. Injected, so it can be tested without one. */
export type Vision = (prompt: string, images: Array<{ data: Buffer; mime: string }>) => Promise<string>;

export function visionPrompt(caption: string): string {
  return `You read screenshots a football tipster posted in a private Telegram channel, with this caption:
"""${caption.slice(0, 600)}"""
The images show betting selections (a bookmaker's betslip, a list of picks, a bet builder). One image can hold SEVERAL separate bets (for example a Bet of the Day single and an accumulator of other selections). Return ONLY a JSON object, no other text:
{"kind":"selections" or "other","bets":[{"name":"","shape":"single" or "acca" or "builder" or "multiples","pts":"","price":"","selections":[{"match":"Home v Away","league":"","kickoff":"","selection":"","market":"","odds":""}]}],"confidence":"high" or "low","notes":""}
Rules:
- bets: one entry per separate bet the image shows. shape "single": one selection. "acca": an accumulator whose selections are all in one bet. "builder": several selections in ONE match combined into one bet. "multiples": a plain list of picks that the caption says to combine as doubles/trebles (use this when the image is just a list and the caption sets the staking).
- name: the bet's title as shown, e.g. "Bet of the Day", "Premium BTTS Acca", "Premium Bet Builder".
- pts: the advised stake in points if shown for that bet, e.g. "5pts" (text like "Advised 3 points" counts). Empty if none.
- price: the price shown for the WHOLE bet (best price, e.g. "6.09/1", "4/1", "5.75/1"). Empty if none shown.
- selections: every selection of that bet, once each. Team to win: "<Team> to win". Bookings and cards: the player or team and the market, e.g. selection "Heskey to be carded", market "Player to be carded". odds: that selection's own price as shown (a fraction like 13/8 or decimal like 2.63), else empty. match: "Home v Away" as shown. kickoff: as shown ("22 Nov 15:00") else empty.
- If the image is cropped so that some selections of a bet are cut off, set confidence "low" and say so in notes.
- If the images are not a bet (a result, an advert, a chart, a winning slip), kind is "other" and bets is [].
- confidence is "low" if any text is blurred, cropped or guessed.`;
}

const str = (v: unknown, max = 160) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");

/** The model's reply as a VisionRead, or null when it isn't one. Pure. */
export function parseVision(text: string): VisionRead | null {
  const json = /\{[\s\S]*\}/.exec(text)?.[0];
  if (!json) return null;
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(json) as Record<string, unknown>;
  } catch {
    return null;
  }
  const toSel = (s: unknown): VisionSel => {
    const o = (s ?? {}) as Record<string, unknown>;
    return { match: str(o.match), league: str(o.league), kickoff: str(o.kickoff, 40), selection: str(o.selection), market: str(o.market), odds: str(o.odds, 20) };
  };
  const selsOf = (v: unknown): VisionSel[] => (Array.isArray(v) ? v : []).slice(0, 12).map(toSel).filter((s) => s.selection !== "");
  const bets: VisionBet[] = (Array.isArray(raw.bets) ? raw.bets : [])
    .slice(0, 6)
    .map((b) => {
      const o = (b ?? {}) as Record<string, unknown>;
      const shape: VisionBet["shape"] = o.shape === "single" || o.shape === "acca" || o.shape === "builder" ? o.shape : "multiples";
      return { name: str(o.name, 80), shape, pts: str(o.pts, 30), price: str(o.price, 20), selections: selsOf(o.selections) };
    })
    .filter((b) => b.selections.length > 0);
  // Older shape: a flat list of selections, one price and stake for all.
  const selections = bets.length > 0 ? bets.flatMap((b) => b.selections) : selsOf(raw.selections);
  return {
    kind: raw.kind === "selections" && selections.length > 0 ? "selections" : "other",
    selections,
    ...(bets.length > 0 ? { bets } : {}),
    totalOdds: str(raw.totalOdds, 20),
    stake: str(raw.stake, 40),
    confidence: raw.confidence === "low" ? "low" : "high",
    notes: str(raw.notes, 300),
  };
}

/** Claude's image reading over the plain HTTP API. Needs ANTHROPIC_API_KEY on the engine. */
export function claudeVision(apiKey: string, model = process.env.TIPMAN_VISION_MODEL?.trim() || "claude-sonnet-5-5"): Vision {
  return async (prompt, images) => {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({
        model,
        max_tokens: 1500,
        messages: [{ role: "user", content: [...images.slice(0, 4).map((i) => ({ type: "image", source: { type: "base64", media_type: i.mime, data: i.data.toString("base64") } })), { type: "text", text: prompt }] }],
      }),
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) throw new Error(`Image reading answered ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const body = (await res.json()) as { content?: Array<{ type: string; text?: string }> };
    return (body.content ?? []).filter((c) => c.type === "text").map((c) => c.text ?? "").join("\n");
  };
}

// --------------------------------------------------------------------------- building the bets

/**
 * A Paddy Power betslip link, taken apart: TipMan's link adds every selection of the post to the slip
 * (`...addLegs&leg%3D<market>%7C<selection>%7CSIMPLE_SELECTION%7C%26leg%3D...&lpid=53`), and Paddy Power's slip doesn't offer a
 * double or treble from a longer list, so each bet needs a link of its own with only its legs. Null for any other shape of link.
 */
export function paddyParts(url: string): { prefix: string; legs: string[]; suffix: string } | null {
  const m = /^(.*?addLegs&)(leg%3D[^&]*)(&.*)?$/i.exec(url);
  if (!m) return null;
  const legs = m[2]!.split("%26").filter(Boolean);
  return legs.length > 0 && legs.every((l) => /^leg%3D/i.test(l)) ? { prefix: m[1]!, legs, suffix: m[3] ?? "" } : null;
}

/** The same link with only the legs at these positions (in the order given). Null when the link doesn't split. */
export function paddyLinkFor(url: string, indices: number[]): string | null {
  const p = paddyParts(url);
  if (!p || indices.length === 0 || indices.some((i) => i < 0 || i >= p.legs.length)) return null;
  return p.prefix + indices.map((i) => p.legs[i]!).join("%26") + p.suffix;
}

const legOf = (s: VisionSel, now: Date): TipmanLeg => {
  const { home, away } = sides(s.match);
  return { kickoff: kickoffOf(s.kickoff, now), match: s.match, home, away, league: s.league, selection: s.selection, market: s.market || s.selection, odds: fractionToDecimal(s.odds), ...settleOf(s.selection, s.market || s.selection, home, away), result: null };
};

const matchKey = (l: TipmanLeg) => l.match.toLowerCase().replace(/\s+/g, " ").trim();
const product = (legs: TipmanLeg[]): number | null => (legs.every((l) => l.odds !== null) ? Math.round(legs.reduce((p, l) => p * (l.odds ?? 1), 1) * 100) / 100 : null);

/** "Trixie" for three selections with a double and a treble at the same stake; else the parts in words. */
function groupLabel(parts: StakePart[], n: number, counts: number[]): string {
  const shapes = parts.map((p) => p.shape);
  if (n === 3 && shapes.length === 2 && shapes[0] === "double" && shapes[1] === "treble" && parts[0]!.pts === parts[1]!.pts) return "Trixie";
  return parts.map((p, i) => `${counts[i]} ${p.shape}${counts[i] === 1 ? "" : p.shape === "fourfold" ? "s" : "s"}`).join(" + ");
}

export interface ScreenPost {
  /** The first Telegram message of the post, to make the bets' ids. */
  messageId: number;
  caption: string;
  read: VisionRead;
  /** The post's own betslip links (Betfair first). */
  links: Array<{ label: string; url: string }>;
  now: Date;
}

const BOOK_NAMES: Array<[RegExp, string]> = [
  [/betfair/i, "Betfair"],
  [/paddy/i, "Paddy Power"],
  [/sky/i, "Sky Bet"],
  [/365/i, "bet365"],
  [/mgm/i, "BetMGM"],
];
const booksOf = (links: ScreenPost["links"]): TipmanBook[] => links.slice(0, 6).map((l) => ({ book: BOOK_NAMES.find(([r]) => r.test(`${l.label} ${l.url}`))?.[1] ?? "Other", url: l.url.slice(0, 700), odds: null }));

/** An advised stake as text: "5pts", "3 points", or a bare number. Null when it isn't one. */
function ptsText(t: string): number | null {
  const p = pointsOf(t);
  if (p !== null) return p;
  const bare = /^\s*(\d+(?:\.\d+)?)\s*$/.exec(t);
  return bare && Number(bare[1]) > 0 && Number(bare[1]) <= 20 ? Number(bare[1]) : null;
}

/** The bets a post sets up, as cards. Empty when the images aren't a bet. Pure. */
export function buildScreenCards(post: ScreenPost): TipmanCard[] {
  const { read, now } = post;
  if (read.kind !== "selections" || read.selections.length === 0) return [];
  const bets: Array<{ name: string; shape: VisionBet["shape"]; pts: string; price: string; legs: TipmanLeg[] }> = read.bets?.length
    ? read.bets.map((b) => ({ name: b.name, shape: b.shape, pts: b.pts, price: b.price, legs: b.selections.map((s) => legOf(s, now)) }))
    : [{ name: "", shape: "multiples", pts: read.stake, price: read.totalOdds, legs: read.selections.map((s) => legOf(s, now)) }];
  const several = !!read.bets && read.bets.length > 1;
  const all = bets.flatMap((b) => b.legs);
  const firstLine = post.caption.split("\n").find((l) => l.trim())?.trim() ?? "";
  const plan = parseStakePlan(post.caption);
  const books = booksOf(post.links);
  // Paddy Power's link, split into a link per bet when it has one leg for each selection read (else the slip is left to the owner).
  const padUrl = post.links.find((l) => /paddy/i.test(`${l.label} ${l.url}`))?.url;
  const padLegs = padUrl ? paddyParts(padUrl)?.legs.length : undefined;
  const padOk = !!padUrl && padLegs === all.length;
  const padFor = (set: TipmanLeg[]): string | undefined => (padOk ? (paddyLinkFor(padUrl!, set.map((l) => all.indexOf(l))) ?? undefined) : undefined);
  const first = all.map((l) => l.kickoff).filter((k): k is string => k !== null).sort()[0];
  const common = { tier: "premium" as const, books, day: ukDateOf(first ? new Date(first) : now), firstSeenAt: now.toISOString(), updatedAt: now.toISOString(), result: null, settledAt: null, resultBy: null, source: "screenshot" as const };
  const notes: string[] = [];
  if (read.confidence === "low") notes.push("The reader wasn't sure of everything in the image.");
  if (read.notes) notes.push(read.notes);
  if (all.some((l) => l.odds === null)) notes.push("A selection's price couldn't be read.");
  if (padUrl && !padOk) notes.push(padLegs === undefined ? "Paddy Power's link couldn't be split into a link for each bet, so its slip is the whole post: pick the bet there." : `Paddy Power's link has ${padLegs} selections but ${all.length} were read: its slip is the whole post, so pick the bet there.`);

  const cards: TipmanCard[] = [];
  const counts: number[] = [];
  let planParts: StakePart[] = [];
  bets.forEach((bet, k) => {
    const id = (suffix: string) => `tg${post.messageId}-${read.bets?.length ? `b${k + 1}-` : ""}${suffix}`;
    const legs = bet.legs;
    if (legs.length === 0) return;
    const category = categoryOf(bet.name || firstLine || post.caption, legs);
    const stated = ptsText(bet.pts);
    const priced = fractionToDecimal(bet.price);
    const sameMatch = new Set(legs.map(matchKey)).size === 1;
    // A caption that stakes doubles and a treble ("1pt for all 3 doubles and a 1pt treble") sets up SEPARATE bets even when the
    // selections are all in one match (bookings): Paddy Power can't load a double or treble from a longer list, so each one is its own build.
    const splitByPlan = !several && legs.length >= 2 && legs.length <= 4 && plan.parts.some((p) => p.shape === "double" || p.shape === "treble");
    if (!splitByPlan && (bet.shape === "builder" || (sameMatch && legs.length > 1))) {
      const pts = stated ?? plan.parts[0]?.pts ?? pointsOf(post.caption);
      cards.push({ ...common, id: id("builder"), category: "bet-builder", name: bet.name || CATEGORY_LABEL["bet-builder"], pts: pts ?? 1, ptsAssumed: pts === null, odds: priced, legs, pad: padFor(legs) });
      return;
    }
    if (bet.shape === "single" || (legs.length === 1 && bet.shape !== "multiples")) {
      const pts = stated ?? plan.parts.find((p) => p.shape === "single")?.pts ?? pointsOf(post.caption);
      cards.push({ ...common, id: id("single"), category, name: bet.name || CATEGORY_LABEL[category], pts: pts ?? 1, ptsAssumed: pts === null, odds: priced ?? legs[0]!.odds, legs, pad: padFor(legs) });
      return;
    }
    if (bet.shape === "acca") {
      const pts = stated ?? plan.parts.find((p) => p.shape === "acca")?.pts ?? pointsOf(post.caption);
      const prod = product(legs);
      const odds = priced ?? prod;
      const cropped = priced !== null && prod !== null && Math.abs(prod / priced - 1) > 0.06 ? `The legs read multiply to ${prod.toFixed(2)} but the screenshot's price is ${priced.toFixed(2)}: it may be cropped, with selections missing.` : "";
      cards.push({ ...common, id: id("acca"), category, name: bet.name || `${CATEGORY_LABEL[category]} · accumulator`, pts: pts ?? 1, ptsAssumed: pts === null, odds, legs, pad: padFor(legs), ...(cropped ? { note: cropped } : {}) });
      return;
    }
    // A plain list of picks: combined as the caption's staking says (a Trixie is three doubles and a treble).
    const stakeParts = plan.parts.length > 0 ? plan.parts : [{ shape: legs.length === 1 ? ("single" as const) : ("acca" as const), pts: stated ?? pointsOf(post.caption) ?? 1 }];
    const assumed = plan.parts.length === 0 && stated === null && pointsOf(post.caption) === null;
    planParts = stakeParts;
    for (const part of stakeParts) {
      const sets = part.shape === "acca" ? [legs] : combinations(legs, SIZE[part.shape]).filter((c) => sameMatch || new Set(c.map(matchKey)).size === c.length);
      counts.push(sets.length);
      sets.forEach((set, i) => cards.push({ ...common, id: id(`${part.shape}${i + 1}`), category, name: `${CATEGORY_LABEL[category]} · ${part.shape === "acca" ? "accumulator" : part.shape}`, pts: part.pts, ptsAssumed: assumed, odds: product(set), legs: set, pad: padFor(set) }));
    }
  });
  if (cards.length === 0) return [];
  const totalPts = Math.round(cards.reduce((t, c) => t + c.pts, 0) * 100) / 100;
  const label = several ? bets.map((b, i) => b.name || `Bet ${i + 1}`).join(" + ") : planParts.length > 0 && plan.parts.length > 0 ? groupLabel(planParts, bets[0]!.legs.length, counts) : cards.length === 1 ? CATEGORY_LABEL[cards[0]!.category] : "Bets";
  if (!several && plan.totalPts !== null && Math.abs(plan.totalPts - totalPts) > 0.01) notes.push(`The caption says ${plan.totalPts}pt in total but these selections make ${totalPts}pt: check them.`);
  const group = cards.length > 1 ? { id: `tg${post.messageId}-group`, label, totalPts, bets: cards.length } : undefined;
  const shared = notes.join(" ");
  // A bet of its own gets its own Paddy Power link; the other bookmakers' links add the whole post, so they aren't kept on a part of it.
  return cards.map((c) => ({ ...c, ...(group ? { group } : {}), note: [shared, c.note].filter(Boolean).join(" ") || undefined, books: c.pad ? [{ book: "Paddy Power", url: c.pad, odds: null }] : c.books }));
}

/** One phone notification for a post's bets: what it is, the stake in all, and a tap that opens Betfair's betslip. */
export async function notifyScreenPost(db: EngineDb, cards: TipmanCard[], _links: ScreenPost["links"] = []): Promise<void> {
  const first = cards[0];
  if (!first) return;
  const label = first.group?.label ?? CATEGORY_LABEL[first.category];
  const total = first.group?.totalPts ?? first.pts;
  const legs = [...new Map(cards.flatMap((c) => c.legs).map((l) => [`${l.match}|${l.selection}`, l] as const)).values()];
  await sendPush(db, {
    title: `TipMan Premium: ${label}, ${total}pt: send to bet?`,
    body: `${legs.map((l) => l.selection).join(" · ")}. Read from a screenshot: check the legs. Tap for the ${cards.length === 1 ? "bet" : `${cards.length} bets`} to open in Paddy Power.`.slice(0, 220),
    url: `/more/admin/tipman#${first.group?.id ?? first.id}`,
    tag: `tipman-${first.group?.id ?? first.id}`,
  });
}
