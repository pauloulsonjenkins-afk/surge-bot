/**
 * The shared building blocks every page uses, so spacing, corners and type are the same everywhere.
 *
 *   <PageHeader>   the title at the top of a page (Inter 24px on phones, wide Archivo 28px from laptop width), with an optional line under it and buttons on the right
 *   <Card>         a panel, optionally with a title, a line under it and buttons on the right
 *   <HeroStat>     one headline number with a label, with no card around it (the Dashboard's top row)
 *   <Segmented>    a row of 2–4 options where one is selected
 *   <ToggleChip>   an on/off filter shaped like a chip, in place of a bare checkbox
 *
 * Type scale (see tailwind.config.ts): page title 24px on phones and 28px wide, section title 16px, body 14px, meta 12px, key numbers 28px.
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
        <Heading className="text-2xl font-semibold tracking-tight text-ink lg:font-display lg:text-title lg:font-bold lg:tracking-normal lg:[font-stretch:115%]">
          {title}
        </Heading>
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
            {title !== undefined && <h2 className="text-base font-semibold text-ink">{title}</h2>}
            {subtitle !== undefined && <p className="mt-0.5 text-xs text-ink-muted">{subtitle}</p>}
          </div>
          {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
        </div>
      )}
      {children !== undefined && <div className={hasHead ? "mt-3" : ""}>{children}</div>}
    </Tag>
  );
}

export function HeroStat({
  label,
  value,
  sub,
  tone = "ink",
}: {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  tone?: "ink" | "hit" | "loss" | "muted";
}) {
  const colour = { ink: "text-ink", hit: "text-hit", loss: "text-loss", muted: "text-ink-muted" }[tone];
  return (
    <div className="min-w-0">
      <p className="text-xs text-ink-muted">{label}</p>
      <p className={`mt-1 font-display text-stat font-bold tabular-nums [font-stretch:112%] ${colour}`}>{value}</p>
      {sub && <p className="mt-0.5 truncate text-xs text-ink-muted">{sub}</p>}
    </div>
  );
}

/** Text colour for an amount of money: green above zero, red below. */
export function moneyTone(value: number): "hit" | "loss" | "muted" {
  return value > 0 ? "hit" : value < 0 ? "loss" : "muted";
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
          className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
            value === o.value ? "bg-accent text-accent-ink" : "text-ink-muted hover:text-ink"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function ToggleChip({
  checked,
  onChange,
  children,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={checked}
      onClick={() => onChange(!checked)}
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
        checked ? "border-accent bg-accent/15 text-ink" : "border-line text-ink-muted hover:text-ink"
      }`}
    >
      <span
        aria-hidden
        className={`h-1.5 w-1.5 rounded-full ${checked ? "bg-accent" : "bg-ink-muted/50"}`}
      />
      {children}
    </button>
  );
}
