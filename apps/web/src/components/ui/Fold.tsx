/**
 * A section folded to one line, opened on a tap: for what's only worth reading now and then (settings, detail behind a
 * figure already shown). Added in the 29 Oct 2026 phone tidy-up, when Today, Profit and Leagues ran to 5-7 phone
 * screens with every section open.
 */
export function Fold({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <details className="rounded-xl border border-line bg-surface px-3.5">
      <summary className="flex min-h-11 cursor-pointer items-center gap-2 text-sm font-medium text-ink">
        {title}
        {hint && <span className="text-xs font-normal text-ink-muted">· {hint}</span>}
      </summary>
      <div className="pb-3.5">{children}</div>
    </details>
  );
}
