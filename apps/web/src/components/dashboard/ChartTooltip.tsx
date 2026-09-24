export interface TooltipSeriesMeta {
  label: string;
  color: string;
  format: (v: number) => string;
}

interface ChartTooltipPayloadItem {
  dataKey?: string | number;
  value?: number | string;
}

export interface ChartTooltipProps {
  active?: boolean;
  label?: string | number;
  payload?: ChartTooltipPayloadItem[];
  series: Record<string, TooltipSeriesMeta>;
}

/** Pass as recharts' <Tooltip content={(props) => <ChartTooltip {...props} series={...} />} />. */
export function ChartTooltip({ active, label, payload, series }: ChartTooltipProps) {
  if (!active || !payload || payload.length === 0) return null;

  return (
    <div className="max-w-[220px] rounded-lg border border-line bg-surface-2 px-3 py-2 shadow-xl">
      {label !== undefined && <p className="mb-1 text-[11px] text-ink-muted">{label}</p>}
      <div className="space-y-1">
        {payload.map((entry) => {
          const key = String(entry.dataKey ?? "");
          const meta = series[key];
          if (!meta || typeof entry.value !== "number") return null;
          return (
            <div key={key} className="flex items-center gap-2 text-xs">
              <span
                className="h-2 w-2 shrink-0 rounded-full"
                style={{ background: meta.color }}
                aria-hidden="true"
              />
              <span className="text-ink-muted">{meta.label}</span>
              <span className="ml-auto shrink-0 font-medium tabular-nums text-ink">
                {meta.format(entry.value)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
