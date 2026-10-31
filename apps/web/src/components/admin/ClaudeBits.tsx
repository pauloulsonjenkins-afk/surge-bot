"use client";

import { useQuery } from "@tanstack/react-query";
import { getJson } from "@/queries/fetch-json";
import { ClampedText } from "@/components/ui/ClampedText";
import type { ClaudeReviews } from "@/server/engine-client";

const ukDay = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" });
const when = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

/** One review note: four lines to start, the rest a tap away (only when there is a rest), so a long note never pushes the page down. */
function ReviewNote({ label, at, note }: { label: string; at: string; note: string }) {
  return (
    <div>
      <p className="text-xs font-medium text-ink-muted">
        {label} · {when.format(new Date(at))}
      </p>
      <ClampedText text={note} lines={4} className="mt-0.5 whitespace-pre-line text-sm text-ink" />
    </div>
  );
}

/** Claude's daily note, for the Today page: the one Claude analysis a day. Advice to read; it never changes a setting. */
export function ClaudeReviewCard() {
  const q = useQuery({
    queryKey: ["claude-review"],
    queryFn: ({ signal }) => getJson<ClaudeReviews>("/api/admin/claude-review", "Claude's review", signal),
    refetchInterval: 10 * 60_000,
    staleTime: 5 * 60_000,
  });
  if (q.isLoading || q.error || !q.data) return null;
  const { configured, notes, failures = {} } = q.data;
  const list = notes.daily ? [notes.daily] : [];
  const failed = failures.daily ? [failures.daily] : [];
  const today = ukDay.format(new Date());
  // "Today" only when it is today's: until 28 Oct 2026 Monday's note sat under "Today" on Wednesday after two failed.
  const labelOf = (n: (typeof list)[number]) => (ukDay.format(new Date(n.generatedAt)) === today ? "Today" : "Latest daily note");
  return (
    <section className={`rounded-xl border p-3.5 ${failed.length > 0 ? "border-warn/60 bg-surface" : "border-line bg-surface"}`}>
      <h3 className="text-sm font-semibold text-ink">Claude&apos;s review</h3>
      {failed.map((f) => (
        <p key={f.kind} className="mt-1 text-xs text-warn">
          The daily note due {when.format(new Date(f.at))} wasn&apos;t written: {f.reason} It tries again at the next one.
        </p>
      ))}
      {!configured ? (
        <p className="mt-1 text-xs text-ink-muted">Claude isn&apos;t set up on the engine yet (no ANTHROPIC_API_KEY).</p>
      ) : list.length === 0 ? (
        <p className="mt-1 text-xs text-ink-muted">The daily note is written after tonight&apos;s last results summary (21:30).</p>
      ) : (
        <div className="mt-2 space-y-3">
          {list.map((n) => (
            <ReviewNote key={n.kind} label={labelOf(n)} at={n.generatedAt} note={n.note} />
          ))}
          <p className="text-xs text-ink-muted">Advice to read, not a setting: nothing changes unless you change it.</p>
        </div>
      )}
    </section>
  );
}
