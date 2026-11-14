import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { ADMIN_COOKIE_NAME, verifySessionToken } from "@/server/auth";
import AdminSubNav from "@/components/nav/AdminSubNav";

export default async function ProtectedAdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Authoritative check. Runs server-side on every request to any nested
  // admin route — a client-side flag can't substitute for this because it
  // never touches the actual secret and can be flipped in devtools.
  const token = (await cookies()).get(ADMIN_COOKIE_NAME)?.value;
  const authed = await verifySessionToken(token);

  if (!authed) {
    redirect("/more/admin/login");
  }

  return (
    // The header (logo, notifications, theme, Sign out) is the tabs layout's AdminTopBar, the same on every page; this
    // layout adds the section's tabs where a page has others under it.
    <div className="flex min-h-full flex-col">
      <div className="flex-1 px-4 py-4">
        <AdminSubNav />
        {children}
      </div>
    </div>
  );

}