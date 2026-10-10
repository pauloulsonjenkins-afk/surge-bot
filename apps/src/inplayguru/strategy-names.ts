/**
 * The names the app shows for strategies, with a description of each. InPlayGuru's own name stays the strategy's
 * key everywhere (settings, stakes, history, and the Provider the betting software reads); this only changes what
 * people see: "Time to fight" shows as "Wake-up Call".
 *
 * Defaults are below (GoalBrew's coffee names, chosen 2 Oct 2026; triggers read from InPlayGuru's Strategies page the
 * same day). The admin can change any name or description on the Strategies page; those edits are saved in the
 * setting STRATEGY_NAMES_KEY and win over the defaults. Clearing an edit goes back to the default.
 */
import type { EngineDb } from "../storage/engine-db";
import { strategyLabel } from "./bet-feed";

export interface StrategyInfo {
  /** What the app shows for the strategy. */
  name: string;
  /** One sentence: the situation it looks for and what it backs. */
  description: string;
  /** InPlayGuru's rules, in short. */
  trigger: string;
  /** The bet sent. */
  bet: string;
}

const STRATEGY_NAMES_KEY = "strategy_names";

/** Keyed by the lower-case InPlayGuru name (strategyLabel, lower-cased). */
const DEFAULTS: Record<string, StrategyInfo> = {
  "first half goal": {
    name: "Early Roast",
    description: "A pre-match pick for a goal before half-time, in matches where both teams usually score early.",
    trigger: "Pre-match. Both teams scored in the first half in 80%+ of their last 5; the first-half Over 0.5 is priced 1.45 or less.",
    bet: "Over 0.5 first-half goals",
  },
  "blistering momentum": {
    name: "Boiling Point",
    description: "One side is surging and attacking hard: backs the next goal.",
    trigger: "Momentum 100+ and up 30+ this half, 10+ dangerous attacks in the last 10 minutes, before 76', next-goal price 1.50+.",
    bet: "Next goal (Over the goals so far + 0.5)",
  },
  "first half corner race": {
    name: "Corner Café",
    description: "Corners are piling up early: backs a busy first half for corners.",
    trigger: "15' to 34', 5+ corners in the last 15 minutes, one side with 55%+ possession.",
    bet: "Over 5.5 first-half corners",
  },
  "underdog taking charge": {
    name: "Dark Horse Roast",
    description: "The underdog is ahead and on top: backs it not to lose.",
    trigger: "Underdog a goal or more ahead, its momentum 30+ above the favourite's, before 84', underdog price 1.20+, losing side 10.0+.",
    bet: "Underdog win or draw",
  },
  "both teams to score": {
    name: "Mixed Blend",
    description: "A strong favourite has conceded first: backs it to hit back so both teams score.",
    trigger: "First half. Away underdog has scored, favourite hasn't; favourite 1.50 or less pre-match, its momentum 25+, no red cards, next-goal price 1.30+.",
    bet: "Both teams to score: Yes",
  },
  "over 1.5 goals / early goal": {
    name: "Espresso",
    description: "An early goal in an open game: backs a second.",
    trigger: "Up to 30', one goal already, 4+ shots and 2+ on target, neither side above 4.20 pre-match.",
    bet: "Over 1.5 goals",
  },
  "home pressure": {
    name: "House Blend",
    description: "The home side is creating chances late on: backs the next goal.",
    trigger: "65'+, home xG 1.5+, home momentum 40+.",
    bet: "Next goal (Over the goals so far + 0.5)",
  },
  "late goal hunter": {
    name: "Last Orders",
    description: "A late burst in a match with plenty of chances: backs one more goal.",
    trigger: "70' to 72', 2 goals or fewer, xG 2.2+, 7+ shots on target, momentum up 60+ in 10 minutes.",
    bet: "Next goal (Over the goals so far + 0.5)",
  },
  "time to fight": {
    name: "Wake-up Call",
    description: "The underdog is ahead and the game is stretched: backs the next goal.",
    trigger: "Underdog a goal or more ahead, momentum 30+ above the favourite's, before 75', next-goal price 1.40+.",
    bet: "Next goal (Over the goals so far + 0.5)",
  },
  "action-packed": {
    name: "Double Shot",
    description: "A goalless game with huge pressure: backs the first goal.",
    trigger: "Momentum 100+, before 86', match Over 0.5 priced 1.40+ (so still 0-0).",
    bet: "Next goal (Over 0.5)",
  },
  "favourite pressure 2nd half": {
    name: "Second Pour",
    description: "The favourite is level or a goal down and pressing after half-time: backs the next goal.",
    trigger: "50' to 70', favourite level or one behind, its momentum 60+ and passing 65%+, 2.00 or less pre-match, next-goal price 1.40+.",
    bet: "Next goal (Over the goals so far + 0.5)",
  },
  "losing team pushing hard": {
    name: "Comeback Roast",
    description: "The team behind is pressing hard: backs the next goal.",
    trigger: "Losing team's momentum 60+ and at least double the winning team's.",
    bet: "Next goal (Over the goals so far + 0.5)",
  },
  "super favorite 0-0 at 75'": {
    name: "Last Drop",
    description: "A big favourite still 0-0 at 75 minutes: backs the favourite to score.",
    trigger: "75', 0-0, favourite 1.50 or shorter pre-match.",
    bet: "Favourite to score (its goals Over 0.5)",
  },
  "away win lay": {
    name: "Away Win Lay",
    description: "Lays the away side before kick-off in leagues where home sides do well: wins on a home win or a draw.",
    trigger: "An hour before kick-off, home 2.20 or shorter, away 3.50 to 8.00, in the chosen leagues.",
    bet: "Lay the away side (home or draw); the stake is the liability",
  },
  "french press": {
    name: "French Press",
    description: "A favourite a goal up and pushing again: backs it to score another.",
    trigger: "61' to 75', the leading side 1.80 or less pre-match and one goal ahead, its momentum up 48+ in 12 minutes and a shot on target in that time, no red cards.",
    bet: "Favourite to score again",
  },
  "pass master 1st half": {
    name: "Filter Coffee",
    description: "The favourite is passing well in the first half: backs it to score again. Sim only, as Betfair doesn't list the market.",
    trigger: "20' to 40', favourite 2.00 or less pre-match, its passing 65%+ and momentum 60+.",
    bet: "Favourite to score again",
  },
};

/** The key a strategy's name is stored under: InPlayGuru's name without its bracketed note, lower-cased. */
export function strategyKey(raw: string): string {
  return strategyLabel(raw).toLowerCase();
}

type Edits = Record<string, { name?: string; description?: string }>;

function readEdits(db: EngineDb): Edits {
  try {
    const raw = db.getSetting(STRATEGY_NAMES_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : {};
    return parsed && typeof parsed === "object" ? (parsed as Edits) : {};
  } catch {
    return {};
  }
}

/** Every strategy with a name: the defaults, with the admin's edits on top. `custom` marks an edited one. */
export function listStrategyNames(db: EngineDb): Record<string, StrategyInfo & { custom: boolean }> {
  const edits = readEdits(db);
  const out: Record<string, StrategyInfo & { custom: boolean }> = {};
  for (const key of new Set([...Object.keys(DEFAULTS), ...Object.keys(edits)])) {
    const base = DEFAULTS[key];
    const edit = edits[key] ?? {};
    const name = edit.name ?? base?.name;
    if (!name) continue;
    out[key] = {
      name,
      description: edit.description ?? base?.description ?? "",
      trigger: base?.trigger ?? "",
      bet: base?.bet ?? "",
      custom: edit.name !== undefined || edit.description !== undefined,
    };
  }
  return out;
}

/** What the app shows for a strategy: its name here, else InPlayGuru's own. */
export function displayName(db: EngineDb, raw: string): string {
  return listStrategyNames(db)[strategyKey(raw)]?.name ?? strategyLabel(raw);
}

/**
 * Saves the admin's name and description for a strategy. An empty value (or null) goes back to the default.
 * Throws with a reason for the admin.
 */
export function saveStrategyName(db: EngineDb, rawKey: unknown, name: unknown, description: unknown): void {
  if (typeof rawKey !== "string" || !rawKey.trim()) throw new Error("No strategy given.");
  const key = strategyKey(rawKey);
  const clean = (v: unknown, max: number, what: string): string | undefined => {
    if (v === null || v === undefined) return undefined;
    if (typeof v !== "string") throw new Error(`The ${what} must be text.`);
    const s = v.replace(/\s+/g, " ").trim();
    if (s.length > max) throw new Error(`The ${what} can be at most ${max} characters.`);
    return s || undefined;
  };
  const n = clean(name, 40, "name");
  const d = clean(description, 300, "description");
  const edits = readEdits(db);
  const entry: { name?: string; description?: string } = {};
  // Only what differs from the default is kept, so a later change to a default still shows.
  if (n !== undefined && n !== DEFAULTS[key]?.name) entry.name = n;
  if (d !== undefined && d !== DEFAULTS[key]?.description) entry.description = d;
  if (entry.name === undefined && entry.description === undefined) delete edits[key];
  else edits[key] = entry;
  db.setSetting(STRATEGY_NAMES_KEY, JSON.stringify(edits));
}
