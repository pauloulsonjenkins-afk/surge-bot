/**
 * Two layers of protection for the InPlayGuru webhook:
 *
 * 1. A long random token in the URL path. Requests without it get a plain 404,
 *    so the endpoint doesn't even reveal it exists. Always on.
 *
 * 2. The request signature. InPlayGuru describes its webhooks as signed, but
 *    the signing scheme isn't published; they give it to you when they enable
 *    webhooks on your account. This implements the common scheme: an
 *    HMAC-SHA256 of the raw request body using your signing secret, sent in a
 *    header as hex or base64, optionally prefixed "sha256=". If their docs
 *    describe something different (for example signing a timestamp plus the
 *    body), this is the one function that changes.
 *
 * All comparisons are constant-time, so response timing can't be used to
 * guess the token or signature a character at a time.
 */
import { createHash, createHmac, timingSafeEqual } from "node:crypto";

function constantTimeEqual(a: Buffer, b: Buffer): boolean {
  // Hash both sides first so the lengths always match; timingSafeEqual
  // throws on unequal lengths, and an early length check would leak timing.
  const ha = createHash("sha256").update(a).digest();
  const hb = createHash("sha256").update(b).digest();
  return timingSafeEqual(ha, hb);
}

export function verifyPathToken(given: string, expected: string): boolean {
  return constantTimeEqual(Buffer.from(given, "utf8"), Buffer.from(expected, "utf8"));
}

export function verifyHmacSignature(rawBody: Buffer, headerValue: string | undefined, secret: string): boolean {
  if (!headerValue) return false;
  const provided = headerValue.trim().replace(/^sha256=/i, "");
  if (!provided) return false;

  const digest = createHmac("sha256", secret).update(rawBody).digest();

  const asHex = /^[0-9a-f]+$/i.test(provided) ? Buffer.from(provided, "hex") : null;
  if (asHex && asHex.length === digest.length && constantTimeEqual(asHex, digest)) return true;

  const asBase64 = Buffer.from(provided, "base64");
  return asBase64.length === digest.length && constantTimeEqual(asBase64, digest);
}

export function sha256Hex(data: Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}
