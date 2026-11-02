/**
 * Free tip channels (2 Nov 2026): tells a real free bet from the premium adverts that fill the same channels.
 *
 * Nothing here places a bet and nothing is learned from a channel: each message is scored on its own wording. A real
 * tip names a match (or a team), says what to back, and gives a price. An advert sells a service (VIP, premium, join,
 * a link, "guaranteed"). Both can appear in one message (a tip with a "join VIP" footer), so they are scored separately:
 *
 *   - "tip"    a match, a selection or market, and a price, with little or no selling;
 *   - "maybe"  looks like a tip but is mixed with selling, or is missing its price or match: the page asks the owner;
 *   - "advert" selling with no bet in it;
 *   - "other"  chatter, results, greetings.
 *
 * The owner's own corrections (Tip / Not a tip on the page) are stored beside the verdict and always win.
 */

export type TipVerdict = "tip" | "maybe" | "advert" | "other";

export interface TipRead {
  verdict: TipVerdict;
  /** Plain reasons, shown on the page so a wrong call is easy to understand. */
  reasons: string[];
  match: string | null;
  selection: string | null;
  odds: number | null;
  /** The stake the channel suggests ("2 units", "1pt"), as written. */
  stake: string | null;
}

/** Selling words. Each match adds to the advert score. */
const ADVERT_PATTERNS: Array<[RegExp, string]> = [
  [/\b(vip|premium|exclusive group|private group|paid group)\b/i, "mentions VIP or premium"],
  [/\b(join|subscribe|subscription|membership|upgrade)\b/i, "asks you to join or subscribe"],
  [/\b(dm|pm|message|contact|whatsapp)\s+(me|us|admin|@)/i, "asks you to message them"],
  [/\bt\.me\/|https?:\/\/|www\.|\.com\b|\.co\.uk\b/i, "has a link"],
  [/\b(guaranteed|guarantee|100\s?%|sure\s?(win|thing)|fixed\s?match(es)?|insider|leaked)\b/i, "promises a sure win"],
  [/\b(discount|offer|limited (spots|places|time)|only \d+ (spots|places)|% off|promo|bonus|sign\s?up|register|welcome offer)\b/i, "a promotion or bonus"],
  [/\b(price|£\s?\d+\s?(a|per)\s?(week|month)|\$\s?\d+\s?(a|per)\s?(week|month)|per month|per week|lifetime)\b/i, "quotes a price for a service"],
  [/\b(profit|profits|won|winning)\s+(proof|screenshot|record)|\bproof\b|\bscreenshots?\b/i, "shows 'proof' of winnings"],
  [/\b(18\+|gamble responsibly|begambleaware|t&cs? apply)\b/i, "gambling-advert small print"],
];

/** Words that appear in real tips. */
const MARKET_WORDS =
  /\b(over|under|btts|both teams to score|to win|win|draw|double chance|1x|x2|12|handicap|ah|asian|corners?|cards?|goals?|clean sheet|first half|1st half|second half|2nd half|dnb|draw no bet|anytime|scorer|acca|accumulator|lay|back)\b/i;
const FIXTURE = /([A-Z][\p{L}.'&-]+(?:[ \t][\p{L}.'&-]+){0,3})[ \t]+(?:vs\.?|VS\.?|v\.?|V\.?|-|–|—|x)[ \t]+([A-Z][\p{L}.'&-]+(?:[ \t][\p{L}.'&-]+){0,3})/u;
const DECIMAL_ODDS = /(?:@\s*|\bodds?\b[:\s]*|\bprice\b[:\s]*|\bat\b\s*)(\d{1,2}\.\d{1,3})\b|\b(\d{1,2}\.\d{2})\b/i;
const FRACTION_ODDS = /(?:@\s*|\bodds?\b[:\s]*|\bat\b\s*)(\d{1,3})\s?\/\s?(\d{1,3})\b/i;
const STAKE = /\b(\d+(?:\.\d+)?)\s?(units?|u|pts?|points?|stars?)\b|\bstake[:\s]+(\d[^\n]{0,15})/i;
const TIP_LABEL = /\b(tip|bet|pick|selection|prediction|our (?:bet|pick)|today'?s (?:bet|tip|pick))\b\s*[:\-–]/i;
const BRAG =
  /\b(cashe+d|cash(ed)? out|delivered|secured|smashed|landed|collected|compensation|bo+m+|another (big )?(green|win|winner)|(wins|won|has won|did it|banked|profit(s)?|winner)\b(?! at))\b|\b(wins|won) the\b|\bwinner\b/i;
/** Wording that looks ahead to a match not yet played: a kick-off time, "is here", "we're backing". It outweighs boasting words in the same post. */
const FORWARD = /\bis here\b|we'?re backing|we back\b|\d{1,2}[:.]\d{2}\s*(uk|eu|gmt|bst|cet)\b|kick[- ]?off (time|at)|\bstarts? (at|in)\b|today'?s (bet|tip|pick)|(free )?bet of the day/i;
const RESULT_ONLY = /^\s*(?:[✅❌✔️❎🟢🔴]|won|lost|win|loss|void)\b|\bresult[s]?\b[:\s]/i;

function oddsFrom(text: string): number | null {
  const d = DECIMAL_ODDS.exec(text);
  const dec = d ? Number(d[1] ?? d[2]) : NaN;
  if (Number.isFinite(dec) && dec > 1 && dec < 100) return dec;
  const f = FRACTION_ODDS.exec(text);
  if (f) {
    const n = Number(f[1]);
    const dd = Number(f[2]);
    if (dd > 0) return Math.round((1 + n / dd) * 100) / 100;
  }
  return null;
}

/** Reads one message. Pure: the same text always gives the same answer. */
export function classifyTip(text: string): TipRead {
  const t = text.trim();
  const reasons: string[] = [];
  const empty: TipRead = { verdict: "other", reasons, match: null, selection: null, odds: null, stake: null };
  if (!t) return empty;

  // Selling
  let advert = 0;
  for (const [re, why] of ADVERT_PATTERNS) {
    if (re.test(t)) {
      advert++;
      reasons.push(why);
    }
  }

  // The bet itself
  const fx = FIXTURE.exec(t);
  const match = fx ? `${fx[1]!.trim()} v ${fx[2]!.trim()}` : null;
  const odds = oddsFrom(t);
  const market = MARKET_WORDS.test(t);
  const labelled = TIP_LABEL.test(t);
  const stakeMatch = STAKE.exec(t);
  const stake = stakeMatch ? stakeMatch[0].trim() : null;
  let bet = 0;
  if (match) {
    bet++;
    reasons.push(`names a match (${match})`);
  }
  if (market) {
    bet++;
    reasons.push("names a market");
  }
  if (odds !== null) {
    bet++;
    reasons.push(`gives a price (${odds})`);
  }
  if (labelled) {
    bet++;
    reasons.push("labelled as a tip or bet");
  }
  if (stake) reasons.push(`suggests a stake (${stake})`);

  // The selection: the line after a "Tip:" style label, else the line that carries the market and the price.
  let selection: string | null = null;
  const lab = /(?:tip|bet|pick|selection|prediction)\s*[:\-–]\s*([^\n]{2,80})/i.exec(t);
  if (lab) selection = lab[1]!.trim();
  else {
    const line = t.split("\n").map((l) => l.trim()).find((l) => l && MARKET_WORDS.test(l) && oddsFrom(l) !== null);
    if (line) selection = line.slice(0, 80);
    else {
      // "GANGWON FC TO WIN" with the price on its own line ("ODDS @1.48"): the line that names the bet.
      const bare = t.split("\n").map((l) => l.trim()).find((l) => l.length <= 60 && /\b(to win|over \d|under \d|btts|both teams to score)\b/i.test(l));
      if (bare) selection = bare;
    }
  }

  // A celebration of a bet already won ("CASHED!!!", "KUPS WINS THE FIRST HALF", "compensation delivered") is advertising,
  // however much it looks like a tip: it names the match, the market and the price, but the match is over.
  if (!FORWARD.test(t) && (BRAG.test(t) || (t.match(/!/g) ?? []).length >= 4)) {
    // Selling as well as boasting ("guaranteed wins, join VIP") is an advert; boasting alone is just other.
    return { verdict: advert > 0 ? "advert" : "other", reasons: [...reasons.filter((x) => ADVERT_PATTERNS.some(([, why]) => why === x)), "celebrates a bet already won, so it isn't a new tip"], match, selection: null, odds, stake: null };
  }

  if (RESULT_ONLY.test(t) && odds === null && !labelled) {
    return { verdict: "other", reasons: ["reads as a result, not a tip"], match, selection: null, odds: null, stake: null };
  }

  // A tip needs a match, a way to bet it, and a price. Without all three it is only worth a look.
  const looksLikeBet = (match !== null || labelled) && (market || labelled) && odds !== null;
  let verdict: TipVerdict;
  if (looksLikeBet && advert === 0) verdict = "tip";
  else if (looksLikeBet && advert <= 2) {
    verdict = "maybe";
    reasons.push("a tip, but mixed with selling");
  } else if (looksLikeBet) {
    verdict = "advert";
    reasons.push("mostly selling");
  } else if (advert >= 1 && bet <= 1) verdict = "advert";
  else if (bet >= 2) {
    verdict = "maybe";
    reasons.push("part of a bet is missing (match, market or price)");
  } else verdict = "other";

  // A long message full of selling is an advert even when it quotes an example price.
  if (verdict === "maybe" && advert >= 3) verdict = "advert";

  return { verdict, reasons, match, selection, odds, stake };
}
