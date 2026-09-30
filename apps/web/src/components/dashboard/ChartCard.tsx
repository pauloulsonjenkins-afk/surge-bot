import { Card } from "@/components/ui/Card";

/** A dashboard chart panel: the shared Card with a title, an optional line under it and optional buttons. */
export function ChartCard({
  title,
  subtitle,
  actions,
  children,
}: {
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Card title={title} subtitle={subtitle} actions={actions}>
      {children}
    </Card>
  );
}
