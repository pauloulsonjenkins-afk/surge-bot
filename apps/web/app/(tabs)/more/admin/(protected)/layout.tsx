import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { ADMIN_COOKIE_NAME, verifySessionToken } from "@/server/auth";
import AdminLogoutButton from "@/components/nav/AdminLogoutButton";
import AdminNav from "@/components/nav/AdminNav";

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
      <header className="flex items-center justify-between border-b border-line px-4 py-3 lg:border-b-0 lg:pb-0">
        <p className="text-xs font-medium uppercase tracking-wide text-ink-muted">Admin</p>
        <AdminLogoutButton />
      </header>

      <AdminNav />

      <div className="flex-1 px-4 py-4">{children}</div>
    </div>
  );

}