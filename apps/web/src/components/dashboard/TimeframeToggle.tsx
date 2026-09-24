import { Timeframe, TIMEFRAMES } from "@/domain/dashboard";

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
