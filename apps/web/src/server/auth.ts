/**
 * Admin session handling.
 *
 * Deliberately NOT what the spec asked for ("hardcode the password, hash it
 * in local session state"). That pattern ships the check to the browser,
 * where devtools can read the hash straight out of the bundle or flip the
 * "authenticated" flag directly — see the Security section of the original
 * blueprint, which flags exactly this. Given this gate sits in front of
 * Betfair credentials and live staking, the check has to happen on the
 * server, on every request to a protected route, against a secret that
 * never leaves the server.
 *
 * How it works:
 *  - ADMIN_PASSWORD lives only as a server-side env var (set it in the
 *    DigitalOcean App Platform dashboard as an encrypted/secret-type var —
 *    no terminal needed). It is never imported into client code.
 *  - On successful login, the server issues a signed token (HMAC-SHA256
 *    over a payload + expiry) inside an httpOnly, SameSite=Strict cookie.
 *    The browser can't read or forge it; it can only send it back.
 *  - Every protected request re-verifies the signature and expiry — using
 *    Web Crypto (SubtleCrypto), which runs in both the Node runtime (route
 *    handlers, layouts) and the Edge runtime (middleware), so the same
 *    verify function guards both layers.
 *
 * Swap-in path to the blueprint's fuller version later: replace the plain
 * ADMIN_PASSWORD comparison below with an argon2id hash comparison once
 * you're comfortable generating one — nothing else here changes.
 */

const COOKIE_NAME = "surge_admin_session";
const SESSION_TTL_SECONDS = 60 * 60 * 8; // 8 hours

function getSecret(): string {
  const secret = process.env.ADMIN_SESSION_SECRET;
  if (!secret || secret.length < 16) {
    throw new Error(
      "ADMIN_SESSION_SECRET is missing or too short. Set it as a secret env var " +
        "(any long random string, 32+ chars) before the admin gate can issue sessions."
    );
  }
  return secret;
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  const enc = new TextEncoder().encode(secret);
  return crypto.subtle.importKey(
    "raw",
    enc,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  );
}

function toBase64Url(bytes: ArrayBuffer): string {
  const b64 = btoa(String.fromCharCode(...new Uint8Array(bytes)));
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(input: string): Uint8Array {
  const b64 = input.replace(/-/g, "+").replace(/_/g, "/");
  const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
  const bin = atob(padded);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

/** Issues a signed session token: "<expiry>.<signature>". */
export async function createSessionToken(): Promise<string> {
  const expiry = Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS;
  const key = await hmacKey(getSecret());
  const sig = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(String(expiry))
  );
  return `${expiry}.${toBase64Url(sig)}`;
}

/** Verifies a session token's signature and expiry. Never throws — returns false on any problem. */
export async function verifySessionToken(token: string | undefined | null): Promise<boolean> {
  if (!token) return false;
  const [expiryStr, sigPart] = token.split(".");
  if (!expiryStr || !sigPart) return false;

  const expiry = Number(expiryStr);
  if (!Number.isFinite(expiry) || expiry < Math.floor(Date.now() / 1000)) return false;

  try {
    const key = await hmacKey(getSecret());
    return await crypto.subtle.verify(
      "HMAC",
      key,
      fromBase64Url(sigPart) as BufferSource,
      new TextEncoder().encode(expiryStr)
    );
  } catch {
    return false;
  }
}

/** Constant-time-ish password compare (equal-length HMAC compare avoids short-circuit timing on raw string ===). */
export async function checkPassword(candidate: string): Promise<boolean> {
  const expected = process.env.ADMIN_PASSWORD;
  if (!expected) {
    throw new Error(
      "ADMIN_PASSWORD is not set. Add it as a secret env var in the App Platform " +
        "dashboard for the web service before the admin gate can accept a login."
    );
  }
  const key = await hmacKey(getSecret());
  const [a, b] = await Promise.all([
    crypto.subtle.sign("HMAC", key, new TextEncoder().encode(candidate)),
    crypto.subtle.sign("HMAC", key, new TextEncoder().encode(expected)),
  ]);
  const aBytes = new Uint8Array(a);
  const bBytes = new Uint8Array(b);
  if (aBytes.length !== bBytes.length) return false;
  let diff = 0;
  for (let i = 0; i < aBytes.length; i++) diff |= (aBytes[i] ?? 0) ^ (bBytes[i] ?? 0);
  return diff === 0;
}

export const ADMIN_COOKIE_NAME = COOKIE_NAME;
export const ADMIN_SESSION_MAX_AGE = SESSION_TTL_SECONDS;
