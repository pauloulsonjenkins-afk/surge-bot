"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getJson } from "@/queries/fetch-json";
import { useStrategyNames } from "@/queries/use-strategy-names";
import { ADVICE_LABEL, ApplyAdvice, adviceTitle, isGoodAdvice } from "@/components/admin/Advice";
import { ClampedText } from "@/components/ui/ClampedText";
import type { ClaudeReviews } from "@/server/engine-client";

const ukDay = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" });
const when = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

/** A stored failure reason as one short sentence (older ones carry the raw error text, JSON and all). */
export function plainReason(reason: string): string {
  if (/credit balance is too low/i.test(reason)) return "Anthropic credit has run out. Add credit under Plans & Billing at console.anthropic.com.";
  if (/invalid x-api-key|authentication_error/i.test(reason)) return "Anthropic didn't accept the API key.";
  const flat = reason.replace(/\s+/g, " ");
  return flat.length > 140 ? `${flat.slice(0, 140)}…` : flat;
}

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

/**
 * What Claude is at least 85% sure of, one card each: its confidence, why, and the site's own suggestion to Accept (the
 * ordinary Apply, which asks first) or Reject. Nothing changes until Accept is pressed and confirmed.
 */
function Recommendations({ list }: { list: NonNullable<NonNullable<ClaudeReviews["notes"]["daily"]>["recommendations"]> }) {
  const qc = useQueryClient();
  const names = useStrategyNames();
  const reject = useMutation({
    mutationFn: async (a: (typeof list)[number]) => {
      const res = await fetch("/api/admin/claude-review", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key: a.key, kind: a.kind, ...(a.league ? { league: a.league.key } : {}) }) });
      if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as { error?: string }).error ?? "Couldn't reject that.");
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["claude-review"] }),
  });
  if (list.length === 0) return null;
  return (
    <div className="mt-2 space-y-2">
      <p className="text-xs font-medium text-ink">Claude recommends</p>
      {list.map((a) => {
        const name = adviceTitle(a, names.name);
        return (
          <div key={`${a.key}:${a.kind}:${a.league?.key ?? ""}`} className="rounded-lg border-2 border-accent bg-accent/5 p-3">
            <div className="flex items-start justify-between gap-2">
              <p className="min-w-0 text-sm font-medium text-ink">
                {name} <span className={isGoodAdvice(a) ? "text-hit" : "text-warn"}>{ADVICE_LABEL[a.kind]}</span>
              </p>
              <span className="shrink-0 rounded-full bg-accent px-2 py-0.5 text-xs font-bold text-accent-ink">{a.confidence}% sure</span>
            </div>
            {a.why && <p className="mt-1 text-sm text-ink">{a.why}</p>}
            <ClampedText text={a.reason} lines={2} className="mt-1 block text-xs text-ink-muted" />
            <div className="mt-2 flex items-center justify-end gap-2">
              <button type="button" disabled={reject.isPending} onClick={() => reject.mutate(a)} className="rounded-md border border-line px-3 py-1.5 text-xs font-medium text-ink">
                Reject
              </button>
              <ApplyAdvice a={a} name={name} />
            </div>
          </div>
        );
      })}
      {reject.error && <p className="text-xs text-destructive">{reject.error.message}</p>}
    </div>
  );
}

/** Claude's daily note, for the Today page: the one Claude analysis a day, with any recommendation it is highly confident in. */
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
    <section className="rounded-xl border border-line bg-surface p-3.5">
      <h3 className="text-sm font-semibold text-ink">Claude&apos;s review</h3>
      {failed.map((f) => (
        <p key={f.kind} className="mt-1 text-xs text-warn">
          Note not written ({when.format(new Date(f.at))}): {plainReason(f.reason)}
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
          <Recommendations list={notes.daily?.recommendations ?? []} />
          <p className="text-xs text-ink-muted">Nothing changes unless you press Accept and confirm.</p>
        </div>
      )}
    </section>
  );
}
