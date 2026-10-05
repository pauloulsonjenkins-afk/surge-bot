/**
 * Trial-abuse protection on the email address (there is no email verification yet, see MEMBERS_PLATFORM.md):
 *   - one trial per normalised address, ever: "Jo.Smith+goalbrew@gmail.com" and "josmith@googlemail.com" are the same;
 *   - throwaway (disposable) inbox domains can sign up for Free, but can't start a trial.
 */

const GMAIL = new Set(["gmail.com", "googlemail.com"]);

/** The address a trial is claimed under: lower case, without a +tag, and for Gmail without dots. */
export function emailKey(email: string): string {
  const at = email.trim().toLowerCase().lastIndexOf("@");
  if (at < 1) return email.trim().toLowerCase();
  let local = email.trim().toLowerCase().slice(0, at);
  let domain = email.trim().toLowerCase().slice(at + 1);
  local = local.split("+")[0] ?? local;
  if (GMAIL.has(domain)) {
    local = local.replace(/\./g, "");
    domain = "gmail.com";
  }
  return `${local}@${domain}`;
}

/** Well-known throwaway inbox services. Not exhaustive: it stops the easy cases. */
const DISPOSABLE = new Set([
  "mailinator.com", "guerrillamail.com", "guerrillamail.net", "guerrillamail.org", "sharklasers.com", "grr.la", "10minutemail.com",
  "10minutemail.net", "temp-mail.org", "tempmail.com", "tempmail.net", "tempmailo.com", "temp-mail.io", "tempr.email", "yopmail.com",
  "yopmail.net", "trashmail.com", "trashmail.de", "getnada.com", "nada.email", "dispostable.com", "maildrop.cc", "throwawaymail.com",
  "fakeinbox.com", "mintemail.com", "moakt.com", "emailondeck.com", "mohmal.com", "burnermail.io", "mailnesia.com", "mytemp.email",
  "spamgourmet.com", "mailcatch.com", "discard.email", "tmpmail.org", "tmpmail.net", "minuteinbox.com", "inboxkitten.com", "1secmail.com",
  "1secmail.net", "1secmail.org", "emailfake.com", "fakemail.net", "luxusmail.org", "tempinbox.com", "spambox.us", "mailpoof.com",
  // Privacy relays real people use every day (DuckDuckGo, Apple, AnonAddy) are deliberately not here.
]);

export function isDisposableEmail(email: string): boolean {
  const domain = email.trim().toLowerCase().split("@")[1] ?? "";
  if (!domain) return false;
  if (DISPOSABLE.has(domain)) return true;
  // Subdomains of a throwaway service (e.g. "x.mailinator.com").
  return [...DISPOSABLE].some((d) => domain.endsWith(`.${d}`));
}
