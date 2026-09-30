/**
 * The shared building blocks every page uses, so spacing, corners and type are the same everywhere.
 *
 *   <PageHeader>   the title at the top of a page, with an optional line under it and buttons on the right
 *   <Card>         a panel, optionally with a title, a line under it and buttons on the right
 *   <StatTile>     one headline number with a label
 *   <Badge>        a small coloured label (Hit, Miss, Stopped today ...)
 *   <Segmented>    a row of 2–4 options where one is selected
 */

export function PageHeader({
  title,
  subtitle,
  actions,
  as: Heading = "h1",
}: {
  title: string;
  subtitle?: React.ReactNode;
  actions?: React.ReactNode;
  /** Admin pages sit under the "Admin" heading, so they use h2. */
  as?: "h1" | "h2";
}) {
  return (
    <header className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <Heading className="text-xl font-semibold tracking-tight text-ink">{title}</Heading>
        {subtitle && <p className="mt-1 text-sm text-ink-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </header>
  );
}

export function Card({
  title,
  subtitle,
  actions,
  children,
  className = "",
  as: Tag = "section",
}: {
  title?: React.ReactNode;
  subtitle?: React.ReactNode;
  actions?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
  as?: "section" | "div" | "li";
}) {
  const hasHead = title !== undefined || subtitle !== undefined || actions !== undefined;
  return (
    <Tag className={`rounded-xl border border-line bg-surface p-4 ${className}`}>
      {hasHead && (
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            {title !== undefined && <h2 className="text-sm font-semibold text-ink">{title}</h2>}
            {subtitle !== undefined && <p className="mt-0.5 text-xs text-ink-muted">{subtitle}</p>}
          </div>
          {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
        </div>
      )}
      {children !== undefined && <div className={hasHead ? "mt-3" : ""}>{children}</div>}
    </Tag>
  );
}

export function StatTile({ label, value, sub }: { label: string; value: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-line bg-surface p-4">
      <p className="text-xs text-ink-muted">{label}</p>
      <p className="mt-1.5 text-xl font-semibold tabular-nums tracking-tight text-ink">{value}</p>
      {sub && <p className="mt-0.5 text-xs text-ink-muted">{sub}</p>}
    </div>
  );
}

const BADGE_TONE = {
  neutral: "bg-surface-2 text-ink-muted",
  accent: "bg-accent text-accent-ink",
  hit: "bg-hit/15 text-hit",
  miss: "bg-danger/15 text-danger",
  danger: "bg-danger text-white",
} as const;

export function Badge({ tone = "neutral", children }: { tone?: keyof typeof BADGE_TONE; children: React.ReactNode }) {
  return <span className={`inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-xs font-medium ${BADGE_TONE[tone]}`}>{children}</span>;
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
  className = "",
}: {
  options: ReadonlyArray<{ value: T; label: React.ReactNode }>;
  value: T;
  onChange: (v: T) => void;
  /** Read out by screen readers. */
  label: string;
  className?: string;
}) {
  return (
    <div role="tablist" aria-label={label} className={`inline-flex gap-0.5 rounded-lg border border-line bg-surface-2 p-0.5 ${className}`}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="tab"
          aria-selected={value === o.value}
          onClick={() => onChange(o.value)}
          className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${
            value === o.value ? "bg-accent text-accent-ink" : "text-ink-muted hover:text-ink"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
