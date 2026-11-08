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

export interface NoticeItem {
  key: string;
  level: NoticeLevel;
  title: React.ReactNode;
  body?: React.ReactNode;
}

const RANK: Record<NoticeLevel, number> = { stop: 0, action: 1, info: 2 };

/**
 * A page's Notices as one stack: the most severe in full, the rest behind "+N more" (design review: Today showed up to
 * six warning boxes at once, so none stood out). Nothing when there are none.
 */
export function NoticeStack({ items }: { items: NoticeItem[] }) {
  const sorted = [...items].sort((a, b) => RANK[a.level] - RANK[b.level]);
  const [first, ...rest] = sorted;
  if (!first) return null;
  return (
    <div className="space-y-2">
      <Notice level={first.level} title={first.title}>
        {first.body}
      </Notice>
      {rest.length > 0 && (
        <details className="group">
          <summary className="min-h-10 cursor-pointer rounded-lg px-1 text-sm font-medium text-ink-muted hover:text-ink">
            <span className="flex-1">
              {rest.length} more {rest.length === 1 ? "thing needs" : "things need"} a look
            </span>
          </summary>
          <div className="space-y-2 pt-1">
            {rest.map((n) => (
              <Notice key={n.key} level={n.level} title={n.title}>
                {n.body}
              </Notice>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}
