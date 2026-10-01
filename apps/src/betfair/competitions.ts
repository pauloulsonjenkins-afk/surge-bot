/**
 * Betfair coverage: which leagues (InPlayGuru's names) have matches on the Betfair exchange.
 *
 * The engine saves every football competition Betfair lists (listCompetitions, every few hours, see exchange.ts) into
 * betfair_competitions, keeping when each was last seen. Betfair only lists a competition while it has upcoming
 * matches, so the list grows over the weeks: a league between seasons can look missing until its fixtures are listed.
 *
 * Matching is by name, because the two sites name leagues differently: InPlayGuru writes "Bolivia Copa Division
 * Profesional", Betfair "Bolivian Primera Division". A league is
 *   on        its country matches and most of its own words appear in a Betfair competition's name
 *             (or one of your alerts from it was found on Betfair)
 *   maybe     its country matches a Betfair competition but the words don't line up: check the name shown
 *   not       no Betfair competition for that country fits
 * Women's, youth and reserve leagues only match competitions that say the same.
 */
import type { EngineDb } from "../storage/engine-db";
import { regionName } from "../inplayguru/parse-alert";

export interface BetfairCompetition {
  id: string;
  name: string;
  /** Betfair's region code, e.g. "GBR". */
  region: string | null;
  marketCount: number;
  firstSeen: string;
  lastSeen: string;
}

export type CoverageStatus = "on" | "maybe" | "not";

export interface CoverageResult {
  name: string;
  country: string | null;
  status: CoverageStatus;
  /** The Betfair competition it matched (or nearly matched). */
  betfair: { name: string; region: string | null; lastSeen: string } | null;
  /** Alerts from this league whose match was / wasn't found on Betfair (leagues from your alerts only). */
  alertsOn?: number;
  alertsOff?: number;
}

const norm = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/** Country name as InPlayGuru writes it, and the words Betfair uses for it where the first four letters don't match. */
const DEMONYMS: Record<string, string[]> = {
  spain: ["spanish"],
  france: ["french"],
  netherlands: ["dutch", "eredivisie"],
  wales: ["welsh"],
  ireland: ["irish"],
  "northern ireland": ["northern irish", "nifl"],
  switzerland: ["swiss"],
  denmark: ["danish"],
  finland: ["finnish"],
  poland: ["polish"],
  czechia: ["czech"],
  "czech republic": ["czech"],
  "united states": ["us", "usa", "american", "mls"],
  usa: ["us", "american", "mls"],
  "south korea": ["korean", "k league"],
  "korea republic": ["korean", "k league"],
  "ivory coast": ["ivorian"],
  "cote d ivoire": ["ivorian"],
  "bosnia herzegovina": ["bosnian"],
  "bosnia and herzegovina": ["bosnian"],
  "united arab emirates": ["uae"],
  "saudi arabia": ["saudi"],
  "new zealand": ["new zealand"],
  "costa rica": ["costa rican"],
  "el salvador": ["salvadoran", "salvadorean"],
  "faroe islands": ["faroe", "faroese"],
  "hong kong": ["hong kong"],
  england: ["english", "premier league", "championship"],
  scotland: ["scottish"],
  belgium: ["belgian"],
  greece: ["greek"],
  turkiye: ["turkish"],
  turkey: ["turkish"],
  germany: ["german", "bundesliga"],
  italy: ["italian", "serie a", "serie b"],
  portugal: ["portuguese"],
  sweden: ["swedish"],
  norway: ["norwegian"],
  iceland: ["icelandic"],
  peru: ["peruvian"],
  philippines: ["filipino", "philippine"],
  cyprus: ["cypriot", "cyprus"],
  slovakia: ["slovak", "slovakian"],
  slovenia: ["slovenian"],
  croatia: ["croatian"],
  serbia: ["serbian"],
  romania: ["romanian"],
  bulgaria: ["bulgarian"],
  ukraine: ["ukrainian"],
  russia: ["russian"],
  lithuania: ["lithuanian"],
  latvia: ["latvian"],
  estonia: ["estonian"],
  belarus: ["belarusian"],
  thailand: ["thai"],
  vietnam: ["vietnamese"],
  indonesia: ["indonesian"],
  malaysia: ["malaysian"],
  china: ["chinese"],
  japan: ["japanese", "j league"],
  qatar: ["qatari", "qatar"],
  kuwait: ["kuwaiti"],
  bahrain: ["bahraini"],
  oman: ["omani"],
  jordan: ["jordanian"],
  iraq: ["iraqi"],
  iran: ["iranian"],
  israel: ["israeli"],
  egypt: ["egyptian"],
  morocco: ["moroccan"],
  algeria: ["algerian"],
  tunisia: ["tunisian"],
  "south africa": ["south african", "psl"],
  nigeria: ["nigerian"],
  ghana: ["ghanaian"],
  kenya: ["kenyan"],
};

/** Every country name we know (InPlayGuru writes the country first), longest first so "Northern Ireland" beats "Ireland". */
const COUNTRIES: string[] = (() => {
  const names = new Set<string>(Object.keys(DEMONYMS));
  for (let a = 65; a <= 90; a++)
    for (let b = 65; b <= 90; b++) {
      const n = regionName(String.fromCharCode(a, b));
      if (n) names.add(norm(n));
    }
  for (const extra of ["england", "scotland", "wales", "northern ireland", "europe", "world", "international", "south america", "africa", "asia"]) names.add(extra);
  return [...names].filter((n) => n.length >= 3).sort((x, y) => y.length - x.length);
})();

const CONTINENTS = new Set(["europe", "world", "international", "south america", "africa", "asia"]);
/** Words that say nothing about which league it is. */
const GENERIC = new Set(["league", "division", "football", "liga", "the", "de", "of", "fc", "national", "championship", "primera"]);
/** Kinds of competition that must agree on both sides. */
const KINDS: Array<[string, RegExp]> = [
  ["women", /\b(women|womens|w|feminine|feminino|femenina|ladies|wsl)\b/],
  ["u17", /\bu ?17\b/],
  ["u19", /\bu ?19\b/],
  ["u20", /\bu ?20\b/],
  ["u21", /\bu ?21\b/],
  ["u23", /\bu ?23\b/],
  ["reserves", /\b(reserves?|res|ii|b team)\b/],
];
const kindsOf = (s: string) => KINDS.filter(([, re]) => re.test(s)).map(([k]) => k).sort().join(",");

/** The country a league name starts with (InPlayGuru style), and the rest of the name. */
export function splitCountry(name: string): { country: string | null; rest: string } {
  const n = norm(name);
  for (const c of COUNTRIES) if (n === c || n.startsWith(`${c} `)) return { country: c, rest: n.slice(c.length).trim() };
  return { country: null, rest: n };
}

/** Whether a Betfair competition name refers to this country. */
function countryHit(country: string, betfairName: string): boolean {
  const words = betfairName.split(" ");
  const keys = [country, ...(DEMONYMS[country] ?? [])];
  for (const k of keys) if (` ${betfairName} `.includes(` ${k} `)) return true;
  // "Bolivia" / "Bolivian", "Brazil" / "Brazilian", "Italy" / "Italian": the country's name less a final vowel (or y)
  // starts the Betfair word. The whole name is used, not just its start, so "Austria" never matches "Australian".
  const stem = country.split(" ")[0]!.replace(/[aeiouy]$/, "");
  return stem.length >= 4 && words.some((w) => w.startsWith(stem));
}

/**
 * Share of the league's own words (country and generic words aside) that the Betfair name contains, and whether a
 * distinctive word (5+ letters, e.g. "Paulista") is missing: then it's a different competition, however many of the
 * other words match ("Brazil Paulista Serie B" isn't "Brazilian Serie B").
 */
function wordScore(rest: string, betfairName: string): { score: number; missingDistinctive: boolean } {
  const own = rest.split(" ").filter((w) => w && !GENERIC.has(w));
  if (own.length === 0) return { score: 0.5, missingDistinctive: false };
  const theirs = betfairName.split(" ");
  const has = (w: string) => theirs.some((t) => t === w || (w.length >= 4 && (t.startsWith(w) || w.startsWith(t)) && t.length >= 4));
  const found = own.filter(has);
  return { score: found.length / own.length, missingDistinctive: own.some((w) => w.length >= 5 && !has(w)) };
}

/** Where one league (InPlayGuru's name; country optional when it's not in the name) stands on Betfair. */
export function checkLeague(name: string, competitions: BetfairCompetition[], knownCountry: string | null = null): CoverageResult {
  const split = splitCountry(name);
  const country = split.country ?? (knownCountry ? norm(knownCountry) : null);
  const rest = split.rest;
  const kinds = kindsOf(norm(name));
  let best: { c: BetfairCompetition; score: number; hit: boolean; exact: boolean } | null = null;
  for (const c of competitions) {
    const cn = norm(c.name);
    if (kindsOf(cn) !== kinds) continue;
    const hit = country !== null && !CONTINENTS.has(country) && countryHit(country, cn);
    const words = wordScore(rest, cn);
    // A distinctive word missing counts against it, so the competition it actually names wins when there is one.
    const score = words.missingDistinctive ? words.score * 0.5 : words.score;
    const rank = (hit ? 1 : 0) * 10 + score;
    if (!best || rank > (best.hit ? 10 : 0) + best.score) best = { c, score, hit, exact: !words.missingDistinctive };
  }
  const titled = (c: string) => c.replace(/\b[a-z]/g, (ch) => ch.toUpperCase());
  const shownCountry = split.country ? titled(split.country) : knownCountry;
  const result = (status: CoverageStatus): CoverageResult => ({
    name,
    country: shownCountry,
    status,
    betfair: best && status !== "not" ? { name: best.c.name, region: best.c.region, lastSeen: best.c.lastSeen } : null,
  });
  if (!best) return result("not");
  const international = country === null || CONTINENTS.has(country);
  if (international) return result(best.exact && best.score >= 0.75 ? "on" : best.score >= 0.4 ? "maybe" : "not");
  if (!best.hit) return result("not");
  return result(best.exact && best.score >= 0.6 ? "on" : "maybe");
}

const SAVED_LIST_KEY = "inplayguru_leagues";

/** Saves a pasted league list (e.g. InPlayGuru's) so it's re-checked as Betfair's competitions build up. */
export function saveLeagueList(db: EngineDb, names: string[]): void {
  db.setSetting(SAVED_LIST_KEY, JSON.stringify({ savedAt: new Date().toISOString(), names }));
}

/** The saved list, checked against the competitions Betfair has listed so far, or null if none is saved. */
export function savedListCoverage(db: EngineDb): { savedAt: string; leagues: CoverageResult[] } | null {
  try {
    const raw = db.getSetting(SAVED_LIST_KEY);
    if (!raw) return null;
    const saved = JSON.parse(raw) as { savedAt: string; names: string[] };
    const competitions = db.listBetfairCompetitions();
    return { savedAt: saved.savedAt, leagues: saved.names.map((n) => checkLeague(n, competitions)) };
  } catch {
    return null;
  }
}

/** The leagues your alerts came from, checked, with what Betfair said about their alerts' matches. */
export function coverageOfAlertLeagues(db: EngineDb): CoverageResult[] {
  const competitions = db.listBetfairCompetitions();
  return db.listLeaguesForAdmin().map((l) => {
    const name = l.country && !norm(l.league).startsWith(norm(l.country)) ? `${l.country} ${l.league}` : l.league;
    const r = checkLeague(name, competitions, l.country);
    const ex = l.exchange;
    // An alert from this league found on Betfair settles it, whatever the names say.
    const status: CoverageStatus = ex.on > 0 ? "on" : r.status;
    return { ...r, name, status, alertsOn: ex.on, alertsOff: ex.off };
  });
}
