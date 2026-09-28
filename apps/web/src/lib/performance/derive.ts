import { LeagueFilter, LOW_SAMPLE, MINUTE_BUCKETS, OTHER_COUNTRY, ResolvedAlert } from "@/domain/performance";

export interface Agg {
  alerts: number;
  hits: number;
  misses: number;
  pending: number;
  settled: number;
  /** 0-1, or null when nothing has settled yet. Pending alerts are left out of the maths. */
  hitRate: number | null;
  lowSample: boolean;
}

export function aggregate(rows: ResolvedAlert[]): Agg {
  let hits = 0;
  let misses = 0;
  let pending = 0;
  for (const r of rows) {
    if (r.outcome === "hit") hits++;
    else if (r.outcome === "miss") misses++;
    else pending++;
  }
  const settled = hits + misses;
  return {
    alerts: rows.length,
    hits,
    misses,
    pending,
    settled,
    hitRate: settled > 0 ? hits / settled : null,
    lowSample: settled < LOW_SAMPLE,
  };
}

export function matchesLeague(a: ResolvedAlert, f: LeagueFilter): boolean {
  switch (f.type) {
    case "all":
      return true;
    case "country":
      return a.country === f.country;
    case "tier":
      return a.tier === f.tier;
    case "league":
      return a.leagueId === f.leagueId;
  }
}

export function bucketIndex(minute: number): number {
  const i = MINUTE_BUCKETS.findIndex((b) => minute >= b.from && minute <= b.to);
  return i === -1 ? MINUTE_BUCKETS.length - 1 : i;
}

export interface LeagueRow {
  leagueId: string;
  name: string;
  country: string;
  tier: number;
  agg: Agg;
}

export interface LeagueGroup {
  key: string;
  title: string;
  filter: LeagueFilter;
  agg: Agg;
  rows: LeagueRow[];
}

/** Builds the By league list, grouped by country or by tier, from whatever alerts are passed in. */
export function groupLeagues(rows: ResolvedAlert[], by: "country" | "tier"): LeagueGroup[] {
  const perLeague = new Map<string, ResolvedAlert[]>();
  for (const r of rows) {
    const list = perLeague.get(r.leagueId);
    if (list) list.push(r);
    else perLeague.set(r.leagueId, [r]);
  }

  const leagueRows: LeagueRow[] = [];
  for (const list of perLeague.values()) {
    const first = list[0];
    if (!first) continue;
    leagueRows.push({
      leagueId: first.leagueId,
      name: first.leagueName,
      country: first.country,
      tier: first.tier,
      agg: aggregate(list),
    });
  }

  const groups = new Map<string, LeagueRow[]>();
  for (const l of leagueRows) {
    const key = by === "country" ? l.country : String(l.tier);
    const list = groups.get(key);
    if (list) list.push(l);
    else groups.set(key, [l]);
  }

  const out: LeagueGroup[] = [];
  for (const [key, list] of groups) {
    const members = rows.filter((r) => (by === "country" ? r.country === key : String(r.tier) === key));
    const sorted = [...list].sort((a, b) =>
      by === "country"
        ? a.tier - b.tier || a.name.localeCompare(b.name)
        : a.country.localeCompare(b.country) || a.name.localeCompare(b.name),
    );
    out.push({
      key,
      title: key,
      filter: by === "country" ? { type: "country", country: key } : { type: "tier", tier: Number(key) },
      agg: aggregate(members),
      rows: sorted,
    });
  }

  const unmapped = (g: LeagueGroup) => (by === "country" ? g.key === OTHER_COUNTRY : g.key === "0");
  return out.sort((a, b) => {
    if (unmapped(a) !== unmapped(b)) return unmapped(a) ? 1 : -1;
    if (by === "tier") return Number(a.key) - Number(b.key);
    return b.agg.alerts - a.agg.alerts;
  });
}
