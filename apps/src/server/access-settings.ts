/**
 * Whether Dashboard, Live and Trade Log data may be seen without signing in.
 *
 * Nothing saved yet means ON, which is how the site behaved before this switch
 * existed. A saved value that can't be read is treated as OFF, so a fault can
 * only ever make the site more private, never less.
 */
import type { EngineDb } from "../storage/engine-db";

const KEY = "access";

export function getPublicView(db: EngineDb): boolean {
  const raw = db.getSetting(KEY);
  if (raw === null) return true;
  try {
    return (JSON.parse(raw) as { publicView?: unknown }).publicView !== false;
  } catch {
    return false;
  }
}

export function setPublicView(db: EngineDb, enabled: boolean): void {
  db.setSetting(KEY, JSON.stringify({ publicView: enabled }));
}
