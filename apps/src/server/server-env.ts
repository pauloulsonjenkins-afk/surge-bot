/**
 * Settings for the engine's web service (webhook receiver + SQLite/Spaces
 * storage). Betfair credentials and the live-trading flags are NOT read here:
 * they stay in src/config/env.ts, exactly as before.
 *
 * Every value comes from an environment variable set in the DigitalOcean
 * dashboard. Anything required and missing stops the service at startup with
 * a message naming the variable, rather than running half-configured.
 */

export interface SpacesConfig {
  bucket: string;
  endpoint: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** Object key of the live database copy, e.g. "engine/engine.db". */
  objectKey: string;
}

export interface ServerEnv {
  port: number;
  dbPath: string;
  webhookPathToken: string;
  /** Null until InPlayGuru gives you a signing secret. */
  signingSecret: string | null;
  /** Name of the header InPlayGuru puts its signature in. */
  signatureHeader: string | null;
  spaces: SpacesConfig;
}

const MIN_PATH_TOKEN_LENGTH = 32;

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable ${name}. Set it in the DigitalOcean dashboard.`);
  }
  return value;
}

function optional(name: string): string | null {
  const value = process.env[name]?.trim();
  return value ? value : null;
}

export function loadServerEnv(): ServerEnv {
  const webhookPathToken = required("INPLAYGURU_WEBHOOK_PATH_TOKEN");
  if (webhookPathToken.length < MIN_PATH_TOKEN_LENGTH || !/^[A-Za-z0-9_-]+$/.test(webhookPathToken)) {
    throw new Error(
      `INPLAYGURU_WEBHOOK_PATH_TOKEN must be at least ${MIN_PATH_TOKEN_LENGTH} characters, ` +
        "using only letters, digits, - and _ (it goes in a URL).",
    );
  }

  const signingSecret = optional("INPLAYGURU_SIGNING_SECRET");
  const signatureHeader = optional("INPLAYGURU_SIGNATURE_HEADER")?.toLowerCase() ?? null;
  if (signingSecret && !signatureHeader) {
    throw new Error(
      "INPLAYGURU_SIGNING_SECRET is set but INPLAYGURU_SIGNATURE_HEADER is not. " +
        "Set it to the header name InPlayGuru's webhook documentation gives for the signature.",
    );
  }

  const region = optional("SPACES_REGION");
  const endpoint = optional("SPACES_ENDPOINT") ?? (region ? `https://${region}.digitaloceanspaces.com` : null);
  if (!endpoint) {
    throw new Error("Set SPACES_REGION (e.g. lon1) to the region your surgebackup Space is in.");
  }

  const portText = process.env.PORT?.trim() || "8080";
  const port = Number(portText);
  if (!Number.isInteger(port) || port <= 0) {
    throw new Error(`PORT must be a whole number, got "${portText}".`);
  }

  return {
    port,
    dbPath: optional("ENGINE_DB_PATH") ?? "/tmp/engine-data/engine.db",
    webhookPathToken,
    signingSecret,
    signatureHeader,
    spaces: {
      bucket: optional("SPACES_BUCKET") ?? "surgebackup",
      endpoint,
      accessKeyId: required("SPACES_ACCESS_KEY_ID"),
      secretAccessKey: required("SPACES_SECRET_ACCESS_KEY"),
      objectKey: optional("SPACES_OBJECT_KEY") ?? "engine/engine.db",
    },
  };
}
