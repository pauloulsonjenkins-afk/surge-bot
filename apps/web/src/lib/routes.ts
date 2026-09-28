/**
 * The pages that exist under /more (other than the admin area). The bottom bar
 * remembers the last of these you visited so the More tab returns there, but it
 * must never remember one that no longer exists, or the tab would open a 404.
 */
const MORE_ROUTES = new Set(["/more", "/more/bots"]);

export function isValidMoreRoute(path: string | null | undefined): path is string {
  return typeof path === "string" && MORE_ROUTES.has(path.replace(/\/+$/, "") || "/");
}
