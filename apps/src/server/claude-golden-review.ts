/**
 * Claude's one-line summary for each watched Golden slice (design in docs/claude-in-goalbrew.md, phase 2's sibling):
 * requested 27 Oct 2026 - "summary of what's happening, information is power" for slices that are proving themselves
 * or not. Same ADVISORY ONLY boundary as claude-review.ts: a read-only digest of what golden.ts already worked out
 * (status, record, the rest of the strategy for comparison), a short written note stored for the Golden page to
 * show, never a setting Claude changes itself.
 *
 * Run once a day, alongside the daily strategy review (daily-summary.ts): one Haiku call per non-quiet watched
 * slice, cheap and few in number. A quietly-watched slice (not yet a candidate) has too little going on to summarise
 * and is skipped.
 */
import Anthropic from "@anthropic-ai/sdk";
import type { EngineDb } from "../storage/engine-db";
import { goldenReport, type GoldenStatus } from "./golden";
import { truncateNote } from "./claude-check";
import { log } from "./log";

const MODEL = "claude-haiku-5-5";
const NOTES_KEY = "claude_golden_notes";

export interface GoldenNote {
  note: string;
  status: GoldenStatus;
  generatedAt: string;
}

const SYSTEM_PROMPT = [
  "You write one or two short sentences for the owner of GoalBrew, a football in-play betting assistant, on ONE",
  "'Golden' slice: a part of a strategy being watched because it may be worth more than the rest. You do not place,",
  "skip, or recommend placing a bet, and nothing you write changes any setting on its own - the owner reads this and",
  "decides. Say plainly whether it's proving itself, drifting, or already lost its stage, and why, from the figures",
  "given alone. No hedging filler, no bullet points, no restating the numbers already shown elsewhere on the page.",
].join(" ");

let client: Anthropic | null | undefined;
function getClient(): Anthropic | null {
  if (client !== undefined) return client;
  const key = process.env.ANTHROPIC_API_KEY?.trim();
  client = key ? new Anthropic({ apiKey: key }) : null;
  return client;
}

export function claudeGoldenConfigured(): boolean {
  return getClient() !== null;
}

function loadNotes(db: EngineDb): Record<string, GoldenNote> {
  try {
    return JSON.parse(db.getSetting(NOTES_KEY) ?? "{}") as Record<string, GoldenNote>;
  } catch {
    return {};
  }
}

/** The latest note for every slice that has one, keyed "strategyKey#id" (golden.ts's own key), for the Golden page. */
export function getGoldenNotes(db: EngineDb): Record<string, GoldenNote> {
  return loadNotes(db);
}

type Slice = ReturnType<typeof goldenReport>["slices"][number];

function digestFor(s: Slice): Record<string, unknown> {
  return {
    strategy: s.strategy,
    slice: s.label,
    status: s.status,
    why: s.why,
    sinceStart: { settled: s.slice.all.settled, counted: s.slice.all.counted, roi: s.slice.all.roi },
    restOfStrategy: { settled: s.rest.all.settled, counted: s.rest.all.counted, roi: s.rest.all.roi },
    last30Picks: s.recent.n > 0 ? { n: s.recent.n, roi: s.recent.roi } : null,
    ownLiveTrial: s.bet?.live && s.ownLive ? { settled: s.ownLive.n, roi: s.ownLive.roi } : null,
  };
}

async function writeNote(db: EngineDb, anthropic: Anthropic, key: string, s: Slice, now: Date): Promise<void> {
  try {
    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 900,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: JSON.stringify(digestFor(s)) }],
    });
    const note = response.content.find((b) => b.type === "text")?.text.trim();
    if (!note) {
      log.warn(`Claude Golden review for ${key}: no text in the reply.`);
      return;
    }
    // Cut off mid-sentence by hitting max_tokens (27 Oct 2026, seen on the Golden page: "...That" / "...and not"):
    // skip saving it rather than show a sentence that just stops, same call as claude-check.ts's own verdict failures.
    if (response.stop_reason === "max_tokens") {
      log.warn(`Claude Golden review for ${key}: cut off by max_tokens, not saved.`);
      return;
    }
    const all = loadNotes(db);
    all[key] = { note: truncateNote(note), status: s.status, generatedAt: now.toISOString() };
    db.setSetting(NOTES_KEY, JSON.stringify(all));
  } catch (err) {
    log.warn(`Claude Golden review for ${key} failed: ${err instanceof Error ? err.message : String(err)}.`);
  }
}

/** Called once a day (daily-summary.ts) - fire-and-forget, never delays the push. */
export function requestGoldenReviews(db: EngineDb, now = new Date()): void {
  const anthropic = getClient();
  if (!anthropic) return;
  const slices = goldenReport(db, now, { skipFinder: true }).slices.filter((s) => !s.quiet);
  for (const s of slices) void writeNote(db, anthropic, `${s.strategyKey}#${s.id}`, s, now);
}
