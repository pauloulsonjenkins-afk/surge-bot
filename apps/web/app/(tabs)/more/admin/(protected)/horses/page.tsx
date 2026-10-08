"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Card, PageHeader, Segmented, moneyTone } from "@/components/ui/Card";
import { Skeleton } from "@/components/ui/Skeleton";
import { QueryError } from "@/components/ui/QueryError";
import { gbp } from "@/lib/format";
import {
  useHorseBets,
  useSaveHorseDay,
  useSetHorseResult,
  type HorseBet,
  type HorseDay,
  type HorseSuggestion,
  type HorseEntryInput,
} from "@/queries/use-horses";
import {
  RANK_LABEL,
  RANKS,
  moneyOf,
  placeOdds,
  summarise,
  todayUk,
  yankees,
  YANKEE_BET_COUNT,
  type YankeeMoney,
} from "@/lib/horses";

const dayFmt = new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", weekday: "short", day: "numeric", month: "short", year: "numeric" });
const dayLabel = (d: string) => dayFmt.format(new Date(`${d}T12:00:00Z`));
const TONE = { hit: "text-hit", loss: "text-loss", muted: "text-ink-muted" };
const inputCls = "w-full rounded-md border border-line bg-surface-2 px-2.5 py-1.5 text-sm text-ink";

/** Decimal odds from what's typed, for the preview under the box (the engine does the real check). */
function previewOdds(v: string): number | null {
  const s = v.trim().toLowerCase();
  if (/^(evens|evs|even|ev)$/.test(s)) return 2;
  const f = /^(\d+(?:\.\d+)?)\s*[/-]\s*(\d+(?:\.\d+)?)$/.exec(s);
  const n = f ? 1 + Number(f[1]) / Number(f[2]) : Number(s);
  return s && Number.isFinite(n) && n >= 1.01 ? n : null;
}

type Row = { horse: string; course: string; stake: string; odds: string; betType: "win" | "ew"; ewFraction: number; ewPlaces: string };
const EMPTY: Row = { horse: "", course: "", stake: "", odds: "", betType: "win", ewFraction: 4, ewPlaces: "" };

/**
 * The day's saved choices, or for a day with nothing saved yet, the last earlier day's amounts carried over (stake,
 * win or each-way, terms), with the horse and odds left blank. carriedFrom says which day they came from.
 */
function rowsFor(bets: HorseBet[], day: string): Record<number, Row> & { carriedFrom?: string } {
  const out: Record<number, Row> & { carriedFrom?: string } = { 1: { ...EMPTY }, 2: { ...EMPTY }, 3: { ...EMPTY }, 4: { ...EMPTY } };
  if (!bets.some((b) => b.day === day)) {
    const before = bets.filter((b) => b.day < day).map((b) => b.day).sort().pop();
    if (before) {
      for (const b of bets) {
        if (b.day !== before) continue;
        out[b.rank] = { ...EMPTY, stake: String(b.stake), betType: b.betType, ewFraction: b.ewFraction ?? 4, ewPlaces: b.ewPlaces === null ? "" : String(b.ewPlaces) };
      }
      out.carriedFrom = before;
    }
    return out;
  }
  for (const b of bets) {
    if (b.day !== day) continue;
    out[b.rank] = {
      horse: b.horse ?? "",
      course: b.course ?? "",
      stake: String(b.stake),
      odds: b.oddsText,
      betType: b.betType,
      ewFraction: b.ewFraction ?? 4,
      ewPlaces: b.ewPlaces === null ? "" : String(b.ewPlaces),
    };
  }
  return out;
}

/** A day's EW Yankee unit stake, or "" for none. A day with nothing saved yet carries the last earlier day's over. */
function yankeeStakeFor(days: HorseDay[], bets: HorseBet[], d: string): string {
  const own = days.find((x) => x.day === d);
  const from = own ?? (bets.some((b) => b.day === d) ? undefined : [...days].filter((x) => x.day < d).sort((a, b) => a.day.localeCompare(b.day)).pop());
  const s = from?.yankeeStake;
  return s === null || s === undefined ? "" : String(s);
}

// ---------------------------------------------------------------------------
// Entry

function EntryCard({
  bets,
  days,
  day,
  setDay,
  courses,
  knownCourses,
  suggestions,
}: {
  bets: HorseBet[];
  days: HorseDay[];
  day: string;
  setDay: (d: string) => void;
  /** Racecourses used before, most used first. */
  courses: string[];
  /** UK and Irish courses, suggested after your own. */
  knownCourses: string[];
  /** Picks the daily importer fetched for this day, to copy into the form. */
  suggestions: HorseSuggestion[];
}) {
  const save = useSaveHorseDay();
  const [rows, setRows] = useState<Record<number, Row> & { carriedFrom?: string }>(() => rowsFor(bets, day));
  const yankeeFor = (d: string) => yankeeStakeFor(days, bets, d);
  const [yankee, setYankee] = useState(() => yankeeFor(day));
  const [yankeeOn, setYankeeOn] = useState(() => yankeeFor(day) !== "");
  const [saved, setSaved] = useState(false);
  // Load that day's saved choices whenever the date changes (or after a save, from the refreshed list).
  const loadedFor = useRef<string | null>(null);
  useEffect(() => {
    if (loadedFor.current === day) return;
    loadedFor.current = day;
    setRows(rowsFor(bets, day));
    const y = yankeeStakeFor(days, bets, day);
    setYankee(y);
    setYankeeOn(y !== "");
  }, [bets, days, day]);

  // Copies the fetched horses, courses and the tipster's odds into the form. The amounts and everything else stay as they
  // are, and nothing is saved until Save is pressed, so each row can still be changed first.
  function fillFromSuggestions() {
    setSaved(false);
    setRows((r) => {
      const next = { ...r };
      for (const s of suggestions) {
        const cur = next[s.rank];
        if (cur) {
          next[s.rank] = {
            ...cur,
            horse: s.horse,
            course: s.course ?? "",
            odds: s.oddsText ?? cur.odds,
            betType: s.betType,
            ewPlaces: s.betType === "ew" && s.ewPlaces ? String(s.ewPlaces) : cur.ewPlaces,
          };
        }
      }
      delete next.carriedFrom;
      return next;
    });
  }

  const set = (rank: number, patch: Partial<Row>) => {
    setSaved(false);
    setRows((r) => ({ ...r, [rank]: { ...r[rank]!, ...patch } }));
  };
  // Carried-over amounts with no odds aren't a bet: a row is only sent when its odds are filled in.
  const filled = (r: Row) => r.odds.trim() !== "" || !rows.carriedFrom;
  const unit = Number(yankee.replace(/^£/, ""));
  const yankeeCost = yankeeOn && Number.isFinite(unit) && unit > 0 ? unit * YANKEE_BET_COUNT : 0;
  const outlay =
    RANKS.reduce((n, r) => {
      const s = Number(rows[r]!.stake.replace(/^£/, ""));
      return n + (filled(rows[r]!) && Number.isFinite(s) && s > 0 ? s * (rows[r]!.betType === "ew" ? 2 : 1) : 0);
    }, 0) + yankeeCost;

  function submit() {
    const entries: HorseEntryInput[] = RANKS.map((rank) => {
      const r = rows[rank]!;
      // Place terms go with an each-way single, and with every selection when there's a Yankee (its place part uses them).
      const terms = r.betType === "ew" || yankeeOn;
      // A carried-over amount on a row left without odds means "no bet on this one today".
      const stake = filled(r) ? r.stake : "";
      return { rank, horse: r.horse, course: r.course, stake, odds: r.odds, betType: r.betType, ewFraction: terms ? r.ewFraction : null, ewPlaces: r.ewPlaces };
    });
    save.mutate({ day, entries, yankeeStake: yankeeOn ? yankee : null }, { onSuccess: () => setSaved(true) });
  }

  return (
    <Card
      title={day === todayUk() ? "Today’s bets" : `Bets for ${dayLabel(day)}`}
      subtitle="Enter your four choices. Odds can be a fraction (5/2), evens, or a decimal (3.5). Each-way stakes are per part, so £5 EW costs £10. Leave a row empty to skip it."
    >
      <div className="space-y-3">
        <label className="flex items-center gap-2 text-xs text-ink-muted">
          Date
          <input
            type="date"
            value={day}
            max={todayUk()}
            onChange={(e) => {
              if (e.target.value) {
                setDay(e.target.value);
                setSaved(false);
              }
            }}
            className="rounded-md border border-line bg-surface-2 px-2.5 py-1.5 text-sm text-ink"
          />
        </label>

        {suggestions.length > 0 && (
          <div className="rounded-md border border-accent/40 bg-accent/10 p-3">
            <p className="text-sm font-medium text-ink">Today&rsquo;s picks have been fetched</p>
            <ul className="mt-1 space-y-0.5 text-xs text-ink-muted">
              {suggestions.map((s) => (
                <li key={s.rank}>
                  {s.rank}. <span className="text-ink">{s.horse}</span>
                  {s.course ? ` · ${s.course}` : ""}
                  {s.raceTime ? ` ${s.raceTime}` : ""}
                  {s.oddsText ? ` · ${s.oddsText}` : ""}
                  {s.betType === "ew" ? ` · each-way${s.ewPlaces ? `, ${s.ewPlaces} places` : ""}` : ""}
                </li>
              ))}
            </ul>
            <button
              type="button"
              onClick={fillFromSuggestions}
              className="mt-2 rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-accent-ink hover:opacity-90"
            >
              Fill the form with these
            </button>
            <p className="mt-1 text-xs text-ink-muted">Nothing is saved or bet until you press Save. Check the odds you can actually get, and set your amounts.</p>
          </div>
        )}

        {rows.carriedFrom && (
          <p className="rounded-md bg-surface-2 px-2.5 py-1.5 text-xs text-ink-muted">
            Bet amounts carried over from {dayLabel(rows.carriedFrom)}. Add today&rsquo;s horses and odds, and change any amount before saving.
          </p>
        )}

        {/* Your own courses first (most used), then every UK and Irish course, as typing suggestions. */}
        <datalist id="horse-courses">
          {[...courses, ...knownCourses.filter((c) => !courses.some((u) => u.toLowerCase() === c.toLowerCase()))].map((c) => (
            <option key={c} value={c} />
          ))}
        </datalist>
        {courses.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Recent racecourses">
            <span className="text-xs text-ink-muted">Tap to fill the next empty racecourse:</span>
            {courses.slice(0, 8).map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => {
                  const next = RANKS.find((rank) => !rows[rank]!.course.trim());
                  if (next) set(next, { course: c });
                }}
                className="rounded-full border border-line px-2.5 py-1 text-xs font-medium text-ink hover:bg-surface-2"
              >
                {c}
              </button>
            ))}
          </div>
        )}

        {RANKS.map((rank) => {
          const r = rows[rank]!;
          const dec = previewOdds(r.odds);
          return (
            <fieldset key={rank} className="rounded-lg border border-line p-2.5">
              <legend className="px-1 text-xs font-semibold text-ink">{RANK_LABEL[rank]}</legend>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-[1.4fr_1.2fr_1fr_1fr_auto]">
                <label className="text-xs text-ink-muted">
                  Horse (optional)
                  <input className={`${inputCls} mt-1`} value={r.horse} onChange={(e) => set(rank, { horse: e.target.value })} />
                </label>
                <label className="text-xs text-ink-muted">
                  Racecourse
                  <input
                    list="horse-courses"
                    autoComplete="off"
                    placeholder="e.g. Ascot"
                    className={`${inputCls} mt-1`}
                    value={r.course}
                    onChange={(e) => set(rank, { course: e.target.value })}
                  />
                </label>
                <label className="text-xs text-ink-muted">
                  Bet amount (£)
                  <input inputMode="decimal" className={`${inputCls} mt-1 tabular-nums`} value={r.stake} onChange={(e) => set(rank, { stake: e.target.value })} />
                </label>
                <label className="text-xs text-ink-muted">
                  Odds
                  <input className={`${inputCls} mt-1 tabular-nums`} placeholder="5/2" value={r.odds} onChange={(e) => set(rank, { odds: e.target.value })} />
                  <span className="mt-0.5 block h-4 text-[12px] tabular-nums">{r.odds && (dec ? `= ${dec.toFixed(2)}` : <span className="text-warn">Not a price</span>)}</span>
                </label>
                <div className="col-span-2 text-xs text-ink-muted sm:col-span-1">
                  Bet
                  <Segmented
                    label={`${RANK_LABEL[rank]}: win or each-way`}
                    value={r.betType}
                    onChange={(v) => set(rank, { betType: v })}
                    className="mt-1 flex w-max"
                    options={[
                      { value: "win", label: "Win" },
                      { value: "ew", label: "EW" },
                    ]}
                  />
                </div>
              </div>
              {(r.betType === "ew" || yankeeOn) && (
                <div className="mt-2 flex flex-wrap items-end gap-3 text-xs text-ink-muted">
                  {r.betType === "win" && <span className="w-full">Place terms for the EW Yankee (this single is win only):</span>}
                  <label>
                    Place terms
                    <select
                      value={r.ewFraction}
                      onChange={(e) => set(rank, { ewFraction: Number(e.target.value) })}
                      className="mt-1 block rounded-md border border-line bg-surface-2 px-2 py-1.5 text-sm text-ink"
                    >
                      <option value={4}>1/4 odds</option>
                      <option value={5}>1/5 odds</option>
                      <option value={3}>1/3 odds</option>
                    </select>
                  </label>
                  <label>
                    Places paid
                    <input inputMode="numeric" placeholder="e.g. 3" className={`${inputCls} mt-1 w-20`} value={r.ewPlaces} onChange={(e) => set(rank, { ewPlaces: e.target.value })} />
                  </label>
                  {dec && <span className="pb-2 tabular-nums">Place pays {placeOdds(dec, r.ewFraction).toFixed(2)}</span>}
                </div>
              )}
            </fieldset>
          );
        })}

        <fieldset className="rounded-lg border border-line p-2.5">
          <legend className="px-1 text-xs font-semibold text-ink">EW Yankee</legend>
          <label className="flex items-center gap-2 text-xs text-ink">
            <input type="checkbox" checked={yankeeOn} onChange={(e) => (setYankeeOn(e.target.checked), setSaved(false))} style={{ accentColor: "var(--accent)" }} className="h-4 w-4" />
            Also an each-way Yankee on these four
          </label>
          {yankeeOn && (
            <div className="mt-2 flex flex-wrap items-end gap-3 text-xs text-ink-muted">
              <label>
                Unit stake (£)
                <input inputMode="decimal" className={`${inputCls} mt-1 w-24 tabular-nums`} value={yankee} onChange={(e) => (setYankee(e.target.value), setSaved(false))} />
              </label>
              <span className="pb-2 tabular-nums">
                {YANKEE_BET_COUNT} bets{yankeeCost > 0 && ` × £${unit.toFixed(2)} = £${yankeeCost.toFixed(2)}`}: 6 doubles, 4 trebles and a fourfold, each to win and to place.
              </span>
            </div>
          )}
        </fieldset>

        <div className="flex flex-wrap items-center gap-3">
          <button type="button" onClick={submit} disabled={save.isPending} className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-ink disabled:opacity-50">
            {save.isPending ? "Saving…" : "Save day"}
          </button>
          <span className="text-xs tabular-nums text-ink-muted">Total outlay £{outlay.toFixed(2)}</span>
          {saved && !save.isPending && <span className="text-xs text-hit">Saved.</span>}
        </div>
        {save.error && <p className="text-xs text-destructive">{save.error.message}</p>}
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// The daily record

function ResultButtons({ bet, yankeeDay }: { bet: HorseBet; yankeeDay: boolean }) {
  const set = useSetHorseResult();
  const options: Array<{ value: HorseBet["result"]; label: string; cls: string }> = [
    { value: "won", label: "Won", cls: "bg-hit text-app" },
    // Placed matters for an each-way single, and for every selection when the day has a Yankee (its place part).
    ...(bet.betType === "ew" || yankeeDay ? [{ value: "placed" as const, label: "Placed", cls: "bg-hit/40 text-ink" }] : []),
    { value: "lost", label: "Lost", cls: "bg-loss text-app" },
    { value: "void", label: "Void", cls: "bg-ink-muted text-app" },
  ];
  return (
    <div role="radiogroup" aria-label={`Result for ${RANK_LABEL[bet.rank]}`} className="inline-flex gap-0.5 rounded-lg border border-line bg-surface-2 p-0.5">
      {options.map((o) => {
        const on = bet.result === o.value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={on}
            // Tapping the chosen result again puts the bet back to not marked.
            onClick={() => set.mutate({ id: bet.id, result: on ? "pending" : o.value })}
            className={`rounded-md px-2 py-1 text-xs font-medium ${on ? o.cls : "text-ink-muted hover:text-ink"}`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

function DayRecord({ day, bets, yankee, onEdit }: { day: string; bets: HorseBet[]; yankee: YankeeMoney | null; onEdit: () => void }) {
  const s = summarise(bets, yankee ? [yankee] : []);
  return (
    <li className="rounded-xl border border-line bg-surface p-3">
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-sm font-medium text-ink">{dayLabel(day)}</p>
        <p className="text-xs tabular-nums text-ink-muted">
          £{s.staked.toFixed(2)} staked ·{" "}
          {s.settled === 0 ? "not marked yet" : <span className={TONE[moneyTone(s.profit)]}>{gbp(s.profit)}</span>}
          {s.pending > 0 && s.settled > 0 && ` · ${s.pending} to mark`}
          {" · "}
          <button type="button" onClick={onEdit} className="underline">
            Edit
          </button>
        </p>
      </div>
      <ul className="mt-2 divide-y divide-line">
        {bets.map((b) => {
          const m = moneyOf(b);
          return (
            <li key={b.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <span className="min-w-0 text-xs">
                <span className="font-semibold text-ink">{RANK_LABEL[b.rank]}</span>
                {b.horse && <span className="text-ink"> · {b.horse}</span>}
                {b.course && <span className="text-ink-muted"> · {b.course}</span>}
                <span className="block tabular-nums text-ink-muted">
                  £{b.stake.toFixed(2)}
                  {b.betType === "ew" ? ` EW (1/${b.ewFraction}${b.ewPlaces ? `, ${b.ewPlaces} places` : ""})` : " win"} @ {b.oddsText}
                  {m.profit !== null && <span className={TONE[moneyTone(m.profit)]}> · {gbp(m.profit)}</span>}
                </span>
              </span>
              <ResultButtons bet={b} yankeeDay={yankee !== null} />
            </li>
          );
        })}
        {yankee && (
          <li className="flex flex-wrap items-baseline justify-between gap-2 py-2 text-xs">
            <span>
              <span className="font-semibold text-ink">EW Yankee</span>
              <span className="tabular-nums text-ink-muted">
                {" "}
                · £{yankee.unit.toFixed(2)} × {YANKEE_BET_COUNT} = £{yankee.cost.toFixed(2)}
              </span>
            </span>
            <span className="tabular-nums text-ink-muted">
              {yankee.profit === null ? (
                "settles when all four are marked"
              ) : (
                <>
                  win £{yankee.winPart!.toFixed(2)} + place £{yankee.placePart!.toFixed(2)} back ·{" "}
                  <span className={TONE[moneyTone(yankee.profit)]}>{gbp(yankee.profit)}</span>
                </>
              )}
            </span>
          </li>
        )}
      </ul>
    </li>
  );
}

// ---------------------------------------------------------------------------

export default function HorsesPage() {
  const { data, isLoading, error } = useHorseBets();
  const [day, setDay] = useState(() => todayUk());
  const [showDays, setShowDays] = useState(7);
  const entryRef = useRef<HTMLDivElement>(null);
  const bets = useMemo(() => data?.bets ?? [], [data]);
  const days = useMemo(() => data?.days ?? [], [data]);
  const allYankees = useMemo(() => yankees(days, bets), [days, bets]);
  const byDay = useMemo(() => {
    const m = new Map<string, HorseBet[]>();
    for (const b of [...bets].sort((a, c) => c.day.localeCompare(a.day) || a.rank - c.rank)) (m.get(b.day) ?? m.set(b.day, []).get(b.day)!).push(b);
    return [...m.entries()];
  }, [bets]);
  const toMark = bets.filter((b) => b.result === "pending").length;

  return (
    <div className="space-y-6">
      <PageHeader
        as="h2"
        title="Today’s bets"
        subtitle="Your daily NAP and choices, and their results. The day's picks can be fetched for you, but amounts and odds are always yours to set; nothing here is bet automatically."
      />
      {data?.importStatus && (
        <p className={`text-xs ${data.importStatus.ok ? "text-ink-muted" : "text-destructive"}`}>
          Daily fetch: {data.importStatus.ok ? "ok" : "failed"} · {data.importStatus.message} · {new Date(data.importStatus.at).toLocaleString("en-GB", { timeZone: "Europe/London", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
        </p>
      )}

      {error ? (
        <QueryError error={error} next="/more/admin/horses" />
      ) : isLoading || !data ? (
        <div className="space-y-3">
          <Skeleton className="h-64 w-full" />
          <Skeleton className="h-40 w-full" />
        </div>
      ) : (
        <>
          <div ref={entryRef}>
            <EntryCard
              bets={bets}
              days={days}
              day={day}
              setDay={setDay}
              courses={data.courses}
              knownCourses={data.knownCourses}
              suggestions={data.suggestions.filter((s) => s.day === day)}
            />
          </div>

          <section className="space-y-2" aria-label="Daily record">
            <div className="flex items-baseline justify-between gap-3">
              <h3 className="text-base font-semibold text-ink">Daily record</h3>
              {toMark > 0 && <span className="text-xs text-warn">{toMark} result{toMark === 1 ? "" : "s"} to mark</span>}
            </div>
            {byDay.length === 0 ? (
              <p className="text-sm text-ink-muted">Your saved days will appear here, with a button to mark each result.</p>
            ) : (
              <>
                <ul className="space-y-2">
                  {byDay.slice(0, showDays).map(([d, list]) => (
                    <DayRecord
                      key={d}
                      day={d}
                      bets={list}
                      yankee={allYankees.find((y) => y.day === d) ?? null}
                      onEdit={() => {
                        setDay(d);
                        entryRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
                      }}
                    />
                  ))}
                </ul>
                {byDay.length > showDays && (
                  <button type="button" onClick={() => setShowDays((n) => n + 14)} className="rounded-md border border-line px-3 py-1.5 text-xs font-medium text-ink hover:bg-surface-2">
                    Show older days
                  </button>
                )}
              </>
            )}
          </section>

          <p className="text-sm">
            <Link href="/more/admin/horse-stats" className="font-medium text-accent">
              How it’s going: results, charts and patterns →
            </Link>
          </p>
        </>
      )}
    </div>
  );
}
