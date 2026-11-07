import { createHash, timingSafeEqual } from "node:crypto";

/**
 * The read-only key the AI agents use (ops/agents, .claude/agents): Ops Watch, the Strategy Auditor and the Skeptic read
 * figures with it instead of signing in. It opens only the GET routes under /api/agent; nothing that changes a setting,
 * a stake, Live/Sim or a bet accepts it. Set AGENT_READ_KEY on the website component in DigitalOcean (Encrypted, 24+
 * characters); change it to revoke every agent at once, or remove it to switch the agent routes off.
 */
export const AGENT_KEY_HEADER = "x-agent-key";
const MIN_LENGTH = 24;

const digest = (s: string) => createHash("sha256").update(s, "utf8").digest();

export function agentKeyValid(provided: string | null | undefined, configured = process.env.AGENT_READ_KEY): boolean {
  if (!configured || configured.length < MIN_LENGTH || !provided) return false;
  return timingSafeEqual(digest(provided), digest(configured));
}
