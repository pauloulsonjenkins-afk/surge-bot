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
export interface VisionRead {
  kind: "selections" | "other";
  selections: VisionSel[];
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
The images show betting selections (a bookmaker's betslip, a list of picks, or a bet builder). Return ONLY a JSON object, no other text:
{"kind":"selections" or "other","selections":[{"match":"Home v Away","league":"","kickoff":"","selection":"","market":"","odds":""}],"totalOdds":"","stake":"","confidence":"high" or "low","notes":""}
Rules:
- selections: every selection shown, once each, even if it appears in several images. Team to win: "<Team> to win". Bookings and cards: the player or team and the market, e.g. selection "Heskey to be carded", market "Player to be carded".
- match: "Home v Away" as shown. If a selection shows no match, give your best reading and say so in notes.
- odds: that selection's price exactly as shown, a fraction like 13/8 or a decimal like 2.63. Empty if not shown.
- kickoff: as shown, e.g. "22 Nov 15:00", else empty.
- totalOdds: the combined, accumulator or bet builder price if shown. stake: the stake text if shown, e.g. "£10" or "1pt".
- If the images are not a bet (a result, an advert, a chart, a winning slip), kind is "other" and selections is [].
- confidence is "low" if any text is blurred, cropped or you had to guess.`;
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
  const sels = Array.isArray(raw.selections) ? raw.selections : [];
  const selections = sels
    .slice(0, 12)
    .map((s) => {
      const o = (s ?? {}) as Record<string, unknown>;
      return { match: str(o.match), league: str(o.league), kickoff: str(o.kickoff, 40), selection: str(o.selection), market: str(o.market), odds: str(o.odds, 20) };
    })
    .filter((s) => s.selection !== "");
  return {
    kind: raw.kind === "selections" && selections.length > 0 ? "selections" : "other",
    selections,
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

/** The bets a post sets up, as cards. Empty when the images aren't a bet. Pure. */
export function buildScreenCards(post: ScreenPost): TipmanCard[] {
  const { read, now } = post;
  if (read.kind !== "selections" || read.selections.length === 0) return [];
  const legs = read.selections.map((s) => legOf(s, now));
  const firstLine = post.caption.split("\n").find((l) => l.trim())?.trim() ?? "";
  const category = categoryOf(firstLine || post.caption, legs);
  const plan = parseStakePlan(post.caption);
  const books = booksOf(post.links);
  const first = legs.map((l) => l.kickoff).filter((k): k is string => k !== null).sort()[0];
  const common = { tier: "premium" as const, books, day: ukDateOf(first ? new Date(first) : now), firstSeenAt: now.toISOString(), updatedAt: now.toISOString(), result: null, settledAt: null, resultBy: null, source: "screenshot" as const };
  const notes: string[] = [];
  if (read.confidence === "low") notes.push("The reader wasn't sure of everything in the image.");
  if (read.notes) notes.push(read.notes);
  if (legs.some((l) => l.odds === null)) notes.push("A price couldn't be read, so the combined price is missing.");
  const note = notes.join(" ") || undefined;
  const id = (suffix: string) => `tg${post.messageId}-${suffix}`;

  // Every selection in one match: one bet builder at the price shown.
  const sameMatch = new Set(legs.map(matchKey)).size === 1;
  if (sameMatch && legs.length > 1) {
    const pts = plan.parts[0]?.pts ?? pointsOf(read.stake) ?? pointsOf(post.caption);
    return [{ ...common, id: id("builder"), category: "bet-builder", name: CATEGORY_LABEL["bet-builder"], pts: pts ?? 1, ptsAssumed: pts === null, odds: fractionToDecimal(read.totalOdds), legs, note }];
  }

  const plans = plan.parts.length > 0 ? plan.parts : [{ shape: legs.length === 1 ? ("single" as const) : ("acca" as const), pts: pointsOf(post.caption) ?? 1 }];
  const assumed = plan.parts.length === 0 && pointsOf(post.caption) === null;
  const cards: TipmanCard[] = [];
  const counts: number[] = [];
  for (const part of plans) {
    const sets = part.shape === "acca" ? [legs] : combinations(legs, SIZE[part.shape]).filter((c) => new Set(c.map(matchKey)).size === c.length);
    counts.push(sets.length);
    sets.forEach((set, i) => cards.push({ ...common, id: id(`${part.shape}${i + 1}`), category, name: `${CATEGORY_LABEL[category]} · ${part.shape === "acca" ? "accumulator" : part.shape}`, pts: part.pts, ptsAssumed: assumed, odds: product(set), legs: set, note }));
  }
  if (cards.length === 0) return [];
  const totalPts = Math.round(cards.reduce((t, c) => t + c.pts, 0) * 100) / 100;
  const label = plan.parts.length > 0 ? groupLabel(plans, legs.length, counts) : cards.length === 1 ? CATEGORY_LABEL[category] : "Bets";
  if (plan.totalPts !== null && Math.abs(plan.totalPts - totalPts) > 0.01) notes.push(`The caption says ${plan.totalPts}pt in total but these selections make ${totalPts}pt: check them.`);
  const group = { id: id("group"), label, totalPts, bets: cards.length };
  const finalNote = notes.join(" ") || undefined;
  return cards.map((c) => ({ ...c, group, note: finalNote }));
}

/** One phone notification for a post's bets: what it is, the stake in all, and a tap that opens Betfair's betslip. */
export async function notifyScreenPost(db: EngineDb, cards: TipmanCard[], links: ScreenPost["links"]): Promise<void> {
  const first = cards[0];
  if (!first) return;
  const label = first.group?.label ?? CATEGORY_LABEL[first.category];
  const total = first.group?.totalPts ?? first.pts;
  const legs = [...new Map(cards.flatMap((c) => c.legs).map((l) => [`${l.match}|${l.selection}`, l] as const)).values()];
  const betfair = links.find((l) => /betfair/i.test(`${l.label} ${l.url}`));
  await sendPush(db, {
    title: `TipMan Premium: ${label}, ${total}pt: send to bet?`,
    body: `${legs.map((l) => l.selection).join(" · ")}. Read from a screenshot: check the legs. Tap to open the Betfair betslip.`.slice(0, 220),
    url: betfair?.url ?? "/more/admin/tipman",
    tag: `tipman-${first.group?.id ?? first.id}`,
  });
}
