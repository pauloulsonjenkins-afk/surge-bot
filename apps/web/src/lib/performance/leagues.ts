import { LEAGUE_CATALOGUE, LeagueInfo, OTHER_COUNTRY, PerformanceCell, ResolvedCell } from "@/domain/performance";

function norm(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

const INDEX = new Map<string, LeagueInfo>();
for (const l of LEAGUE_CATALOGUE) {
  INDEX.set(norm(l.name), l);
  INDEX.set(norm(`${l.country} ${l.name}`), l);
  for (const a of l.aliases) INDEX.set(norm(a), l);
}

export function resolveLeague(
  raw: string,
  countryHint?: string | null,
): { leagueId: string; leagueName: string; country: string; tier: number } {
  // A league name alone (e.g. "Serie A") can belong to several countries: when the alert's flag gave a country,
  // the catalogue entry only counts if it is for that country (or an international competition).
  const sameCountry = (l: LeagueInfo | undefined) =>
    l !== undefined && (!countryHint || l.country === "International" || norm(l.country) === norm(countryHint));
  const byName = INDEX.get(norm(raw));
  const byCountryAndName = countryHint ? INDEX.get(norm(`${countryHint} ${raw}`)) : undefined;
  const hit = sameCountry(byCountryAndName) ? byCountryAndName : sameCountry(byName) ? byName : undefined;
  if (hit) return { leagueId: hit.id, leagueName: hit.name, country: hit.country, tier: hit.tier };
  const name = raw.trim() || "Unknown league";
  const country = countryHint?.trim() || OTHER_COUNTRY;
  return { leagueId: `other:${norm(country)}:${norm(name)}`, leagueName: name, country, tier: 0 };
}

export function resolveCells(cells: PerformanceCell[]): ResolvedCell[] {
  return cells.map((cell) => {
    const r = resolveLeague(cell.league, cell.country);
    return {
      ...cell,
      ...r,
      country: cell.countryOverride?.trim() || r.country,
      tier: cell.tierOverride ?? r.tier,
    };
  });
}