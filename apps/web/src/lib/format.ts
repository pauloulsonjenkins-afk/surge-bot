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

export function formatPercent(value: number, digits = 1): string {
  return `${value.toFixed(digits)}%`;
}

export function formatSignedPercent(value: number, digits = 1): string {
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(digits)}%`;
}

export function formatNumber(value: number): string {
  return new Intl.NumberFormat("en-GB").format(value);
}

export function formatRatio(value: number): string {
  return value.toFixed(2);
}

/** Money as the app shows it: "+£4.00", "−£2.00" (a true minus sign), "£0.00". signed = false leaves off the "+". */
export function gbp(n: number, signed = true): string {
  const sign = n < 0 ? "−" : signed && n > 0 ? "+" : "";
  return `${sign}£${Math.abs(n).toFixed(2)}`;
}
