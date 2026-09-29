/**
 * /internal/users/* routes: website sign-up, sign-in and the admin's user management.
 * Called only by the website's server, with the same ADMIN_INTERNAL_KEY Bearer check as the other
 * /internal routes (done by http.ts before this runs). Passwords are hashed here; hashes never leave.
 *
 *   POST /internal/users/signup      { email, name?, password }        -> { ok } or { error }
 *   POST /internal/users/login       { email, password }               -> { user } or 401 { error }
 *   GET  /internal/users/session     ?id=&sv=                          -> { user } or 401
 *   GET  /internal/users             every user, and whether sign-up is open
 *   POST /internal/users/update      { id, name?, pages?, active?, password?, signOutEverywhere? }
 *   POST /internal/users/delete      { id }
 *   POST /internal/users/settings    { signupsOpen }
 */
import type { ServerResponse } from "node:http";
import type { EngineDb } from "../storage/engine-db";
import { getSignupsOpen, listUsers, logIn, sessionUser, setSignupsOpen, signUp, updateUser } from "./users";
import { log } from "./log";

interface Ctx {
  method: string;
  path: string;
  url: URL;
  db: EngineDb;
  res: ServerResponse;
  send: (res: ServerResponse, status: number, body: Record<string, unknown>) => void;
  readJsonBody: () => Promise<Record<string, unknown>>;
}

const asId = (v: unknown): number | null => (typeof v === "number" && Number.isInteger(v) && v > 0 ? v : null);

/** Returns true when the path was one of the users routes (and a reply was sent). */
export async function handleUsersRoute(c: Ctx): Promise<boolean> {
  const { method, path, url, db, res, send } = c;
  if (path !== "/internal/users" && !path.startsWith("/internal/users/")) return false;

  if (method === "POST" && path === "/internal/users/signup") {
    const body = await c.readJsonBody();
    const r = await signUp(db, { email: body.email, name: body.name, password: body.password });
    if (!r.ok) send(res, 400, { error: r.error });
    else send(res, 200, { ok: true });
    return true;
  }

  if (method === "POST" && path === "/internal/users/login") {
    const body = await c.readJsonBody();
    const r = await logIn(db, { email: body.email, password: body.password });
    if (!r.ok) send(res, 401, { error: r.error });
    else send(res, 200, { user: r.user });
    return true;
  }

  if (method === "GET" && path === "/internal/users/session") {
    const id = Number(url.searchParams.get("id"));
    const sv = Number(url.searchParams.get("sv"));
    const user = Number.isInteger(id) && Number.isInteger(sv) ? sessionUser(db, id, sv) : null;
    if (!user) send(res, 401, { error: "no_session" });
    else send(res, 200, { user });
    return true;
  }

  if (method === "GET" && path === "/internal/users") {
    send(res, 200, { users: listUsers(db), signupsOpen: getSignupsOpen(db) });
    return true;
  }

  if (method === "POST" && path === "/internal/users/update") {
    const body = await c.readJsonBody();
    const id = asId(body.id);
    if (id === null) { send(res, 400, { error: "id_required" }); return true; }
    const r = await updateUser(db, id, body);
    if (!r.ok) { send(res, r.error === "not_found" ? 404 : 400, { error: r.error }); return true; }
    log.info(`User ${id} was updated from the admin page.`);
    send(res, 200, { user: r.user });
    return true;
  }

  if (method === "POST" && path === "/internal/users/delete") {
    const body = await c.readJsonBody();
    const id = asId(body.id);
    if (id === null) { send(res, 400, { error: "id_required" }); return true; }
    if (!db.deleteAppUser(id)) { send(res, 404, { error: "not_found" }); return true; }
    log.info(`User ${id} was deleted from the admin page.`);
    send(res, 200, { ok: true });
    return true;
  }

  if (method === "POST" && path === "/internal/users/settings") {
    const body = await c.readJsonBody();
    if (typeof body.signupsOpen !== "boolean") { send(res, 400, { error: "signupsOpen_must_be_true_or_false" }); return true; }
    setSignupsOpen(db, body.signupsOpen);
    log.info(`New user sign-ups were switched ${body.signupsOpen ? "ON" : "OFF"} from the admin page.`);
    send(res, 200, { signupsOpen: body.signupsOpen });
    return true;
  }

  send(res, 404, { error: "not_found" });
  return true;
}
