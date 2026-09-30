import Link from "next/link";
import { ApiFetchError } from "@/queries/fetch-json";

/**
 * Shown when a page's data request fails.
 *  401 = not signed in: offer the right sign-in (admin pages use the admin password, everything else the user sign-in).
 *  403 = signed in, but the admin hasn't given this account this page.
 */
export function QueryError({ error, next }: { error: Error; next: string }) {
  if (error instanceof ApiFetchError && error.status === 401) {
    const adminPage = next.startsWith("/more/admin");
    return (
      <p className="text-sm text-ink-muted">
        Sign in to see this page.{" "}
        <Link
          href={adminPage ? `/more/admin/login?next=${encodeURIComponent(next)}` : `/login?next=${encodeURIComponent(next)}`}
          className="text-accent underline"
        >
          Sign in
        </Link>
        {!adminPage && (
          <>
            {" "}
            or{" "}
            <Link href="/signup" className="text-accent underline">
              create an account
            </Link>
          </>
        )}
      </p>
    );
  }
  if (error instanceof ApiFetchError && error.status === 403) {
    return <p className="text-sm text-ink-muted">Your account doesn&apos;t have access to this page yet. Ask the admin to switch it on.</p>;
  }
  return <p className="text-sm text-destructive">{error.message}</p>;
}
