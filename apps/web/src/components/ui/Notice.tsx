import { CircleAlert, Info, OctagonAlert } from "lucide-react";

/**
 * The one way the site raises something (design review, 8 Nov 2026). Three levels, told apart by a tinted fill and an
 * icon, never by a coloured border (a card's border is always the neutral line):
 *   stop    betting is stopped or paused, or money is at risk            loss red
 *   action  something you should set or fix                             warn amber
 *   info    worth knowing, nothing to do                                  neutral
 * Put the most severe first; a page shows its Notices together at the top, not scattered through cards.
 */
export type NoticeLevel = "stop" | "action" | "info";

const STYLE: Record<NoticeLevel, { box: string; icon: string; Icon: typeof Info; label: string }> = {
  stop: { box: "bg-loss/15", icon: "text-loss", Icon: OctagonAlert, label: "Stopped" },
  action: { box: "bg-warn/10", icon: "text-warn", Icon: CircleAlert, label: "Needs action" },
  info: { box: "bg-surface-2", icon: "text-ink-muted", Icon: Info, label: "Note" },
};

export function Notice({ level, title, children, className = "" }: { level: NoticeLevel; title?: React.ReactNode; children?: React.ReactNode; className?: string }) {
  const s = STYLE[level];
  return (
    <div role={level === "stop" ? "alert" : "status"} className={`flex gap-3 rounded-xl px-3.5 py-3 text-sm text-ink ${s.box} ${className}`}>
      <s.Icon aria-hidden className={`mt-0.5 h-4 w-4 shrink-0 ${s.icon}`} strokeWidth={2.25} />
      <div className="min-w-0 space-y-0.5">
        <span className="sr-only">{s.label}: </span>
        {title && <p className="font-semibold leading-snug">{title}</p>}
        {children && <div className={title ? "text-ink-muted" : ""}>{children}</div>}
      </div>
    </div>
  );
}

/** A small coloured dot that marks a figure or row as needing a look, in place of a coloured border. */
export function AttentionDot({ level = "action", label }: { level?: Exclude<NoticeLevel, "info">; label?: string }) {
  return <span aria-label={label ?? (level === "stop" ? "Stopped" : "Needs a look")} role="img" className={`inline-block h-2 w-2 shrink-0 rounded-full ${level === "stop" ? "bg-loss" : "bg-warn"}`} />;
}
