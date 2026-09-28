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

export type MarketCode = "NEXT_GOAL" | "BOTH_TEAMS_TO_SCORE" | "FIRST_HALF_CORNERS";

export type PickResult = "hit" | "miss";

export interface ParsedAlert {
  /** Top line with emojis stripped, e.g. "Blistering Momentum / Action-packed OJ". */
  strategyRaw: string;
  /** Lower-case name used for the strategy table, bracketed note removed. */
  strategyKey: string;
  /** Which strategy names were found, split on "/". */
  strategyParts: string[];
  market: MarketCode | null;
  /** Human wording of the bet, e.g. "Over 1.5" or "Yes". Null when unmapped. */
  selection: string | null;
  /** The line a bet targets: goals + 0.5 for Next Goal, 5.5 for 1st half corners. */
  targetLine: number | null;

  competition: string | null;
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
  result: PickResult | null;

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
  { test: /momentum/, market: "NEXT_GOAL" },
  { test: /action/, market: "NEXT_GOAL" },
];

// Emoji, flags, arrows, dingbats, variation selectors: everything that is
// decoration rather than text on the strategy line.
const DECORATION = /[\p{Extended_Pictographic}\p{Regional_Indicator}\uFE0F\u200D]/gu;

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
  if (minute === null) flags.push("Could not read the match timer.");

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
  if (!goals) flags.push("Could not read the current score (Goals line).");

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

  if (market === "NEXT_GOAL") {
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
  } else if (market === "FIRST_HALF_CORNERS") {
    // Fixed line: the bet is corners Over 5.5 in the first half.
    targetLine = 5.5;
    selection = "Over 5.5";
    const corners = stats["Corners"] ?? null;
    if (!settled) {
      if (!corners) {
        flags.push("No Corners line in the alert, so the corner count could not be checked.");
      } else if (corners[0] + corners[1] > targetLine) {
        flags.push(`There are already ${corners[0] + corners[1]} corners, so Over 5.5 is already decided.`);
      }
      if (baseMinute !== null && baseMinute > 45) {
        flags.push("The alert is past 45 minutes, so the first half is over.");
      }
    }
  } else {
    flags.push(`Strategy "${strategyRaw}" is not in the strategy table, so no market is set.`);
  }

  const sendable =
    flags.length === 0 &&
    market !== null &&
    selection !== null &&
    home !== null &&
    away !== null &&
    minute !== null &&
    goalsHome !== null &&
    goalsAway !== null &&
    !settled;

  return {
    strategyRaw,
    strategyKey,
    strategyParts,
    market,
    selection,
    targetLine,
    competition,
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
    result,
    flags,
    sendable,
  };
}
