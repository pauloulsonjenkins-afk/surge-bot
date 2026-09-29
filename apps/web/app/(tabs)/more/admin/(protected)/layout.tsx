import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import Link from "next/link";
import { ADMIN_COOKIE_NAME, verifySessionToken } from "@/server/auth";
import AdminLogoutButton from "@/components/nav/AdminLogoutButton";

const ADMIN_SECTIONS = [
  { href: "/more/admin/picks", label: "Picks" },
  { href: "/more/admin/results", label: "Results" },
  { href: "/more/admin/sending", label: "Sending" },
  { href: "/more/admin/winloss", label: "Win/Loss" },
  { href: "/more/admin/leagues", label: "Leagues" },
  { href: "/more/admin/settings", label: "Settings" },
];

export default async function ProtectedAdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Authoritative check. Runs server-side on every request to any nested
  // admin route — a client-side flag can't substitute for this because it
  // never touches the actual secret and can be flipped in devtools.
  const token = cookies().get(ADMIN_COOKIE_NAME)?.value;
  const authed = await verifySessionToken(token);

  if (!authed) {
    redirect("/more/admin/login");
  }

  return (
    <div className="flex min-h-full flex-col">
      <header className="flex items-center justify-between border-b border-line px-4 py-3">
        <h1 className="text-sm font-medium tracking-tight text-ink">Admin</h1>
        <AdminLogoutButton />
      </header>

      <nav className="flex gap-0.5 overflow-x-auto border-b border-line px-2 py-2">
        {ADMIN_SECTIONS.map((s) => (
          <Link
            key={s.href}
            href={s.href}
            className="shrink-0 rounded-md px-2.5 py-1.5 text-[13px] text-ink-muted hover:bg-surface-2 hover:text-ink"
          >
            {s.label}
          </Link>
        ))}
      </nav>

      <div className="flex-1 px-4 py-4">{children}</div>
    </div>
  );

}
