"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getJson } from "@/queries/fetch-json";
import { ClampedText } from "@/components/ui/ClampedText";
import type { ClaudeReviews } from "@/server/engine-client";

type Verdict = { verdict: "stronger" | "in_line" | "weaker"; confidence: "low" | "medium" | "high"; note: string; checkedAt: string };

const LABEL = { weaker: "⚠️ Claude: weaker", stronger: "✅ Claude: stronger", in_line: "Claude: in line" } as const;
const time = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", hour: "2-digit", minute: "2-digit" });
const ukDay = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" });
const when = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

/**
 * Claude's verdict on one alert, tappable: opens its full reasoning, how sure it is, and an "Ask Claude" box for
 * that pick. Advice only: nothing here places, skips or changes a bet.
 */
export function ClaudeVerdict({ pickId, v }: { pickId: number; v: Verdict }) {
  const [open, setOpen] = useState(false);
  const [question, setQuestion] = useState("");
  const [asked, setAsked] = useState<Array<{ q: string; a: string }>>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function ask() {
    const q = question.trim();
    if (!q || busy) return;
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch("/api/admin/picks/ask", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: pickId, question: q }) });
      const body = (await res.json().catch(() => ({}))) as { answer?: string; error?: string };
      if (!res.ok || !body.answer) throw new Error(body.error ?? "Couldn't ask Claude.");
      setAsked((list) => [...list, { q, a: body.answer! }]);
      setQuestion("");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't ask Claude.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={`rounded-md text-xs ${open ? "border border-line bg-surface-2/40 p-2" : ""}`}>
      <button type="button" aria-expanded={open} onClick={() => setOpen((x) => !x)} className={`block w-full text-left ${v.verdict === "weaker" ? "text-warn" : "text-ink-muted"}`}>
        <span className="font-medium underline decoration-dotted underline-offset-2">{LABEL[v.verdict]}</span>{" "}
        {/* Clamped: the note is never cut short to fit (the engine gives it plenty of room) - this is just the collapsed preview, full text a tap away. */}
        {!open && <span className="line-clamp-2 align-bottom">{v.note}</span>}
      </button>
      {open && (
        <div className="mt-1.5 space-y-2">
          <p className="text-ink">{v.note}</p>
          <p className="text-ink-muted">
            How sure: {v.confidence} · checked {time.format(new Date(v.checkedAt))}. Advice only: it doesn&apos;t change the bet. Whether these verdicts are worth listening to is
            tracked on More → Claude.
          </p>
          {asked.map((x, i) => (
            <div key={i} className="space-y-0.5">
              <p className="font-medium text-ink">You: {x.q}</p>
              <p className="whitespace-pre-line text-ink">Claude: {x.a}</p>
            </div>
          ))}
          <div className="flex gap-1.5">
            <input
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void ask();
              }}
              placeholder="Ask Claude about this pick…"
              maxLength={500}
              className="min-w-0 flex-1 rounded-md border border-line bg-surface px-2 py-1.5 text-xs text-ink"
            />
            <button type="button" disabled={busy || !question.trim()} onClick={() => void ask()} className="shrink-0 rounded-md bg-accent px-3 py-1.5 text-xs font-semibold text-accent-ink disabled:opacity-50">
              {busy ? "Asking…" : "Ask"}
            </button>
          </div>
          {err && <p className="text-warn">{err}</p>}
        </div>
      )}
    </div>
  );
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

/** Claude's latest daily and weekly notes, for the Today page. Advice to read; it never changes a setting. */
export function ClaudeReviewCard() {
  const q = useQuery({
    queryKey: ["claude-review"],
    queryFn: ({ signal }) => getJson<ClaudeReviews>("/api/admin/claude-review", "Claude's review", signal),
    refetchInterval: 10 * 60_000,
    staleTime: 5 * 60_000,
  });
  if (q.isLoading || q.error || !q.data) return null;
  const { configured, notes, failures = {} } = q.data;
  const list = (["daily", "weekly"] as const).map((k) => notes[k]).filter((n): n is NonNullable<typeof n> => !!n);
  const failed = (["daily", "weekly"] as const).map((k) => failures[k]).filter((f): f is NonNullable<typeof f> => !!f);
  const today = ukDay.format(new Date());
  // "Today" only when it is today's: until 28 Oct 2026 Monday's note sat under "Today" on Wednesday after two failed.
  const labelOf = (n: (typeof list)[number]) => (n.kind === "weekly" ? "This week" : ukDay.format(new Date(n.generatedAt)) === today ? "Today" : "Latest daily note");
  return (
    <section className={`rounded-xl border p-3.5 ${failed.length > 0 ? "border-warn/60 bg-surface" : "border-line bg-surface"}`}>
      <h3 className="text-sm font-semibold text-ink">Claude&apos;s review</h3>
      {failed.map((f) => (
        <p key={f.kind} className="mt-1 text-xs text-warn">
          {f.kind === "daily" ? "The daily" : "The weekly"} note due {when.format(new Date(f.at))} wasn&apos;t written: {f.reason} It tries again at the next one.
        </p>
      ))}
      {!configured ? (
        <p className="mt-1 text-xs text-ink-muted">Claude isn&apos;t set up on the engine yet (no ANTHROPIC_API_KEY).</p>
      ) : list.length === 0 ? (
        <p className="mt-1 text-xs text-ink-muted">The first daily note is written after tonight&apos;s last results summary (21:30), and the weekly one with the weekly review.</p>
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
