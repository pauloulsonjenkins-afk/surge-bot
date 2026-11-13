import { Inbox } from "lucide-react";

export function EmptyState({
  title = "Nothing here yet",
  detail,
}: {
  title?: string;
  detail?: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-10 text-center">
      {/* A lit disc with a halo (globals.css .empty-orb), so an empty card still looks finished. */}
      <span className="empty-orb mb-3 flex h-12 w-12 items-center justify-center rounded-full">
        <Inbox size={20} aria-hidden />
      </span>
      <p className="text-sm font-medium text-ink">{title}</p>
      {detail && <p className="max-w-[22ch] text-xs text-ink-muted">{detail}</p>}
    </div>
  );
}
