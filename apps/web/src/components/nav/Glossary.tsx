"use client";

import { useRef } from "react";
import { CircleHelp, X } from "lucide-react";

/**
 * The site's own words, in plain English (14 Nov 2026; the 11 Nov review counted eighteen terms a reader must know).
 * One sheet, opened from the "?" in the header on every page.
 */
const TERMS: Array<[string, string]> = [
  ["Live", "Bets placed on Betfair with real money."],
  ["Sim", "Practice. The bet is recorded as if it had been placed, at the strategy's stake, but no money goes on."],
  ["Return per £1", "Profit divided by the money staked. +5% means 5p made for every £1 bet."],
  ["Units", "The same results with every bet counted as one equal stake, so changing a stake can't make a record look better or worse."],
  ["Hit rate and break-even", "Hit rate is the share of bets won. Break-even is the share you need to win at the prices taken just to get your money back. At short prices a high hit rate can still lose."],
  ["Too early", "Fewer than 100 bets. The return is shown in grey because it could easily be luck."],
  ["Probably winning", "Enough bets that the return is likely to be real. Only then does the site suggest raising a stake or going Live."],
  ["Price check", "The alert's price against Betfair's price at that moment. Regularly getting a better price than the market is the earliest sign a strategy has an edge."],
  ["Golden slice", "A part of a strategy that does better than the rest of it, such as one price range or one part of the match. It can be put Live on its own."],
  ["Watched", "A Golden slice being proved on new matches before it is trusted."],
  ["Shelved", "A slice set aside because it stopped holding up. It is still recorded."],
  ["Losing in Sim", "A strategy clearly losing over 50 or more practice bets. Still recorded, and it comes back up the list by itself if it turns."],
  ["Daily loss stop", "Betting stops for the day once Live losses reach the limit you set."],
  ["LAY", "A bet against something happening, where you are the one paying out if it does."],
];

export default function Glossary() {
  const ref = useRef<HTMLDialogElement>(null);
  return (
    <>
      <button
        type="button"
        onClick={() => ref.current?.showModal()}
        aria-label="What the words mean"
        title="What the words mean"
        className="flex h-[30px] w-[30px] items-center justify-center rounded-md border border-line text-ink-muted transition-colors hover:text-ink"
      >
        <CircleHelp size={15} />
      </button>
      <dialog ref={ref} className="sheet" aria-label="What the words mean" onClick={(e) => e.target === ref.current && ref.current?.close()}>
        <div className="max-h-[80dvh] overflow-y-auto p-5">
          <div className="flex items-start justify-between gap-3">
            <h2 className="font-display text-xl font-bold text-ink [font-stretch:108%]">What the words mean</h2>
            <button type="button" onClick={() => ref.current?.close()} aria-label="Close" className="flex h-[30px] w-[30px] items-center justify-center rounded-md border border-line text-ink-muted hover:text-ink">
              <X size={15} />
            </button>
          </div>
          <dl className="mt-4 space-y-3.5">
            {TERMS.map(([term, meaning]) => (
              <div key={term}>
                <dt className="text-sm font-semibold text-ink">{term}</dt>
                <dd className="mt-0.5 text-sm text-ink-muted">{meaning}</dd>
              </div>
            ))}
          </dl>
        </div>
      </dialog>
    </>
  );
}
