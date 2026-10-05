/**
 * Encryption for member secrets kept on the engine (a Betfair access token once Betfair's vendor login is available).
 * AES-256-GCM with a key from the engine setting MEMBERS_SECRET_KEY (any long random string; it is hashed to 32 bytes).
 * Without that setting nothing can be stored. Secrets are never sent to the website.
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

function key(env = process.env): Buffer | null {
  const raw = env.MEMBERS_SECRET_KEY;
  if (!raw || raw.length < 24) return null;
  return createHash("sha256").update(`goalbrew-members:${raw}`).digest();
}

export function secretsAvailable(env = process.env): boolean {
  return key(env) !== null;
}

/** "v1.<iv>.<tag>.<data>" in base64url. Throws when MEMBERS_SECRET_KEY isn't set. */
export function encryptSecret(plain: string, env = process.env): string {
  const k = key(env);
  if (!k) throw new Error("MEMBERS_SECRET_KEY isn't set on the engine.");
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", k, iv);
  const data = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return ["v1", iv.toString("base64url"), c.getAuthTag().toString("base64url"), data.toString("base64url")].join(".");
}

/** The secret, or null when it can't be read (wrong key, tampered, missing setting). Never throws. */
export function decryptSecret(sealed: string, env = process.env): string | null {
  const k = key(env);
  const parts = sealed.split(".");
  if (!k || parts.length !== 4 || parts[0] !== "v1") return null;
  try {
    const d = createDecipheriv("aes-256-gcm", k, Buffer.from(parts[1]!, "base64url"));
    d.setAuthTag(Buffer.from(parts[2]!, "base64url"));
    return Buffer.concat([d.update(Buffer.from(parts[3]!, "base64url")), d.final()]).toString("utf8");
  } catch {
    return null;
  }
}
