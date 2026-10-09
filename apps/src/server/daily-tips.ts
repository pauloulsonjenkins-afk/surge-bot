/**
 * The day's four horse tips, read from the tipster's members' page by the engine itself, so it works with no PC on.
 *
 * Once a day it picks a random moment between 10:00 and 14:00 UK time, signs in with the account in the environment,
 * opens the tips page, reads the NAP / NB / Extra lines and stores them as SUGGESTIONS on the Horses page (see
 * saveHorseSuggestions: nothing is staked or bet). If anything fails it tries twice more, 20 minutes apart, and then
 * sends a phone notification and shows the reason on the Horses page.
 *
 * Settings (DigitalOcean, engine component):
 *   TIPS_LOGIN_URL, TIPS_PAGE_URL   the sign-in page and the daily tips page
 *   TIPS_EMAIL, TIPS_PASSWORD       the account (encrypted)
 *   TIPS_IGNORE_CERT_ERRORS=yes     only while the site's security certificate is broken; the risk was accepted by the
 *                                   admin on 2026-10-08. Without it a broken certificate stops the sign-in.
 * Without TIPS_LOGIN_URL / TIPS_EMAIL / TIPS_PASSWORD it does nothing.
 *
 * It is a plain web sign-in (a form with an anti-forgery token and cookies), no browser needed.
 */
import { request as httpsRequest, Agent } from "node:https";
import { request as httpRequest } from "node:http";
import type { EngineDb } from "../storage/engine-db";
import { getHorseImportStatus, saveHorseSuggestions, setHorseImportStatus } from "./horses";
import { sendPush } from "./push";
import { ukDateOf, ukDayBounds } from "./uk-time";
import { log } from "./log";

const PLAN_KEY = "horse_tips_plan";
const WINDOW_START_H = 10;
const WINDOW_END_H = 14;
const MAX_ATTEMPTS = 3;
const RETRY_MS = 20 * 60_000;

// --------------------------------------------------------------------------- reading the page

const ENTITIES: Record<string, string> = { nbsp: " ", amp: "&", lt: "<", gt: ">", quot: '"', rsquo: "'", lsquo: "'", ndash: "-", mdash: "-", "#39": "'" };

/** An HTML fragment as plain text. */
export function htmlText(s: string): string {
  return s
    .replace(/<[^>]+>/g, " ")
    .replace(/&(#\d+|[a-z]+);/gi, (m, e: string) => ENTITIES[e.toLowerCase()] ?? (e.startsWith("#") ? String.fromCharCode(Number(e.slice(1))) : m))
    .replace(/\s+/g, " ")
    .trim();
}

// One line per selection, e.g. "NAP- 5.13 Ayr- Horse Name- 1/1 (1.5 Points Win)" or "... (0.5 Points Each-Way) *4 Places*".
const LINE_RE =
  /^(?:NAP|NB|Next Best|Extra)\s*[-:]\s*(\d{1,2})[.:](\d{2})\s+([^-]+?)\s*-\s*(.+?)\s*-\s*(\d{1,3}\s*\/\s*\d{1,3}|evens|evs)\b(.*)$/i;

export interface TipLine {
  horse: string;
  course: string;
  raceTime: string;
  odds: string;
  betType: "win" | "ew";
  ewPlaces: number | null;
  points: string | null;
}

/** The tips in the order the page lists them (1 = NAP). Race times have no am/pm: under 10 means afternoon. */
export function readTips(html: string): TipLine[] {
  const out: TipLine[] = [];
  for (const m of html.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)) {
    const line = LINE_RE.exec(htmlText(m[1] ?? ""));
    if (!line) continue;
    const [, h, min, course, horse, odds, rest = ""] = line;
    const hour = Number(h) < 10 ? Number(h) + 12 : Number(h);
    const ew = /each[- ]?way/i.test(rest);
    const places = /(\d+)\s*places/i.exec(rest);
    const points = /([\d.]+)\s*points?/i.exec(rest);
    out.push({
      horse: horse!.trim(),
      course: course!.trim(),
      raceTime: `${String(hour).padStart(2, "0")}:${min}`,
      odds: odds!.replace(/\s+/g, "").toLowerCase().replace(/^evs$/, "evens"),
      betType: ew ? "ew" : "win",
      ewPlaces: ew && places ? Number(places[1]) : null,
      points: points ? points[1]! : null,
    });
  }
  return out;
}

// --------------------------------------------------------------------------- a small web client with cookies

interface Reply {
  status: number;
  location: string | null;
  body: string;
}

class Session {
  private cookies = new Map<string, string>();
  private agent: Agent;

  constructor(ignoreCertErrors: boolean) {
    this.agent = new Agent({ rejectUnauthorized: !ignoreCertErrors, keepAlive: false });
  }

  private send(url: URL, method: "GET" | "POST", form?: Record<string, string>): Promise<Reply> {
    const body = form ? new URLSearchParams(form).toString() : undefined;
    const headers: Record<string, string> = {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
      Accept: "text/html,application/xhtml+xml",
      "Accept-Language": "en-GB,en;q=0.9",
    };
    if (this.cookies.size) headers.Cookie = [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; ");
    if (body) {
      headers["Content-Type"] = "application/x-www-form-urlencoded";
      headers["Content-Length"] = String(Buffer.byteLength(body));
    }
    const secure = url.protocol === "https:";
    return new Promise((resolve, reject) => {
      const req = (secure ? httpsRequest : httpRequest)(url, { method, headers, ...(secure ? { agent: this.agent } : {}), timeout: 30_000 }, (res) => {
        for (const c of res.headers["set-cookie"] ?? []) {
          const [pair] = c.split(";");
          const eq = pair!.indexOf("=");
          if (eq > 0) this.cookies.set(pair!.slice(0, eq).trim(), pair!.slice(eq + 1).trim());
        }
        const chunks: Buffer[] = [];
        res.on("data", (d: Buffer) => chunks.push(d));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, location: res.headers.location ?? null, body: Buffer.concat(chunks).toString("utf8") }));
      });
      req.on("timeout", () => req.destroy(new Error("the site took too long to answer")));
      req.on("error", reject);
      if (body) req.write(body);
      req.end();
    });
  }

  /** Follows redirects (a sign-in answers with one), up to five. */
  async go(url: string, method: "GET" | "POST" = "GET", form?: Record<string, string>): Promise<Reply & { url: string }> {
    let u = new URL(url);
    let r = await this.send(u, method, form);
    for (let i = 0; i < 5 && r.status >= 300 && r.status < 400 && r.location; i++) {
      u = new URL(r.location, u);
      r = await this.send(u, "GET");
    }
    return { ...r, url: u.toString() };
  }
}

/** Signs in and reads today's tips. Throws a plain-English reason when it can't. */
export async function fetchTips(env: NodeJS.ProcessEnv = process.env): Promise<TipLine[]> {
  const loginUrl = env.TIPS_LOGIN_URL?.trim();
  const pageUrl = env.TIPS_PAGE_URL?.trim();
  const email = env.TIPS_EMAIL?.trim();
  const password = env.TIPS_PASSWORD ?? "";
  if (!loginUrl || !pageUrl || !email || !password) throw new Error("TIPS_LOGIN_URL, TIPS_PAGE_URL, TIPS_EMAIL and TIPS_PASSWORD must be set on the engine.");
  const s = new Session(["1", "yes", "true"].includes((env.TIPS_IGNORE_CERT_ERRORS ?? "").trim().toLowerCase()));

  let page;
  try {
    page = await s.go(loginUrl);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/certificate|CERT_/i.test(msg)) throw new Error("The tips site's security certificate is broken. Set TIPS_IGNORE_CERT_ERRORS=yes on the engine to carry on anyway.");
    throw new Error(`Couldn't open the sign-in page: ${msg}`);
  }
  const token = /name="__RequestVerificationToken"[^>]*value="([^"]+)"/i.exec(page.body)?.[1];
  if (!token) throw new Error("The sign-in page has changed (no sign-in form found).");
  const after = await s.go(page.url, "POST", { Email: email, Password: password, __RequestVerificationToken: token, RememberMe: "false" });
  if (/type="password"/i.test(after.body) && /name="__RequestVerificationToken"/i.test(after.body)) {
    throw new Error("Sign-in failed: the email or password was refused.");
  }

  const tips = await s.go(pageUrl);
  if (/type="password"/i.test(tips.body)) throw new Error("Signed in, but the tips page asked to sign in again.");
  const found = readTips(tips.body);
  if (found.length === 0) throw new Error("No tips found on the tips page: they may not be up yet, or the page layout changed.");
  return found.slice(0, 4);
}

// --------------------------------------------------------------------------- the daily run

interface Plan {
  day: string;
  /** When to run, ISO. */
  at: string;
  attempts: number;
}

function getPlan(db: EngineDb): Plan | null {
  try {
    const raw = db.getSetting(PLAN_KEY);
    return raw ? (JSON.parse(raw) as Plan) : null;
  } catch {
    return null;
  }
}

/** A random moment in today's window; straight away when the engine starts after the window has passed. */
export function planFor(day: string, now: Date, random = Math.random): Plan {
  const midnight = Date.parse(ukDayBounds(day).from);
  const open = midnight + WINDOW_START_H * 3_600_000;
  const close = midnight + WINDOW_END_H * 3_600_000;
  const earliest = Math.max(open, now.getTime());
  const at = earliest >= close ? now.getTime() : earliest + random() * (close - earliest);
  return { day, at: new Date(at).toISOString(), attempts: 0 };
}

/** Today's tips are in when the last successful import was for today. */
function doneToday(db: EngineDb, day: string): boolean {
  const s = getHorseImportStatus(db);
  return !!s && s.ok && s.day === day;
}

let running = false;

/** One check, run every minute: plan today's moment if needed, and fetch once it has come. */
export async function tipsTick(db: EngineDb, now = new Date(), fetcher: () => Promise<TipLine[]> = () => fetchTips()): Promise<void> {
  if (running) return;
  const day = ukDateOf(now);
  if (doneToday(db, day)) return;
  let plan = getPlan(db);
  if (!plan || plan.day !== day) {
    plan = planFor(day, now);
    db.setSetting(PLAN_KEY, JSON.stringify(plan));
    log.info(`Horse tips: today's fetch is planned for ${new Date(plan.at).toLocaleTimeString("en-GB", { timeZone: "Europe/London" })} UK time.`);
  }
  if (plan.attempts >= MAX_ATTEMPTS || now.getTime() < Date.parse(plan.at)) return;

  running = true;
  plan.attempts++;
  try {
    const tips = await fetcher();
    const stored = saveHorseSuggestions(db, day, tips, "tips");
    setHorseImportStatus(db, { at: new Date().toISOString(), ok: true, message: `${stored.length} tips in`, day, count: stored.length });
    log.info(`Horse tips: ${stored.length} stored for ${day}.`);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    log.warn(`Horse tips: attempt ${plan.attempts} of ${MAX_ATTEMPTS} failed: ${reason}`);
    if (plan.attempts >= MAX_ATTEMPTS) {
      setHorseImportStatus(db, { at: new Date().toISOString(), ok: false, message: reason.slice(0, 300), day: null, count: 0 });
      await sendPush(db, { title: "Horse tips not in today", body: reason.slice(0, 180), url: "/more/admin/horses", tag: "horse-import" });
    } else {
      plan.at = new Date(now.getTime() + RETRY_MS).toISOString();
    }
  } finally {
    db.setSetting(PLAN_KEY, JSON.stringify(plan));
    running = false;
  }
}

/** Starts the daily tips fetch when the account is set up on the engine. */
export function startDailyTips(db: EngineDb): void {
  if (!process.env.TIPS_LOGIN_URL || !process.env.TIPS_EMAIL || !process.env.TIPS_PASSWORD) {
    log.info("Horse tips: not set up (TIPS_LOGIN_URL, TIPS_PAGE_URL, TIPS_EMAIL, TIPS_PASSWORD), so nothing is fetched.");
    return;
  }
  const tick = () => void tipsTick(db).catch((err) => log.warn(`Horse tips: ${err instanceof Error ? err.message : String(err)}`));
  setTimeout(tick, 30_000).unref?.();
  setInterval(tick, 60_000).unref?.();
}
