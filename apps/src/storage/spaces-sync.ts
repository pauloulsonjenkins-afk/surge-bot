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
 *
 * Deploys:  during a deploy DigitalOcean briefly runs the old and the new
 *           container side by side. Without care both upload, and whichever
 *           writes last wins: the old container's final upload on shutdown can
 *           overwrite the new one's database. So the Space holds a small lease
 *           (lease.json: which container owns the backup, refreshed every
 *           minute). A container that finds someone else holding a live lease
 *           stops uploading and tells main.ts, which disconnects its Telegram
 *           listener. If the new owner's lease goes stale (it crashed or its
 *           deploy was rolled back), the old container takes the lease back.
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

  private get leaseKey(): string {
    const dir = posix.dirname(this.cfg.objectKey);
    return posix.join(dir === "." ? "" : dir, "lease.json");
  }

  /** Who holds the backup lease and when they last refreshed it; null if there is no lease yet. */
  async readLease(): Promise<{ owner: string; at: number } | null> {
    try {
      const res = await this.s3.send(new GetObjectCommand({ Bucket: this.cfg.bucket, Key: this.leaseKey }));
      const text = res.Body ? await res.Body.transformToString() : "";
      const lease = JSON.parse(text) as { owner?: unknown; at?: unknown };
      return typeof lease.owner === "string" && typeof lease.at === "number" ? { owner: lease.owner, at: lease.at } : null;
    } catch (err) {
      if (err instanceof S3ServiceException && err.name === "NoSuchKey") return null;
      throw err;
    }
  }

  async writeLease(owner: string): Promise<void> {
    await this.s3.send(
      new PutObjectCommand({
        Bucket: this.cfg.bucket,
        Key: this.leaseKey,
        Body: JSON.stringify({ owner, at: Date.now() }),
        ContentType: "application/json",
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

/** A lease not refreshed for this long is treated as abandoned. */
const LEASE_STALE_MS = 3 * 60 * 1000;

export class BackupScheduler {
  private dirty = false;
  private owner = true;
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
    /** This container's id for the backup lease. */
    private readonly instanceId: string = "single",
    /** Called once when another container takes over the backup (a newer deploy). */
    private readonly onLostOwnership: () => void = () => {},
  ) {}

  /** Checks the lease before an upload. Returns true if this container may upload. */
  private async holdLease(): Promise<boolean> {
    const lease = await this.sync.readLease();
    const foreignAndLive = lease !== null && lease.owner !== this.instanceId && Date.now() - lease.at < LEASE_STALE_MS;
    if (foreignAndLive) {
      if (this.owner) {
        this.owner = false;
        log.warn("A newer container holds the backup lease: this container stops uploading and hands over.");
        this.onLostOwnership();
      }
      return false;
    }
    if (!this.owner) log.warn("The backup lease was abandoned by the newer container; this container is taking it back.");
    this.owner = true;
    await this.sync.writeLease(this.instanceId);
    return true;
  }

  start(): void {
    this.retryTimer = setInterval(() => {
      // Refreshes the lease every tick even with nothing to upload, so it never looks abandoned.
      if (this.dirty) void this.runUpload();
      else void this.holdLease().catch((err) => log.error(`Could not refresh the backup lease: ${describe(err)}`));
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
      if (!(await this.holdLease())) return;
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