"use client";

import { useState } from "react";
import Link from "next/link";
import { ChevronDown } from "lucide-react";
import { GoldenBadge, sliceName } from "@/components/ui/SegmentLabel";
import { Skeleton } from "@/components/ui/Skeleton";
import { SegmentBetting, useSliceLive } from "@/components/admin/SegmentBetting";
import { useGolden, type GoldenSlice } from "@/queries/use-golden";
import { useSending, type SendingSettings } from "@/queries/use-sending";
import { useStrategyNames } from "@/queries/use-strategy-names";
import { signedPct, toneOf, units as formatUnits } from "@/lib/format";

/** Below this many priced picks a return is noise: shown, but not in green or red (the same rule as the Golden page). */
const FEW = 10;
/** A slice put Live from here with no stake of its own starts at the Golden trial stake, not at its strategy's (which can be large). */
const TRIAL_PCT = 1;

const judged = (roi: number | null | undefined, n: number) => (n < FEW ? "text-ink-muted" : toneOf(roi));
const unitsText = (r: { units?: number; roi: number | null }) => (r.units !== undefined ? formatUnits(r.units) : signedPct(r.roi));
const shortName = (label: string) => sliceName(label).replace(/ since .*$/, "");

/**
 * One Golden slice: what it is, how it's doing against the rest of its strategy, and its own Sim / Live switch. Putting
 * a slice Live bets only that part of the strategy with real money; the rest of the strategy stays as it is.
 */
function SliceRow({ s, settings, strategyName }: { s: GoldenSlice; settings: SendingSettings; strategyName: string }) {
  const key = `${s.strategyKey}#${s.id}`;
  const cfg = settings.segmentBets?.[key] ?? null;
  const ownLive = cfg?.live === true;
  // Following a Live strategy: already bet with real money as part of it, so nothing to switch here.
  const withLiveStrategy = cfg === null && s.strategyLive;
  const { save, toggleLive } = useSliceLive(s.strategyKey, strategyName, { id: s.id, label: s.label });
  const [open, setOpen] = useState(false);
  const mine = s.slice.all;
  const rest = s.rest.all;
  const stakeNow = cfg?.stakePct ?? (cfg?.stake != null ? null : TRIAL_PCT);

  return (
    <li className="py-3 text-sm">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-xs text-ink-muted">{strategyName}</p>
          <p className="font-medium text-ink">{shortName(s.label)}</p>
          <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs tabular-nums text-ink-muted">
            <GoldenBadge status={s.status} candidate="Candidate" trial="Live trial suggested" />
            <span>
              <span className={`font-semibold ${judged(mine.roi, mine.counted)}`}>{mine.counted > 0 ? unitsText(mine) : "–"}</span> on {mine.counted}
              {rest.counted > 0 && (
                <>
                  {" "}
                  · rest <span className={judged(rest.roi, rest.counted)}>{unitsText(rest)}</span>
                </>
              )}
            </span>
          </p>
          {ownLive && (
            <p className="mt-1 text-xs text-ink-muted">
              Its own Live bets:{" "}
              {s.ownLive && s.ownLive.n > 0 ? (
                <span className="tabular-nums">
                  {s.ownLive.won}–{s.ownLive.n - s.ownLive.won}{" "}
                  <span className={judged(s.ownLive.roi, s.ownLive.n)}>{s.ownLive.units !== undefined ? formatUnits(s.ownLive.units) : signedPct(s.ownLive.roi)}</span> on{" "}
                  {s.ownLive.n}
                </span>
              ) : (
                "none settled yet"
              )}
              {cfg?.stakePct != null ? ` · ${cfg.stakePct}% stake` : ""}
            </p>
          )}
          {s.why && <p className="mt-1 text-xs text-destructive">Not holding up: {s.why}.</p>}
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          {withLiveStrategy ? (
            <span className="rounded-md bg-accent/15 px-2.5 py-2 text-xs font-medium text-accent">Live with {strategyName}</span>
          ) : (
            <div className="inline-flex rounded-md border border-line p-0.5" role="group" aria-label={`${shortName(s.label)}: Sim or Live`}>
              {([false, true] as const).map((v) => (
                <button
                  key={String(v)}
                  type="button"
                  aria-pressed={ownLive === v}
                  disabled={save.isPending}
                  onClick={() => ownLive !== v && void toggleLive(v, v ? stakeNow : (cfg?.stakePct ?? null))}
                  className={`min-h-10 rounded px-3 text-xs font-medium disabled:opacity-40 ${ownLive === v ? (v ? "bg-accent text-accent-ink" : "bg-surface-2 text-ink") : "text-ink-muted hover:bg-surface-2"}`}
                >
                  {v ? "Live" : "Sim"}
                </button>
              ))}
            </div>
          )}
          <button type="button" aria-expanded={open} onClick={() => setOpen((x) => !x)} className="flex min-h-8 items-center gap-0.5 text-xs text-ink-muted [@media(pointer:coarse)]:min-h-11">
            Stake &amp; details <ChevronDown size={12} aria-hidden className={`transition-transform ${open ? "rotate-180" : ""}`} />
          </button>
        </div>
      </div>
      {save.error && <p className="mt-1 text-xs text-destructive">{save.error.message}</p>}
      {open && (
        <div className="mt-2">
          <SegmentBetting strategyKey={s.strategyKey} strategyName={strategyName} segment={{ id: s.id, label: s.label }} settings={settings} strategyLive={s.strategyLive} />
        </div>
      )}
    </li>
  );
}

/**
 * Which list each watched slice goes in: "live on their own" (its own Live switch is on, whatever its strategy is),
 * "doing well" (full stake earned or a Live trial suggested, not yet Live; best first), and the rest. A slice that
 * follows a strategy that is already Live is left out: it is bet with real money as part of that strategy.
 */
export function groupSlices(slices: GoldenSlice[], segmentBets: SendingSettings["segmentBets"]): { liveOwn: GoldenSlice[]; proving: GoldenSlice[]; others: GoldenSlice[] } {
  const cfgOf = (s: GoldenSlice) => segmentBets?.[`${s.strategyKey}#${s.id}`] ?? null;
  const own = (s: GoldenSlice) => cfgOf(s)?.live === true;
  const withStrategy = (s: GoldenSlice) => cfgOf(s) === null && s.strategyLive;
  const best = (s: GoldenSlice) => s.slice.all.units ?? s.slice.all.roi ?? -Infinity;
  return {
    liveOwn: slices.filter(own),
    proving: slices.filter((s) => !own(s) && !withStrategy(s) && (s.status === "full" || s.status === "trial")).sort((a, b) => best(b) - best(a)),
    others: slices.filter((s) => !own(s) && !withStrategy(s) && s.status !== "full" && s.status !== "trial"),
  };
}

function Group({ title, note, slices, settings, nameOf }: { title: string; note: string; slices: GoldenSlice[]; settings: SendingSettings; nameOf: (key: string) => string }) {
  if (slices.length === 0) return null;
  return (
    <div>
      <h4 className="text-sm font-semibold text-ink">
        {title} <span className="font-normal text-ink-muted">· {slices.length}</span>
      </h4>
      <p className="text-xs text-ink-muted">{note}</p>
      <ul className="mt-1 divide-y divide-line">
        {slices.map((s) => (
          <SliceRow key={`${s.strategyKey}#${s.id}`} s={s} settings={settings} strategyName={nameOf(s.strategyKey)} />
        ))}
      </ul>
    </div>
  );
}

/**
 * Golden slices on the Strategies page (1 Nov 2026): the parts of a strategy that are doing well, each with its own Sim /
 * Live switch, so one can be bet with real money without putting the whole strategy Live. Slices bet Live on their own
 * come first, then the ones proving themselves, then everything else being watched, folded away.
 */
export function GoldenSlicesSection() {
  const golden = useGolden();
  const sending = useSending(60_000);
  const names = useStrategyNames();
  const settings = sending.data?.settings;
  if (golden.isLoading || sending.isLoading || !golden.data || !settings) return <Skeleton className="h-32 w-full" />;
  const all = golden.data.slices.filter((s) => !s.quiet);
  const { liveOwn, proving, others } = groupSlices(all, settings.segmentBets);
  const nameOf = (key: string) => names.name(key);
  return (
    <section aria-label="Golden slices" className="space-y-4 rounded-xl border border-line bg-surface p-3.5">
      <div>
        <h3 className="text-base font-semibold text-ink">Golden slices</h3>
        <p className="text-xs text-ink-muted">
          Put a part of a strategy Live on its own, without the rest of it. Each is bet at its own stake (1% to start), and goes back to Sim by itself if it stops
          holding up.
        </p>
      </div>
      {all.length === 0 && <p className="text-sm text-ink-muted">No slices are being watched yet. The finder on the Golden page suggests them.</p>}
      <Group title="Live on their own" note="Real money, whatever the rest of the strategy is doing." slices={liveOwn} settings={settings} nameOf={nameOf} />
      <Group title="Doing well, not Live" note="Proving themselves: gold is a full stake earned, outline a Live trial suggested." slices={proving} settings={settings} nameOf={nameOf} />
      {others.length > 0 && (
        <details className="rounded-lg border border-line px-3">
          <summary className="flex min-h-11 cursor-pointer items-center text-sm font-medium text-ink">
            Others being watched <span className="ml-1 font-normal text-ink-muted">· {others.length}</span>
          </summary>
          <ul className="divide-y divide-line pb-1">
            {others.map((s) => (
              <SliceRow key={`${s.strategyKey}#${s.id}`} s={s} settings={settings} strategyName={nameOf(s.strategyKey)} />
            ))}
          </ul>
        </details>
      )}
      <p className="text-xs text-ink-muted">
        How slices are proved, and the finder that suggests new ones, are on the{" "}
        <Link href="/more/admin/golden" className="text-accent underline">
          Golden page
        </Link>
        .
      </p>
    </section>
  );
}
