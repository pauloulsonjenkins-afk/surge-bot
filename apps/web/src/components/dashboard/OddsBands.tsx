import type { OddsBand } from "@/server/engine-client";
import { moneyTone } from "@/components/ui/Card";
import { roiText } from "@/lib/hit-rate";

/** Fewer picks than this in a price range and its figures are mostly luck, so the row is shown faint. */
const ENOUGH = 50;

const TONE = { hit: "text-hit", loss: "text-loss", muted: "text-ink", ink: "text-ink" } as const;

/**
 * The same picks split by price, so it shows which price ranges are paying. Each range is judged against its own
 * break-even, which is accurate because the prices inside one range are close together. Hit rates are for everyone;
 * the return per £1 is the admin's only (the stats route removes it for others, and `money` hides the column).
 */
export function OddsBands({ bands, money }: { bands: OddsBand[] | undefined; money: boolean }) {
  const rows = (bands ?? []).filter((b) => b.settled > 0);
  // One range alone has nothing to compare against.
  if (rows.length < 2) return null;
  return (
    <section aria-label="Results by price" className="rounded-xl border border-line bg-surface p-4">
      <h2 className="text-base font-semibold text-ink">By price</h2>
      <p className="mt-0.5 text-xs text-ink-muted">Which odds ranges are paying. Faint rows have under {ENOUGH} picks, so don&apos;t read much into them.</p>
      <table className="mt-3 w-full text-sm tabular-nums">
        <thead>
          <tr className="text-left text-xs text-ink-muted">
            <th scope="col" className="pb-1.5 font-normal">Odds</th>
            <th scope="col" className="pb-1.5 text-right font-normal">Picks</th>
            <th scope="col" className="pb-1.5 text-right font-normal">Hit rate</th>
            <th scope="col" className="pb-1.5 text-right font-normal">Needs</th>
            {money && <th scope="col" className="pb-1.5 text-right font-normal">Return per £1</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((b) => {
            const enough = b.settled >= ENOUGH;
            const clears = b.hitRate !== null && b.breakeven !== null ? b.hitRate >= b.breakeven : null;
            const tone = clears === null ? "ink" : clears ? "hit" : "loss";
            return (
              <tr key={b.label} className={`border-t border-line ${enough ? "" : "opacity-60"}`}>
                <th scope="row" className="py-1.5 pr-2 text-left font-normal text-ink">{b.label}</th>
                <td className="py-1.5 text-right text-ink-muted">{b.settled}</td>
                <td className={`py-1.5 text-right font-medium ${TONE[tone]}`}>{b.hitRate === null ? "–" : `${b.hitRate}%`}</td>
                <td className="py-1.5 text-right text-ink-muted">{b.breakeven === null ? "–" : `${b.breakeven}%`}</td>
                {money && (
                  <td className={`py-1.5 text-right font-medium ${b.roi === null ? "text-ink-muted" : TONE[moneyTone(b.roi)]}`}>{roiText(b.roi)}</td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}
