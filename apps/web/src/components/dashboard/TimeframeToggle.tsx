export type Timeframe = "1D" | "7D" | "30D" | "ALL";

export const TIMEFRAMES: Array<{ value: Timeframe; label: string; days: number | null }> = [
  { value: "1D", label: "1D", days: 1 },
  { value: "7D", label: "7D", days: 7 },
  { value: "30D", label: "30D", days: 30 },
  { value: "ALL", label: "All", days: null },
];

export function TimeframeToggle({
  value,
  onChange,
}: {
  value: Timeframe;
  onChange: (tf: Timeframe) => void;
}) {
  return (
    <div role="tablist" aria-label="Timeframe" className="inline-flex gap-1 rounded-lg border border-line bg-surface p-1">
      {TIMEFRAMES.map((tf) => {
        const active = tf.value === value;
        return (
          <button
            key={tf.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(tf.value)}
            className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
              active ? "bg-accent text-accent-ink" : "text-ink-muted hover:text-ink"
            }`}
          >
            {tf.label}
          </button>
        );
      })}
    </div>
  );
}
