/**
 * A local engine for looking at the website, with made-up data (12 Nov 2026).
 *
 *   npx tsx scripts/dev-engine.ts          (from apps/; listens on http://localhost:8091)
 *
 * It serves the same routes as the real engine from a throwaway database filled with invented alerts and results, so
 * the signed-in pages can be opened and checked on this machine. It has NO connection to Telegram, Betfair, InPlayGuru
 * or the backup Space, and it cannot place a bet: none of those are started here. Nothing it holds is real.
 *
 * The site reads it when apps/web/.env.local has ENGINE_BASE_URL=http://localhost:8091 and the same ADMIN_INTERNAL_KEY
 * as this process.
 */
import "../src/telegram/use-new-layer";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EngineDb } from "../src/storage/engine-db";
import { parseAlert } from "../src/inplayguru/parse-alert";
import { recordSimBets, saveSendingSettings } from "../src/inplayguru/bet-feed";
import { loadCustomSegments } from "../src/server/golden";
import { createEngineHttpServer } from "../src/server/http";

const PORT = Number(process.env.PORT ?? 8091);
// The key the site calls with: taken from apps/web/.env.local when it isn't in the environment, so both always match.
if (!process.env.ADMIN_INTERNAL_KEY) {
  try {
    const line = readFileSync(join(__dirname, "..", "web", ".env.local"), "utf8").split(/\r?\n/).find((l) => l.startsWith("ADMIN_INTERNAL_KEY="));
    if (line) process.env.ADMIN_INTERNAL_KEY = line.slice("ADMIN_INTERNAL_KEY=".length).trim();
  } catch {
    // no file: reported below
  }
}
if (!process.env.ADMIN_INTERNAL_KEY) {
  console.error("Set ADMIN_INTERNAL_KEY, or put it in apps/web/.env.local, before starting.");
  process.exit(1);
}

/** A small repeatable random source, so the made-up data is the same on every run. */
function rng(seed: number) {
  let s = seed;
  return () => ((s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296);
}

const STRATEGIES: Array<{ name: string; hitRate: number; perDay: number }> = [
  { name: "Blistering Momentum", hitRate: 0.69, perDay: 5 },
  { name: "Time to fight", hitRate: 0.63, perDay: 7 },
  { name: "Home Pressure", hitRate: 0.66, perDay: 4 },
  { name: "Favourite pressure 2nd half", hitRate: 0.6, perDay: 3 },
  { name: "Pass Master 1st half", hitRate: 0.58, perDay: 2 },
];
const LEAGUES = ["🇫🇷 France Ligue 1", "🏴󠁧󠁢󠁥󠁮󠁧󠁿 England Championship", "🇩🇪 Germany Bundesliga", "🇪🇸 Spain La Liga 2", "🇳🇱 Netherlands Eredivisie", "🇯🇵 Japan J1 League"];
const TEAMS = ["Ajax", "Lyon", "Leeds", "Hamburg", "Girona", "Kyoto", "Nantes", "Stoke", "Mainz", "Elche", "Utrecht", "Kobe", "Reims", "Hull", "Bochum", "Levante"];

function alertText(strategy: string, league: string, home: string, away: string, minute: number, goals: [number, number], odds: number, result: "hit" | "miss" | null): string {
  const total = goals[0] + goals[1];
  const open = [
    `🔔 ${strategy}`, "", `${league} (3rd vs 9th)`, `${home} vs ${away}`, "", `Timer: ${minute}'`, `Goals: ${goals[0]} - ${goals[1]}`,
    `Over/Under ${total}.50 Odds:`, `${odds.toFixed(2)} ${(odds + 0.25).toFixed(2)}`,
  ];
  if (result === null) return open.join("\n");
  const full = result === "hit" ? `${goals[0] + 1}-${goals[1]}` : `${goals[0]}-${goals[1]}`;
  return [...open, "", "⸻⸻ Match Summary ⸻⸻", "Half-Time Score: 0-0", `Full-Time Score: ${full}`, "", result === "hit" ? "✅ Hit" : "❌ Miss"].join("\n");
}

function seed(db: EngineDb): number {
  const rand = rng(20261112);
  const pick = <T,>(xs: T[]) => xs[Math.floor(rand() * xs.length)]!;
  saveSendingSettings(db, { enabled: true, dailyCap: 1000, matchCap: 1000, stakes: Object.fromEntries(STRATEGIES.map((s) => [s.name.toLowerCase(), 1])) });
  const DAYS = 45;
  const start = Date.now() - DAYS * 86_400_000;
  recordSimBets(db, new Date(start - 60_000));
  let id = 1;
  for (let day = 0; day < DAYS; day++) {
    for (const s of STRATEGIES) {
      for (let k = 0; k < s.perDay; k++) {
        const at = new Date(start + day * 86_400_000 + (12 + rand() * 9) * 3_600_000);
        const iso = at.toISOString();
        const home = pick(TEAMS);
        let away = pick(TEAMS);
        if (away === home) away = `${home} B`;
        const minute = 46 + Math.floor(rand() * 30);
        const goals: [number, number] = [Math.floor(rand() * 2), Math.floor(rand() * 2)];
        const odds = 1.35 + rand() * 0.5;
        const league = pick(LEAGUES);
        const open = alertText(s.name, league, home, away, minute, goals, odds, null);
        db.upsertLivePick("dev", id, open, parseAlert(open), iso);
        recordSimBets(db, new Date(at.getTime() + 1_000));
        // The last few hours stay open, so Live and Today have something still in play.
        if (at.getTime() < Date.now() - 3 * 3_600_000) {
          const result = rand() < s.hitRate ? "hit" : "miss";
          const done = alertText(s.name, league, home, away, minute, goals, odds, result);
          db.upsertLivePick("dev", id, done, parseAlert(done), iso);
        }
        id++;
      }
    }
  }
  return id - 1;
}

const dir = mkdtempSync(join(tmpdir(), "goalbrew-dev-"));
const db = new EngineDb(join(dir, "engine.db"), () => {});
loadCustomSegments(db);
const made = seed(db);
const backups = { getStatus: () => ({ lastSuccessAt: null, lastError: null, pendingChanges: false }) };
createEngineHttpServer({} as never, db, backups as never).listen(PORT, "127.0.0.1", () => {
  console.log(`Dev engine with ${made} made-up alerts on http://localhost:${PORT} (database in ${dir}). Not connected to Telegram, Betfair or backups.`);
});
