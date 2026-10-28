const gbpFmt = new Intl.NumberFormat("en-GB", {
  style: "currency",
  currency: "GBP",
  signDisplay: "auto",
});

const gbpSigned = new Intl.NumberFormat("en-GB", {
  style: "currency",
  currency: "GBP",
  signDisplay: "always",
});

export function formatCurrency(value: number, signed = false): string {
  return (signed ? gbpSigned : gbpFmt).format(value);
}

export function formatNumber(value: number): string {
  return new Intl.NumberFormat("en-GB").format(value);
}

/** Money as the app shows it: "+£4.00", "−£2.00" (a true minus sign), "£0.00". signed = false leaves off the "+". */
export function gbp(n: number, signed = true): string {
  const sign = n < 0 ? "−" : signed && n > 0 ? "+" : "";
  return `${sign}£${Math.abs(n).toFixed(2)}`;
}

/** Units (profit at a flat 1-unit stake per bet) as the app shows them: "+3.4u", "−1.0u", "0.0u". */
export function units(n: number): string {
  const r = Math.round(n * 10) / 10;
  return `${r < 0 ? "−" : r > 0 ? "+" : ""}${Math.abs(r).toFixed(1)}u`;
}

/**
 * A return per £1 (0.032 = 3.2%) as the app shows it: "+3.2%", "−1.5%" (a true minus sign), "0%", or "–" when there
 * isn't one. The sign is taken after rounding, so a tiny loss reads "0%", never "−0%".
 */
export function signedPct(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "–";
  const v = Math.round(n * 1000) / 10;
  return v === 0 ? "0%" : `${v > 0 ? "+" : "−"}${Math.abs(v)}%`;
}

/**
 * The text colour for a figure that wins or loses (money or a return): green above zero, red below, and `zero` at zero
 * or with nothing to show. Anything that would round to 0.0% or £0.00 counts as zero, so its colour matches its sign.
 */
export function toneOf(n: number | null | undefined, zero = "text-ink"): string {
  if (n == null || !Number.isFinite(n) || Math.abs(n) < 0.0005) return zero;
  return n > 0 ? "text-hit" : "text-loss";
}
