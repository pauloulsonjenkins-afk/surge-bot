import { DashboardBody } from "@/components/dashboard/DashboardBody";

/**
 * The Dashboard for a visitor (while Public view is on) or someone given the page. The admin is sent on to Home, which
 * shows these same figures under the day's status (proxy.ts; 14 Nov 2026).
 */
export default function DashboardPage() {
  return <DashboardBody />;
}
