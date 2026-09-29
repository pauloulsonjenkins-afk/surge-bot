/**
 * Small in-memory rate limiter for the sign-in and sign-up routes. It resets when the site restarts,
 * which is fine for a small private site. Same idea as the admin login's throttle.
 */
const buckets = new Map<string, { count: number; resetAt: number }>();

/** Counts one attempt against `key`; true means the limit has been passed and the request should be refused. */
export function overLimit(key: string, max: number, windowMs: number): boolean {
  const now = Date.now();
  if (buckets.size > 2000) for (const [k, v] of buckets) if (now > v.resetAt) buckets.delete(k);
  const entry = buckets.get(key);
  if (!entry || now > entry.resetAt) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return 1 > max;
  }
  entry.count += 1;
  return entry.count > max;
}

export function clearLimit(key: string): void {
  buckets.delete(key);
}

/** DigitalOcean's edge sets DO-Connecting-IP; otherwise the LAST X-Forwarded-For entry (the one the proxy added). */
export function clientIp(req: Request): string {
  const direct = req.headers.get("do-connecting-ip")?.trim();
  if (direct) return direct;
  const hops = (req.headers.get("x-forwarded-for") ?? "").split(",").map((h) => h.trim()).filter(Boolean);
  return hops[hops.length - 1] ?? "unknown";
}
