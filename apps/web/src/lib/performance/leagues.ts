import { LEAGUE_CATALOGUE, LeagueInfo, OTHER_COUNTRY, PerformanceAlert, ResolvedAlert } from "@/domain/performance";

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
  const hit = INDEX.get(norm(raw)) ?? (countryHint ? INDEX.get(norm(`${countryHint} ${raw}`)) : undefined);
  if (hit) return { leagueId: hit.id, leagueName: hit.name, country: hit.country, tier: hit.tier };
  const name = raw.trim() || "Unknown league";
  const country = countryHint?.trim() || OTHER_COUNTRY;
  return { leagueId: `other:${norm(country)}:${norm(name)}`, leagueName: name, country, tier: 0 };
}

export function resolveAlerts(alerts: PerformanceAlert[]): ResolvedAlert[] {
  return alerts.map((a) => ({ ...a, ...resolveLeague(a.league, a.country) }));
}
