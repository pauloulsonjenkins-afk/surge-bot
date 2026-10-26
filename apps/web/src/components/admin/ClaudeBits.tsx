"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getJson } from "@/queries/fetch-json";
import type { ClaudeReviews } from "@/server/engine-client";

type Verdict = { verdict: "stronger" | "in_line" | "weaker"; confidence: "low" | "medium" | "high"; note: string; checkedAt: string };

const LABEL = { weaker: "⚠️ Claude: weaker", stronger: "✅ Claude: stronger", in_line: "Claude: in line" } as const;
const time = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", hour: "2-digit", minute: "2-digit" });
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
      <button type="button" aria-expanded={open} onClick={() => setOpen((x) => !x)} className={`text-left ${v.verdict === "weaker" ? "text-warn" : "text-ink-muted"}`}>
        <span className="font-medium underline decoration-dotted underline-offset-2">{LABEL[v.verdict]}</span>{" "}
        {!open && <span>{v.note}</span>}
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

/** Claude's latest daily and weekly notes, for the Today page. Advice to read; it never changes a setting. */
export function ClaudeReviewCard() {
  const q = useQuery({
    queryKey: ["claude-review"],
    queryFn: ({ signal }) => getJson<ClaudeReviews>("/api/admin/claude-review", "Claude's review", signal),
    refetchInterval: 10 * 60_000,
    staleTime: 5 * 60_000,
  });
  if (q.isLoading || q.error || !q.data) return null;
  const { configured, notes } = q.data;
  const list = (["daily", "weekly"] as const).map((k) => notes[k]).filter((n): n is NonNullable<typeof n> => !!n);
  return (
    <section className="rounded-xl border border-line bg-surface p-3.5">
      <h3 className="text-sm font-semibold text-ink">Claude&apos;s review</h3>
      {!configured ? (
        <p className="mt-1 text-xs text-ink-muted">Claude isn&apos;t set up on the engine yet (no ANTHROPIC_API_KEY).</p>
      ) : list.length === 0 ? (
        <p className="mt-1 text-xs text-ink-muted">The first daily note is written after tonight&apos;s last results summary (21:30), and the weekly one with the weekly review.</p>
      ) : (
        <div className="mt-2 space-y-3">
          {list.map((n) => (
            <div key={n.kind}>
              <p className="text-xs font-medium text-ink-muted">
                {n.kind === "daily" ? "Today" : "This week"} · {when.format(new Date(n.generatedAt))}
              </p>
              <p className="mt-0.5 whitespace-pre-line text-sm text-ink">{n.note}</p>
            </div>
          ))}
          <p className="text-xs text-ink-muted">Advice to read, not a setting: nothing changes unless you change it.</p>
        </div>
      )}
    </section>
  );
}
