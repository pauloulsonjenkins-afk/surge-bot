import { EmptyState } from "@/components/dashboard/EmptyState";

export default function SchedulePage() {
  return (
    <div className="px-4 py-4">
      <h1 className="text-lg font-medium tracking-tight text-ink">Schedule</h1>
      <EmptyState title="Coming soon" detail="Upcoming matches will appear here." />
    </div>
  );
}
