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
      <span className="flex h-9 w-9 items-center justify-center rounded-full bg-surface-2 text-ink-muted">
        <Inbox size={16} />
      </span>
      <p className="text-sm font-medium text-ink">{title}</p>
      {detail && <p className="max-w-[22ch] text-xs text-ink-muted">{detail}</p>}
    </div>
  );
}
