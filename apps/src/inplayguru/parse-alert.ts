/**
 * Turns the raw text of one Telegram alert into structured fields.
 *
 * Written from real alerts (Chile Cup / Liga MX Femenil samples), not guessed:
 *  - line 1 is the strategy name, with emojis in front (and sometimes a
 *    bracketed note, e.g. "Both Teams to Score (Favorite conceded first)")
 *  - then a league line, a teams line ("A vs B"), a row of form emojis
 *  - then "Label: home - away" stat lines. Some alerts carry many stats
 *    (xG, key passes...), some carry few, so EVERY stat is optional.
 *  - odds are a label line followed by a line of numbers
 *  - after full time Telegram EDITS the same message to add a Match Summary
 *    (half-time score, full-time score, and a Hit/Miss tick)
 *
 * SAFETY RULE: this file only describes the pick. It never decides to place
 * a bet. `sendable` is only ever true when every check below passes, and the
 * checks are deliberately strict: a wrong guess here would become a wrong
 * order later, so anything doubtful is flagged instead.
 */

export type MarketCode =
  | "NEXT_GOAL"
  | "BOTH_TEAMS_TO_SCORE"
  | "FIRST_HALF_CORNERS"
  | "UNDERDOG_DOUBLE_CHANCE"
  | "FAVOURITE_TO_WIN"
  | "FIRST_HALF_GOALS";

export type PickResult = "hit" | "miss";

export interface ParsedAlert {
  /** Top line with emojis stripped, e.g. "Blistering Momentum / Action-packed OJ". */
  strategyRaw: string;
  /** Lower-case name used for the strategy table, bracketed note removed. */
  strategyKey: string;
  /** Which strategy names were found, split on "/". */
  strategyParts: string[];
  market: MarketCode | null;
  /** For the underdog strategy: which side is the underdog (the longer pre-match price). Null for every other strategy. */
  underdog: "home" | "away" | null;
  /** For "Pass Master 1st half": which side is the favourite (the shorter live 1X2 price in the alert), backed in Match Odds. Null for every other strategy. */
  favourite: "home" | "away" | null;
  /** Human wording of the bet, e.g. "Over 1.5" or "Yes". Null when unmapped. */
  selection: string | null;
  /** The line a bet targets: goals + 0.5 for Next Goal, corners so far + 0.5 for 1st half corners, 0.5 for 1st half goals. */
  targetLine: number | null;
  /** The "Kickoff: In 1 hour" line of a pre-match alert, as written. Null when the alert has none. */
  kickoffRaw: string | null;

  competition: string | null;
  /** Country from the flag emoji on the league line ("Argentina"). Null for the globe (international) or no flag. */
  country: string | null;
  positions: string | null;
  home: string | null;
  away: string | null;

  timerRaw: string | null;
  minute: number | null;
  lastGoal: string | null;
  goalsHome: number | null;
  goalsAway: number | null;

  /** Every "Label: a - b" stat found, keyed by label, e.g. stats["Momentum"] = [68, 32]. */
  stats: Record<string, [number, number]>;

  odds: {
    preMatch1x2: [number, number, number] | null;
    live1x2: [number, number, number] | null;
    overUnderLine: number | null;
    over: number | null;
    under: number | null;
  };

  matched: number | null;
  strikeRate: number | null;
  freePick: { n: number; of: number } | null;

  htScore: string | null;
  ftScore: string | null;
  /**
   * Hit or miss. For Next Goal and Both Teams to Score it is worked out from the
   * full-time score, because the alert's own tick has been seen to disagree with
   * the actual bet. Other markets use the alert's tick.
   */
  result: PickResult | null;
  /** What the alert's own Hit/Miss tick said, kept for comparison. */
  alertResult: PickResult | null;
  resultSource: "score" | "alert" | null;

  /** Things that look wrong. Any entry here means the pick must not be sent to bet. */
  flags: string[];
  /** True only when the pick is complete, recognised, consistent and still unsettled. */
  sendable: boolean;
}

/** Strategy name (lower case, no bracketed note) -> market. Order matters: first match wins. */
const STRATEGY_MARKETS: Array<{ test: RegExp; market: MarketCode }> = [
  { test: /both teams to score/, market: "BOTH_TEAMS_TO_SCORE" },
  // "1st Half Corners", "First Half Corner", "1H Corners", "Corners 1st Half" ...
  { test: /\b(?:first|1st|1h)\b[^/]*\bcorners?\b|\bcorners?\b[^/]*\b(?:first|1st|1h)\b/, market: "FIRST_HALF_CORNERS" },
  // "Underdog taking charge action" backs the underdog to win or draw. This must come before the
  // "momentum" / "action" rules below, which would otherwise read it as an Over goals bet.
  { test: /\bunderdog\b/, market: "UNDERDOG_DOUBLE_CHANCE" },
  // "First Half Goal": a PRE-MATCH alert (no timer, no score) backing Over 0.5 goals in the first half.
  { test: /\b(?:first|1st|1h)\s*half\s+goals?\b/, market: "FIRST_HALF_GOALS" },
  // "Time to fight": Over the next goal, the same bet as Momentum (line = goals so far + 0.5).
  { test: /time to fight/, market: "NEXT_GOAL" },
  // "Pass Master 1st half": back the favourite (shortest live price) in Match Odds.
  { test: /pass master 1st half/, market: "FAVOURITE_TO_WIN" },
  { test: /momentum/, market: "NEXT_GOAL" },
  { test: /action/, market: "NEXT_GOAL" },
];

// Emoji, flags, arrows, dingbats, variation selectors: everything that is
// decoration rather than text on the strategy line.
const DECORATION = /[\p{Extended_Pictographic}\p{Regional_Indicator}\uFE0F\u200D]/gu;

const REGIONAL_A = 0x1f1e6;
const REGIONAL_Z = 0x1f1ff;
const UK_NATIONS: Record<string, string> = { gbeng: "England", gbsct: "Scotland", gbwls: "Wales" };

let regionNames: Intl.DisplayNames | null = null;
function regionName(code: string): string | null {
  try {
    regionNames ??= new Intl.DisplayNames(["en"], { type: "region" });
    const n = regionNames.of(code);
    return n && n !== code ? n : null;
  } catch {
    return null;
  }
}

/** Reads a leading flag emoji: two regional-indicator letters (Argentina), or the England / Scotland / Wales flags. */
export function countryFromFlag(line: string): string | null {
  const cps = Array.from(line.trim()).map((c) => c.codePointAt(0) ?? 0);
  const a = cps[0] ?? 0;
  const b = cps[1] ?? 0;
  if (a >= REGIONAL_A && a <= REGIONAL_Z && b >= REGIONAL_A && b <= REGIONAL_Z) {
    return regionName(String.fromCharCode(65 + a - REGIONAL_A, 65 + b - REGIONAL_A));
  }
  if (a === 0x1f3f4) {
    let tag = "";
    for (let i = 1; i < cps.length; i++) {
      const c = cps[i] ?? 0;
      if (c >= 0xe0020 && c <= 0xe007e) tag += String.fromCharCode(c - 0xe0000);
      else break;
    }
    return UK_NATIONS[tag] ?? null;
  }
  return null;
}

/** Finds the country in a stored alert's raw text, so alerts saved before this field existed can be read too. */
export function leagueCountryFromText(text: string): string | null {
  const lines = text
    .replace(/\r/g, "")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  for (let i = 1; i < lines.length; i++) {
    const l = lines[i] ?? "";
    if (l.includes(":")) continue;
    if (/ vs /i.test(l.replace(/\([^)]*\)/g, ""))) return countryFromFlag(lines[i - 1] ?? "");
  }
  return null;
}

function num(s: string | undefined): number | null {
  if (s === undefined) return null;
  const n = Number(s.replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

function triple(line: string | undefined): [number, number, number] | null {
  if (!line) return null;
  const parts = line.trim().split(/\s+/).map((p) => num(p));
  if (parts.length !== 3) return null;
  const [a, b, c] = parts;
  return a != null && b != null && c != null ? [a, b, c] : null;
}

function pair(line: string | undefined): [number, number] | null {
  if (!line) return null;
  const parts = line.trim().split(/\s+/).map((p) => num(p));
  if (parts.length !== 2) return null;
  const [a, b] = parts;
  return a != null && b != null ? [a, b] : null;
}

/**
 * True for a real alert, as opposed to a welcome message or announcement: two team names, and either a match
 * timer (in-play alerts) or a Kickoff line (pre-match alerts such as "First Half Goal"). The Telegram listener
 * and its catch-up sync both use this to decide what becomes a pick.
 */
export function isRealAlert(p: Pick<ParsedAlert, "home" | "away" | "minute" | "kickoffRaw">): boolean {
  return Boolean(p.home && p.away && (p.minute !== null || p.kickoffRaw !== null));
}

export function parseAlert(text: string): ParsedAlert {
  const flags: string[] = [];
  const lines = text
    .replace(/\r/g, "")
    .split("\n")
    .map((l) => l.trim());
  const nonEmpty = lines.filter((l) => l.length > 0);

  // ---- strategy (line 1) ----
  const headerLine = (nonEmpty[0] ?? "").replace(DECORATION, "").replace(/\s+/g, " ").trim();
  const strategyRaw = headerLine;
  const strategyKey = headerLine.replace(/\([^)]*\)/g, "").replace(/\s+/g, " ").trim().toLowerCase();
  const strategyParts = strategyKey
    .split("/")
    .map((p) => p.trim())
    .filter(Boolean);
  if (!strategyKey) flags.push("No strategy name found on the first line.");
  const market = STRATEGY_MARKETS.find((s) => s.test.test(strategyKey))?.market ?? null;

  // ---- league + teams ----
  let competition: string | null = null;
  let country: string | null = null;
  let positions: string | null = null;
  let home: string | null = null;
  let away: string | null = null;

  // The league line also contains " vs " inside its brackets, e.g. "(1st vs 2nd)",
  // so the teams line is the first later line that has " vs " OUTSIDE brackets.
  let teamsLine: string | null = null;
  let leagueLine: string | null = null;
  for (let i = 1; i < nonEmpty.length; i++) {
    const l = nonEmpty[i] ?? "";
    if (l.includes(":")) continue;
    const outsideBrackets = l.replace(/\([^)]*\)/g, "");
    if (/ vs /i.test(outsideBrackets)) {
      teamsLine = l;
      leagueLine = nonEmpty[i - 1] ?? null;
      break;
    }
  }

  if (teamsLine) {
    const [h, a] = teamsLine.split(/ vs /i);
    home = h?.trim() || null;
    away = a?.trim() || null;
  }
  if (!home || !away) flags.push("Could not read the two team names.");

  if (leagueLine) {
    country = countryFromFlag(leagueLine);
    const cleaned = leagueLine.replace(DECORATION, "").trim();
    const m = cleaned.match(/^(.*?)(?:\s*\(([^()]*)\))?$/);
    competition = m?.[1]?.trim() || null;
    positions = m?.[2]?.trim() || null;
  }

  // ---- timer / last goal ----
  let timerRaw: string | null = null;
  let minute: number | null = null;
  /** Minute without stoppage time, so "45+2'" is still 45 (first half). */
  let baseMinute: number | null = null;
  let lastGoal: string | null = null;
  for (const l of lines) {
    const t = l.match(/^Timer:\s*(.+)$/i);
    if (t?.[1]) {
      timerRaw = t[1].trim();
      const mm = timerRaw.match(/^(\d+)(?:\s*\+\s*(\d+))?/);
      if (mm?.[1]) {
        baseMinute = Number(mm[1]);
        minute = baseMinute + (mm[2] ? Number(mm[2]) : 0);
      }
    }
    const g = l.match(/^Last Goal:\s*(.+)$/i);
    if (g?.[1]) lastGoal = g[1].trim();
  }
  // A pre-match alert says "Kickoff: In 1 hour" instead of carrying a timer and a score.
  let kickoffRaw: string | null = null;
  for (const l of lines) {
    const k = l.replace(DECORATION, "").trim().match(/^Kick-?off:\s*(.+)$/i);
    if (k?.[1]) kickoffRaw = k[1].trim();
  }
  const preMatchMarket = market === "FIRST_HALF_GOALS";
  if (minute === null && !preMatchMarket) flags.push("Could not read the match timer.");

  // ---- "Label: a - b" stats ----
  const stats: Record<string, [number, number]> = {};
  for (const l of lines) {
    const m = l.match(/^([A-Za-z][A-Za-z0-9 %./()'-]*?):\s*(-?\d+(?:\.\d+)?)\s*-\s*(-?\d+(?:\.\d+)?)$/);
    if (m?.[1] && m[2] !== undefined && m[3] !== undefined) {
      const a = Number(m[2]);
      const b = Number(m[3]);
      if (Number.isFinite(a) && Number.isFinite(b)) stats[m[1].trim()] = [a, b];
    }
  }
  const goals = stats["Goals"] ?? null;
  const goalsHome = goals ? goals[0] : null;
  const goalsAway = goals ? goals[1] : null;
  if (!goals && !preMatchMarket) flags.push("Could not read the current score (Goals line).");

  // ---- odds ----
  const odds: ParsedAlert["odds"] = {
    preMatch1x2: null,
    live1x2: null,
    overUnderLine: null,
    over: null,
    under: null,
  };
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i] ?? "";
    const next = lines[i + 1];
    if (/^1X2 Pre-Match Odds:?$/i.test(l)) odds.preMatch1x2 = triple(next);
    else if (/^1X2 Live Odds:?$/i.test(l)) odds.live1x2 = triple(next);
    else {
      const ou = l.match(/^Over\/Under\s+(\d+(?:\.\d+)?)\s+Odds:?$/i);
      if (ou?.[1]) {
        odds.overUnderLine = Number(ou[1]);
        const p = pair(next);
        if (p) {
          odds.over = p[0];
          odds.under = p[1];
        }
      }
    }
  }

  // ---- footer facts ----
  const matchedM = text.match(/Matched:\s*£\s*([\d,]+(?:\.\d+)?)/i);
  const matched = num(matchedM?.[1]);
  const strikeM = text.match(/Strike Rate:\s*(\d+(?:\.\d+)?)\s*%/i);
  const strikeRate = num(strikeM?.[1]);
  const freeM = text.match(/Free pick\s+(\d+)\s+of\s+(\d+)/i);
  const freePick = freeM?.[1] && freeM[2] ? { n: Number(freeM[1]), of: Number(freeM[2]) } : null;

  // ---- match summary (added by an edit after full time) ----
  const htM = text.match(/Half-Time Score:\s*(\d+\s*-\s*\d+)/i);
  const ftM = text.match(/Full-Time Score:\s*(\d+\s*-\s*\d+)/i);
  const htScore = htM?.[1] ? htM[1].replace(/\s+/g, "") : null;
  const ftScore = ftM?.[1] ? ftM[1].replace(/\s+/g, "") : null;

  let result: PickResult | null = null;
  const summaryIdx = lines.findIndex((l) => /Match Summary/i.test(l));
  if (summaryIdx >= 0) {
    const summary = lines.slice(summaryIdx).join("\n");
    if (/✅|\bhit\b/i.test(summary)) result = "hit";
    else if (/❌|\bmiss\b|\bloss\b|\blost\b/i.test(summary)) result = "miss";
    else if (ftScore) flags.push("Match summary present but the Hit/Miss marker was not recognised.");
  }
  const settled = result !== null || ftScore !== null;

  // ---- market + selection ----
  let selection: string | null = null;
  let targetLine: number | null = null;
  let underdog: "home" | "away" | null = null;
  let favourite: "home" | "away" | null = null;

  if (market === "FAVOURITE_TO_WIN") {
    // The favourite is the side with the shorter live win price (1X2 line: home, draw, away).
    const live = odds.live1x2;
    if (!live) {
      flags.push("No live 1X2 odds in the alert, so the favourite can't be worked out.");
    } else if (live[0] === live[2]) {
      flags.push("Home and away live odds are equal, so there is no favourite.");
    } else {
      favourite = live[0] < live[2] ? "home" : "away";
      selection = "Favourite to win";
    }
  } else if (market === "UNDERDOG_DOUBLE_CHANCE") {
    // The underdog is the side with the longer pre-match win price (1X2 line: home, draw, away).
    const pre = odds.preMatch1x2;
    if (!pre) {
      flags.push("No pre-match 1X2 odds in the alert, so the underdog can't be worked out.");
    } else if (pre[0] === pre[2]) {
      flags.push("Home and away pre-match odds are equal, so there is no underdog.");
    } else {
      underdog = pre[0] > pre[2] ? "home" : "away";
      selection = "Underdog to win or draw";
    }
  } else if (market === "NEXT_GOAL") {
    if (goalsHome !== null && goalsAway !== null) {
      targetLine = goalsHome + goalsAway + 0.5;
      selection = `Over ${targetLine}`;
      // Cross-check against the Over/Under line printed in the alert itself.
      if (odds.overUnderLine !== null && odds.overUnderLine !== targetLine) {
        flags.push(
          `Over/Under line in the alert (${odds.overUnderLine}) does not match total goals + 0.5 (${targetLine}).`,
        );
      }
      if (odds.overUnderLine === null) {
        flags.push("No Over/Under line in the alert to cross-check the target line against.");
      }
    }
  } else if (market === "BOTH_TEAMS_TO_SCORE") {
    selection = "Yes";
    // If both teams have already scored the bet is meaningless.
    if (goalsHome !== null && goalsAway !== null && goalsHome > 0 && goalsAway > 0 && !settled) {
      flags.push("Both teams have already scored, so this Both Teams to Score pick is not live.");
    }
  } else if (market === "FIRST_HALF_GOALS") {
    // Fixed line: Over 0.5 goals in the first half, backed before the match starts.
    targetLine = 0.5;
    selection = "Over 0.5 first-half goals";
    if (!settled) {
      if (!kickoffRaw) flags.push("No Kickoff line in the alert, so it can't be confirmed as a pre-match alert.");
      if (minute !== null) flags.push("The alert has a match timer, so the match is already under way. This bet is pre-match only.");
      if (goalsHome !== null && goalsAway !== null && goalsHome + goalsAway > 0) {
        flags.push("A goal has already been scored, so Over 0.5 first-half goals is already decided.");
      }
    }
  } else if (market === "FIRST_HALF_CORNERS") {
    // "First Half Corner Race": one more corner before half-time, i.e. first-half corners Over (corners so far + 0.5).
    // The edited full-time alert keeps the original stats lines, so the line stays the one bet.
    const corners = stats["Corners"] ?? null;
    if (corners) {
      targetLine = corners[0] + corners[1] + 0.5;
      selection = `Over ${targetLine} first-half corners`;
    }
    if (!settled) {
      if (!corners) {
        flags.push("No Corners line in the alert, so the corner line can't be worked out.");
      }
      if (baseMinute !== null && baseMinute > 45) {
        flags.push("The alert is past 45 minutes, so the first half is over.");
      }
    }
  } else {
    flags.push(`Strategy "${strategyRaw}" is not in the strategy table, so no market is set.`);
  }

  // ---- final result: from the score where the bet allows it ----
  const alertResult = result;
  let finalResult: PickResult | null = result;
  let resultSource: "score" | "alert" | null = result ? "alert" : null;
  const ft = ftScore ? ftScore.match(/^(\d+)-(\d+)$/) : null;
  if (ft && ft[1] !== undefined && ft[2] !== undefined) {
    const a = Number(ft[1]);
    const b = Number(ft[2]);
    let computed: PickResult | null = null;
    // Over (goals at the alert + 0.5): wins if the final total is above that line.
    if (market === "NEXT_GOAL" && targetLine !== null) computed = a + b > targetLine ? "hit" : "miss";
    else if (market === "BOTH_TEAMS_TO_SCORE") computed = a > 0 && b > 0 ? "hit" : "miss";
    // Favourite to win (Match Odds): hits only if the favourite wins. A draw loses.
    else if (market === "FAVOURITE_TO_WIN" && favourite !== null) {
      computed = (favourite === "home" ? a > b : b > a) ? "hit" : "miss";
    }
    // Underdog win or draw: hits unless the underdog lost.
    else if (market === "UNDERDOG_DOUBLE_CHANCE" && underdog !== null) {
      computed = (underdog === "home" ? a >= b : b >= a) ? "hit" : "miss";
    }
    if (computed) {
      finalResult = computed;
      resultSource = "score";
    }
  }

  // First-half goals is graded on the half-time score, not the full-time one.
  const ht = htScore ? htScore.match(/^(\d+)-(\d+)$/) : null;
  if (market === "FIRST_HALF_GOALS" && ht && ht[1] !== undefined && ht[2] !== undefined) {
    finalResult = Number(ht[1]) + Number(ht[2]) > 0 ? "hit" : "miss";
    resultSource = "score";
  }

  const hasLiveState = preMatchMarket ? kickoffRaw !== null : minute !== null && goalsHome !== null && goalsAway !== null;
  const sendable =
    flags.length === 0 &&
    market !== null &&
    selection !== null &&
    home !== null &&
    away !== null &&
    hasLiveState &&
    !settled;

  return {
    strategyRaw,
    strategyKey,
    strategyParts,
    market,
    underdog,
    favourite,
    selection,
    targetLine,
    kickoffRaw,
    competition,
    country,
    positions,
    home,
    away,
    timerRaw,
    minute,
    lastGoal,
    goalsHome,
    goalsAway,
    stats,
    odds,
    matched,
    strikeRate,
    freePick,
    htScore,
    ftScore,
    result: finalResult,
    alertResult,
    resultSource,
    flags,
    sendable,
  };
}
