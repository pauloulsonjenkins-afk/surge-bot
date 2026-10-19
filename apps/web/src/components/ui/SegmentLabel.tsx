/** Gold for "Golden", the colour its picks are known by (Second Pour's Golden alerts), on every page that names it. */
export const GOLD = "#C9A227";

/** A watched slice's label with the word "Golden" picked out in gold. */
export function SegmentLabel({ label }: { label: string }) {
  const parts = label.split(/(Golden)/);
  return (
    <>
      {parts.map((p, i) =>
        p === "Golden" ? (
          <span key={i} className="font-semibold" style={{ color: GOLD }}>
            Golden
          </span>
        ) : (
          <span key={i}>{p}</span>
        ),
      )}
    </>
  );
}

/** The small badge a Golden alert carries on Live. */
export function GoldenBadge({ title }: { title?: string }) {
  return (
    <span title={title} className="rounded-full px-2 py-0.5 text-[11px] font-semibold" style={{ color: GOLD, background: "color-mix(in srgb, #C9A227 16%, transparent)" }}>
      Golden
    </span>
  );
}
