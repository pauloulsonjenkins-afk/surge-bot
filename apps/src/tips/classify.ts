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
// Later words may carry digits: "Tai Po U22 vs Hong Kong FC U22" (Both Teams to Score, 9 Nov 2026).
// Curly apostrophes count as part of a name: "ST-OUEN L’AUMÔNE VS BOULOGNE" read as "AUMÔNE v BOULOGNE" (14 Nov 2026).
const FIXTURE = /([A-Z][\p{L}.'’&-]+(?:[ \t][\p{L}\p{N}.'’&-]+){0,3})[ \t]+(?:vs\.?|VS\.?|v\.?|V\.?|-|–|—|x)[ \t]+([A-Z][\p{L}.'’&-]+(?:[ \t][\p{L}\p{N}.'’&-]+){0,3})/gu;
/**
 * Words no team has. "Add to betslip - Betfair", "TOP ACCA — STAKE 10", "FREE vs VIP" and "BOTD - Best Odds 47" were all
 * read as matches (14 Nov 2026), which made adverts look like half a tip.
 */
const NOT_A_TEAM = /\b(cashe+d|goals|betslip|betfair|paddy\s?power|bet365|odds|stakes?|acca|free|vip|premium|botd|freebies?|winners?|loss(es)?|profit|bookie|what|returns?)\b/i;

/** The first pair of names in the text that could be two teams. */
function fixtureIn(text: string): [string, string] | null {
  for (const m of text.matchAll(FIXTURE)) {
    const home = homeTeam(m[1]!);
    const away = awayTeam(m[2]!);
    if (home && away && !NOT_A_TEAM.test(home) && !NOT_A_TEAM.test(away)) return [home, away];
  }
  return null;
}
const DECIMAL_ODDS = /(?:@\s*|\bodds?\b[:\s]*|\bprice\b[:\s]*|\bat\b\s*)(\d{1,2}\.\d{1,3})\b|\b(\d{1,2}\.\d{2})\b/i;
// ...or a fraction that starts a line: "4/6 - 5 points advised" (TipMan InPlays).
const FRACTION_ODDS = /(?:@\s*|\bodds?\b[:\s]*|\bat\b\s*)(\d{1,3})\s?\/\s?(\d{1,3})\b|^[ \t]*(\d{1,3})\/(\d{1,3})\b(?=.*\b(?:points?|pts?|units?|advised)\b)/im;
const STAKE = /\b(\d+(?:\.\d+)?)\s?(units?|u|pts?|points?|stars?)\b|\bstake[:\s]+(\d[^\n]{0,15})/i;
const TIP_LABEL = /\b(tip|bet|pick|selection|prediction|our (?:bet|pick)|today'?s (?:bet|tip|pick))\b\s*[:\-–]/i;
const BRAG =
  /\b(cashe+d|cash(ed)? out|delivered|secured|smashed|landed|collected|compensation|bo+m+|another (big )?(green|win|winner)|(wins|won|has won|did it|banked|profit(s)?|winner)\b(?! at))\b|\b(wins|won) the\b|\bwinner\b/i;
/** Wording that looks ahead to a match not yet played: a kick-off time, "is here", "we're backing". It outweighs boasting words in the same post. */
// "10:30 AM UK" and "FIRST FREEBIE OF THE DAY" are both forward-looking: a "PROFIT: £285.71" line in the same post is the
// stake maths, not a boast (Both Teams to Score, 9 Nov 2026).
// Live tips look ahead too, and were all being thrown out as celebrations (14 Nov 2026): CVPICKS's "LIVE PICK ALERT!!!"
// for its exclamation marks, PRIME BET's "🔴LIVE ... I’m backing Over 1.0 goals" for "Hungary won the reverse fixture".
const FORWARD =
  /\bis here\b|we[’']?re backing|we back\b|i[’']?m (backing|going with)|\d{1,2}[:.]\d{2}\s*(?:[ap]\.?m\.?\s*)?(uk|eu|gmt|bst|cet)\b|kick[- ]?off (time|at)|\bstarts? (at|in)\b|today[’']?s (bet|tip|pick)|(free )?bet of the day|freebie of the day|live pick|🔴\s*live|\d{1,3}(st|nd|rd|th) minute|current score|in-?play (single|double|bet)|rolling challenge/i;
/** An update on a tip already posted (a reminder, a half-time report, a recap): never a new tip, whatever else it says. */
const UPDATE = /starting soon|almost underway|half[- ]?time update|full[- ]?time update|\brecap\b|kicks? off soon/i;
const RESULT_ONLY = /^\s*(?:[✅❌✔️❎🟢🔴]|won|lost|win|loss|void)\b|\bresult[s]?\b[:\s]/i;

function oddsFrom(text: string): number | null {
  const d = DECIMAL_ODDS.exec(text);
  const dec = d ? Number(d[1] ?? d[2]) : NaN;
  if (Number.isFinite(dec) && dec > 1 && dec < 100) return dec;
  const f = FRACTION_ODDS.exec(text);
  if (f) {
    const n = Number(f[1] ?? f[3]);
    const dd = Number(f[2] ?? f[4]);
    if (dd > 0) return Math.round((1 + n / dd) * 100) / 100;
  }
  return null;
}

/** A line that states a bet outright. */
const BARE_BET = /\b(to win|over \d|under \d|btts|both teams to score|or draw|draw or|double chance|handicap|1x|x2)\b/i;

/**
 * The home team without the words that led into it: "BTTS YES in Plymouth Parkway vs …" and "backing Arsenal v …" name
 * Plymouth Parkway and Arsenal (Both Teams to Score, 9 Nov 2026). The connecting words are lower case; team names aren't.
 */
function homeTeam(raw: string): string {
  return raw.replace(/^.*\s(?:in|on|for|with|backing)\s+(?=\S)/, "").trim();
}

/** The away team without a price or score after it: "Berkhamsted at 8/13 odds" is Berkhamsted. */
function awayTeam(raw: string): string {
  return raw.replace(/\s+(?:at|@)\s*\d.*$/i, "").replace(/[,.!]+$/, "").trim();
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
  const fx = fixtureIn(t);
  const match = fx ? `${fx[0]} v ${fx[1]}` : null;
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
  // The label must start its line: "...the main argument behind this pick: Albacete regularly face stronger opposition"
  // is a sentence of the write-up, and was taken as PRIME BET's bet (12 Nov 2026), so none of its tips could be read.
  const lab = /^[^\p{L}\n]*(?:tip|bet|pick|selection|prediction)\s*[:\-–]\s*([^\n]{2,80})/imu.exec(t);
  if (lab) selection = lab[1]!.trim();
  else {
    const lines = t.split("\n").map((l) => l.trim());
    // A short line stating the bet comes first ("✅ BOTH TEAMS TO SCORE – YES", "GANGWON FC TO WIN" with the price on its
    // own line). Only then a line with a market word and a number: in an analysis that can be "Averaging 3.25 goals
    // scored at home" (Brighton v Brentford, 8 Nov 2026), so it is the fallback.
    const bare = lines.find((l) => l.length <= 60 && BARE_BET.test(l) && !/^[-•]/.test(l));
    const priced = lines.find((l) => l && MARKET_WORDS.test(l) && oddsFrom(l) !== null);
    const both = lines.find((l) => l && BARE_BET.test(l) && oddsFrom(l) !== null);
    const line = both ?? bare ?? priced;
    if (line) selection = line.slice(0, 80);
  }

  if (UPDATE.test(t)) {
    return { verdict: advert > 1 ? "advert" : "other", reasons: ["an update on a tip already posted, not a new one"], match, selection: null, odds, stake: null };
  }

  // A celebration of a bet already won ("CASHED!!!", "KUPS WINS THE FIRST HALF", "compensation delivered") is advertising,
  // however much it looks like a tip: it names the match, the market and the price, but the match is over.
  // A headline that boasts ("STAKE 50 CASHEEEED!!!") settles it, whatever looks forward further down.
  const headline = t.split("\n").find((l) => l.trim()) ?? "";
  if (BRAG.test(headline) || (!FORWARD.test(t) && (BRAG.test(t) || (t.match(/!/g) ?? []).length >= 4))) {
    // Selling as well as boasting ("guaranteed wins, join VIP") is an advert; boasting alone is just other.
    return { verdict: advert > 0 ? "advert" : "other", reasons: [...reasons.filter((x) => ADVERT_PATTERNS.some(([, why]) => why === x)), "celebrates a bet already won, so it isn't a new tip"], match, selection: null, odds, stake: null };
  }

  if (RESULT_ONLY.test(t) && odds === null && !labelled) {
    return { verdict: "other", reasons: ["reads as a result, not a tip"], match, selection: null, odds: null, stake: null };
  }

  // A tip needs a match, a way to bet it, and a price. Without all three it is only worth a look. A post that names the
  // match and states the bet outright ("QINGDAO WEST COAST TO WIN") needs no price: it is priced from Betfair when
  // tracked, and some channels (Both Teams to Score, 3 Nov 2026) never quote one.
  const stated = match !== null && selection !== null && BARE_BET.test(selection);
  const looksLikeBet = (match !== null || labelled) && (market || labelled) && (odds !== null || stated);
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
