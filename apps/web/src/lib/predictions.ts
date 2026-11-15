import type { Prediction } from "@/server/footballbin";

/** Matching a prediction to a match by its two team names: either spelling may contain the other ("Man Utd" and "Man Utd FC"). */
const norm = (s: string) => s.toLowerCase().replace(/\b(fc|afc|city|town|united|utd)\b/g, "").replace(/[^a-z0-9]/g, "");

/** The prediction for a match by its two team names (either spelling can contain the other), or null. */
export function predictionFor(list: Prediction[], home: string | null, away: string | null): Prediction | null {
  if (!home || !away) return null;
  const same = (a: string, b: string) => {
    const x = norm(a);
    const y = norm(b);
    return x.length > 2 && y.length > 2 && (x.includes(y) || y.includes(x));
  };
  return list.find((p) => same(p.home, home) && same(p.away, away)) ?? null;
}

