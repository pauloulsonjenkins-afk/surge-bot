/**
 * "Ask about this pick" (design in docs/claude-in-goalbrew.md, phase 4).
 *
 * ADVISORY ONLY, same boundary as claude-check.ts and claude-review.ts: owner-triggered, read-only, never touches
 * SendingSettings, buildFeed or direct betting. The owner asks one free-form question about one alert on its
 * detail page; this reuses claude-check.ts's context-assembly (the parsed alert, the strategy's recent form, its
 * Golden/LAY status, and the league's history) and answers in plain text. Nothing here is stored or repeated
 * automatically — each question is its own request, with no memory of earlier ones.
 */
import Anthropic from "@anthropic-ai/sdk";
import type { EngineDb, LivePick } from "../storage/engine-db";
import { buildAlertContext } from "./claude-check";

const MODEL = "claude-sonnet-5-5";

const SYSTEM_PROMPT = [
  "You answer one question about one football in-play betting alert for GoalBrew, using only the data given.",
  "You never place, skip, or recommend placing a bet, and you never suggest changing a setting. If the data",
  "given doesn't answer the question, say so plainly rather than guessing. Answer in a few plain sentences.",
].join(" ");

let client: Anthropic | null | undefined;
function getClient(): Anthropic | null {
  if (client !== undefined) return client;
  const key = process.env.ANTHROPIC_API_KEY?.trim();
  client = key ? new Anthropic({ apiKey: key }) : null;
  return client;
}

export function claudeAskConfigured(): boolean {
  return getClient() !== null;
}

/** Answers one owner question about one pick. Throws on failure (no API key, network error, empty reply) — the
 * caller (http.ts) turns that into a 503/502 for the admin page; nothing here is fire-and-forget, since the owner
 * is waiting on the answer. */
export async function askAboutPick(db: EngineDb, pick: LivePick, question: string): Promise<string> {
  const anthropic = getClient();
  if (!anthropic) throw new Error("ANTHROPIC_API_KEY isn't set on the engine.");
  const context = buildAlertContext(db, pick);
  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 600,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: `Alert data: ${JSON.stringify(context)}\n\nQuestion: ${question}` }],
  });
  const answer = response.content.find((b) => b.type === "text")?.text.trim();
  if (!answer) throw new Error("Claude's reply had no text.");
  return answer;
}
