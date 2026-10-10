/**
 * A ONE-OFF check of what the API-Football plan allows, before Edge Phase 2 (Goal Zone) is built on it. Runs once,
 * about a minute after the engine starts, and never again once it has an answer (3 calls; /status doesn't count):
 *   1. /status                      the plan, and today's allowance
 *   2. /fixtures?date=<3 weeks ago>  can the plan read a past date this season?
 *   3. /fixtures?ids=<20 ids>        can it fetch 20 matches at once, and do they come with their events (goal minutes)?
 * The answers are stored (setting "api_football_probe") and shown to the admin at /internal/api-football-probe.
 * Nothing else uses them; nothing here touches betting.
 */
import type { EngineDb } from "../storage/engine-db";
import { log } from "../server/log";

const BASE = "https://v3.football.api-sports.io";
const KEY = "api_football_probe";

export interface ProbeStep {
  step: string;
  ok: boolean;
  detail: string;
}

export interface ProbeResult {
  at: string;
  plan: string | null;
  limitPerDay: number | null;
  usedToday: number | null;
  steps: ProbeStep[];
  /** The plain-English answer for Phase 2. */
  verdict: string;
}

async function call(path: string, key: string): Promise<{ status: number; body: Record<string, unknown> }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  try {
    const res = await fetch(`${BASE}${path}`, { headers: { "x-apisports-key": key }, signal: controller.signal });
    return { status: res.status, body: (await res.json().catch(() => ({}))) as Record<string, unknown> };
  } finally {
    clearTimeout(timer);
  }
}

function errorsOf(body: Record<string, unknown>): string | null {
  const e = body.errors;
  if (!e) return null;
  if (Array.isArray(e)) return e.length ? e.map(String).join("; ") : null;
  if (typeof e === "object") {
    const parts = Object.entries(e as Record<string, unknown>).map(([k, v]) => `${k}: ${String(v)}`);
    return parts.length ? parts.join("; ") : null;
  }
  return String(e);
}

export async function runProbe(key: string, now = new Date()): Promise<ProbeResult> {
  const steps: ProbeStep[] = [];
  let plan: string | null = null;
  let limitPerDay: number | null = null;
  let usedToday: number | null = null;

  const st = await call("/status", key);
  const resp = st.body.response as { subscription?: { plan?: string }; requests?: { current?: number; limit_day?: number } } | undefined;
  plan = resp?.subscription?.plan ?? null;
  limitPerDay = resp?.requests?.limit_day ?? null;
  usedToday = resp?.requests?.current ?? null;
  steps.push({ step: "Plan", ok: !errorsOf(st.body) && plan !== null, detail: errorsOf(st.body) ?? `${plan ?? "?"}: ${usedToday ?? "?"} of ${limitPerDay ?? "?"} calls used today` });

  const past = new Date(now.getTime() - 21 * 86_400_000).toISOString().slice(0, 10);
  const day = await call(`/fixtures?date=${past}&timezone=Europe/London`, key);
  const dayErr = errorsOf(day.body);
  const fixtures = (day.body.response as Array<{ fixture?: { id?: number; status?: { short?: string } } }> | undefined) ?? [];
  const finished = fixtures.filter((f) => f.fixture?.status?.short === "FT").map((f) => f.fixture!.id!).filter(Boolean);
  steps.push({ step: `A past date (${past})`, ok: !dayErr && fixtures.length > 0, detail: dayErr ?? `${fixtures.length} matches, ${finished.length} finished` });

  let batchOk = false;
  let eventsOk = false;
  if (finished.length > 0) {
    const ids = finished.slice(0, 20);
    const batch = await call(`/fixtures?ids=${ids.join("-")}`, key);
    const batchErr = errorsOf(batch.body);
    const got = (batch.body.response as Array<{ events?: Array<{ type?: string; time?: { elapsed?: number } }> }> | undefined) ?? [];
    const goals = got.flatMap((m) => (m.events ?? []).filter((e) => e.type === "Goal"));
    batchOk = !batchErr && got.length > 0;
    eventsOk = goals.some((g) => typeof g.time?.elapsed === "number");
    steps.push({
      step: `20 matches at once, with events`,
      ok: batchOk && eventsOk,
      detail: batchErr ?? `${got.length} of ${ids.length} matches returned, ${goals.length} goals with minutes`,
    });
  } else {
    steps.push({ step: "20 matches at once, with events", ok: false, detail: "Not tried: the past date gave no finished matches." });
  }

  const pastOk = steps[1]!.ok;
  const verdict =
    pastOk && batchOk && eventsOk
      ? "Goal Zone can be built as planned: past dates and 20 matches per call with goal minutes both work, so the season so far can be filled in within about a week."
      : !pastOk
        ? "The plan can't read past dates: Goal Zone could only build up from now on, one day at a time, so it would take weeks to fill."
        : batchOk && !eventsOk
          ? "20 matches at once works, but without goal minutes: events would need one call per match, so only a few leagues could be covered."
          : "Fetching 20 matches at once isn't allowed: events would need one call per match, so only a few leagues could be covered.";
  return { at: now.toISOString(), plan, limitPerDay, usedToday, steps, verdict };
}

export function getProbe(db: EngineDb): ProbeResult | null {
  try {
    const raw = db.getSetting(KEY);
    return raw ? (JSON.parse(raw) as ProbeResult) : null;
  } catch {
    return null;
  }
}

/** Runs the probe once, a minute after start, if it has never answered. */
export function startProbeOnce(db: EngineDb, key: string | undefined): void {
  if (!key || getProbe(db)) return;
  setTimeout(() => {
    void runProbe(key)
      .then((r) => {
        db.setSetting(KEY, JSON.stringify(r));
        log.info(`API-Football check: ${r.verdict}`);
      })
      .catch((err) => log.warn(`API-Football check failed: ${err instanceof Error ? err.message : String(err)}`));
  }, 60_000).unref?.();
}
