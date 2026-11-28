import { redirect } from "next/navigation";
import { isAdmin } from "@/server/access";
import AdminSubNav from "@/components/nav/AdminSubNav";

/** Every admin page checks the session on the server here, whatever the browser claims. */
export default async function ProtectedAdminLayout({ children }: { children: React.ReactNode }) {
  if (!(await isAdmin())) redirect("/more/admin/login");
  return (
    // The header (logo, notifications, theme, Sign out) is the tabs layout's AdminTopBar; this layout adds the section's tabs.
    <div className="flex min-h-full flex-col">
      <div className="flex-1 px-4 py-4">
        <AdminSubNav />
        {children}
      </div>
    </div>
  );
}
