/**
 * Keeps the engine's SQLite file backed up in a DigitalOcean Space.
 *
 * Startup:  download the latest copy from the Space before opening the database.
 *           If the Space can't be reached (wrong key, wrong bucket, network),
 *           the service refuses to start. Starting with an empty database and
 *           then uploading it would overwrite the real backup, so a loud
 *           failure is the safe outcome. Only "this object doesn't exist yet"
 *           (the very first run) starts fresh.
 *
 * Running:  after each change, wait a few seconds for more changes, then
 *           upload a consistent snapshot. A timer retries if an upload failed.
 *           The first upload each day also writes a dated copy under daily/,
 *           so one bad overwrite can never destroy all history.
 *
 * Shutdown: DigitalOcean sends SIGTERM before replacing the container;
 *           main.ts calls flush() then, so the last changes are uploaded.
 */
import { GetObjectCommand, PutObjectCommand, S3Client, S3ServiceException } from "@aws-sdk/client-s3";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, posix } from "node:path";
import type { SpacesConfig } from "../server/server-env";
import type { EngineDb } from "./engine-db";
import { log } from "../server/log";

export class SpacesSync {
  private readonly s3: S3Client;

  constructor(private readonly cfg: SpacesConfig) {
    this.s3 = new S3Client({
      endpoint: cfg.endpoint,
      // DigitalOcean's own docs use "us-east-1" here; the endpoint picks the real region.
      region: "us-east-1",
      forcePathStyle: false,
      credentials: { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey },
      // Newer AWS SDKs add checksum headers some S3-compatible stores reject; only send them when required.
      requestChecksumCalculation: "WHEN_REQUIRED",
      responseChecksumValidation: "WHEN_REQUIRED",
    });
  }

  get description(): string {
    return `${this.cfg.bucket}/${this.cfg.objectKey}`;
  }

  /** Downloads the backup to `localPath`. Throws on anything except "no backup exists yet". */
  async restoreTo(localPath: string): Promise<"restored" | "no-backup-yet"> {
    try {
      const res = await this.s3.send(new GetObjectCommand({ Bucket: this.cfg.bucket, Key: this.cfg.objectKey }));
      if (!res.Body) throw new Error("Space returned an empty response body");
      const bytes = await res.Body.transformToByteArray();
      mkdirSync(dirname(localPath), { recursive: true });
      writeFileSync(localPath, bytes);
      return "restored";
    } catch (err) {
      if (err instanceof S3ServiceException && err.name === "NoSuchKey") return "no-backup-yet";
      throw new Error(`Could not read the database backup from ${this.description}: ${describe(err)}`);
    }
  }

  async upload(key: string, bytes: Buffer): Promise<void> {
    await this.s3.send(
      new PutObjectCommand({
        Bucket: this.cfg.bucket,
        Key: key,
        Body: bytes,
        ContentType: "application/vnd.sqlite3",
        ACL: "private",
      }),
    );
  }

  get liveKey(): string {
    return this.cfg.objectKey;
  }

  dailyKey(day: string): string {
    const dir = posix.dirname(this.cfg.objectKey);
    const base = posix.basename(this.cfg.objectKey).replace(/\.db$/i, "");
    return posix.join(dir === "." ? "" : dir, "daily", `${base}-${day}.db`);
  }
}

export interface BackupStatus {
  lastSuccessAt: string | null;
  lastError: string | null;
  pendingChanges: boolean;
}

export class BackupScheduler {
  private dirty = false;
  private debounce: NodeJS.Timeout | null = null;
  private retryTimer: NodeJS.Timeout | null = null;
  private inFlight: Promise<void> | null = null;
  private lastDailyCopy: string | null = null;
  private status: BackupStatus = { lastSuccessAt: null, lastError: null, pendingChanges: false };

  constructor(
    private readonly db: EngineDb,
    private readonly sync: SpacesSync,
    private readonly snapshotPath: string,
    private readonly debounceMs = 5_000,
    private readonly retryMs = 60_000,
  ) {}

  start(): void {
    this.retryTimer = setInterval(() => {
      if (this.dirty) void this.runUpload();
    }, this.retryMs);
  }

  markDirty(): void {
    this.dirty = true;
    if (this.debounce) clearTimeout(this.debounce);
    this.debounce = setTimeout(() => void this.runUpload(), this.debounceMs);
  }

  getStatus(): BackupStatus {
    return { ...this.status, pendingChanges: this.dirty };
  }

  /** Uploads any outstanding changes and waits for it to finish. Call on shutdown. */
  async flush(): Promise<void> {
    if (this.debounce) clearTimeout(this.debounce);
    if (this.retryTimer) clearInterval(this.retryTimer);
    if (this.inFlight) await this.inFlight;
    if (this.dirty) await this.runUpload();
  }

  private runUpload(): Promise<void> {
    // One upload at a time; a change during an upload leaves `dirty` set,
    // so the debounce or retry timer picks it up afterwards.
    if (this.inFlight) return this.inFlight;
    this.inFlight = this.uploadOnce().finally(() => {
      this.inFlight = null;
    });
    return this.inFlight;
  }

  private async uploadOnce(): Promise<void> {
    this.dirty = false;
    try {
      mkdirSync(dirname(this.snapshotPath), { recursive: true });
      if (existsSync(this.snapshotPath)) rmSync(this.snapshotPath);
      await this.db.snapshotTo(this.snapshotPath);
      const bytes = readFileSync(this.snapshotPath);

      await this.sync.upload(this.sync.liveKey, bytes);

      const today = new Date().toISOString().slice(0, 10);
      if (this.lastDailyCopy !== today) {
        await this.sync.upload(this.sync.dailyKey(today), bytes);
        this.lastDailyCopy = today;
      }

      this.status.lastSuccessAt = new Date().toISOString();
      this.status.lastError = null;
      log.info(`Database backed up to ${this.sync.description} (${bytes.length} bytes).`);
    } catch (err) {
      this.dirty = true; // try again on the next timer tick
      this.status.lastError = describe(err);
      log.error(`Backup to ${this.sync.description} failed; will retry. ${describe(err)}`);
    } finally {
      if (existsSync(this.snapshotPath)) rmSync(this.snapshotPath);
    }
  }
}

function describe(err: unknown): string {
  if (err instanceof Error) return `${err.name}: ${err.message}`;
  return String(err);
}
