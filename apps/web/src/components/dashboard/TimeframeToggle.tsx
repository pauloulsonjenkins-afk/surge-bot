import { Segmented } from "@/components/ui/Card";

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
  return <Segmented label="Timeframe" value={value} onChange={onChange} options={TIMEFRAMES} />;
}
