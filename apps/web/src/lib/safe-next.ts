/** Only same-site paths, so a sign-in link can't send someone to another website. */
export function safeNext(next: string | null | undefined, fallback = "/"): string {
  if (typeof next !== "string" || !next.startsWith("/")) return fallback;
  // Resolved the way the browser will: it drops tabs and line breaks and reads "\" as "/", so "/\t/evil.com" becomes
  // "//evil.com", another site. Only a path that still lands on this site is used.
  const base = "https://goalbrew.invalid";
  try {
    const url = new URL(next, base);
    return url.origin === base ? `${url.pathname}${url.search}${url.hash}` : fallback;
  } catch {
    return fallback;
  }
}
