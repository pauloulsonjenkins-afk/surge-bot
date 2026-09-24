/**
 * What happens to a webhook once it has passed the security checks.
 *
 * CURRENT BEHAVIOUR: capture only. Each verified webhook is stored in the
 * inplayguru_webhooks table and backed up to the Space. No AlertTrigger is
 * built and executeAlert() is NOT called, so nothing is sent to Betfair.
 *
 * Why: InPlayGuru doesn't publish its webhook payload format. The mapping
 * from a pick to an AlertTrigger has to be written against real payloads,
 * not guessed field names, because a wrong guess here becomes a wrong order.
 * Once a few real picks are captured, `handleVerifiedPick` gains:
 *     const trigger = toAlertTrigger(parsedPick);   // new file, written from real payloads
 *     await executeAlert(trigger, deps);            // existing pipeline, dry-run by default
 */
import type { EngineDb } from "../storage/engine-db";
import { log } from "../server/log";
import { sha256Hex } from "./verify";

export type PickOutcome = "captured" | "duplicate";

export function handleVerifiedPick(
  db: EngineDb,
  rawBody: Buffer,
  contentType: string | null,
  signatureVerified: boolean,
): PickOutcome {
  const bodySha256 = sha256Hex(rawBody);
  const isNew = db.saveWebhook({
    receivedAt: new Date().toISOString(),
    bodySha256,
    contentType,
    signatureVerified,
    body: rawBody.toString("utf8"),
  });

  if (!isNew) {
    log.info(`InPlayGuru webhook ${bodySha256.slice(0, 12)} is a repeat of one already stored; ignored.`);
    return "duplicate";
  }

  log.info(
    `InPlayGuru webhook ${bodySha256.slice(0, 12)} captured (${rawBody.length} bytes, ` +
      `signature ${signatureVerified ? "verified" : "not checked: no signing secret set"}).`,
  );
  return "captured";
}
