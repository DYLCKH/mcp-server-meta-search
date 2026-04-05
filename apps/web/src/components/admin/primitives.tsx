import type { ReactNode } from "react";
import { AlertTriangle, CheckCircle2, LoaderCircle, ShieldAlert } from "lucide-react";

import { PAGE_SIZE } from "@/lib/admin";
import { cn } from "@/lib/utils";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";

export function PageHeader({
  badge,
  title,
  description,
  actions,
  stats,
}: {
  badge: string;
  title: string;
  description: string;
  actions?: ReactNode;
  stats?: ReactNode;
}) {
  return (
    <Card className="border-border/80 bg-card/90">
      <CardHeader className="gap-6 lg:flex-row lg:items-start lg:justify-between">
        <div className="space-y-3">
          <Badge>{badge}</Badge>
          <div className="space-y-2">
            <CardTitle className="text-3xl tracking-tight sm:text-4xl">{title}</CardTitle>
            <CardDescription className="max-w-3xl text-sm leading-6">
              {description}
            </CardDescription>
          </div>
          {actions ? <div className="flex flex-wrap gap-3">{actions}</div> : null}
        </div>
        {stats ? <div className="w-full max-w-xl">{stats}</div> : null}
      </CardHeader>
    </Card>
  );
}

export function SummaryStats({
  items,
  columns = 3,
}: {
  items: Array<{ label: string; value: string }>;
  columns?: 2 | 3 | 4;
}) {
  return (
    <div
      className={cn(
        "grid gap-3",
        columns === 2 && "grid-cols-2",
        columns === 3 && "grid-cols-1 sm:grid-cols-3",
        columns === 4 && "grid-cols-2 lg:grid-cols-4",
      )}
    >
      {items.map((item) => (
        <Card key={item.label} className="bg-muted/30 shadow-none">
          <CardContent className="space-y-2 p-4">
            <p className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
              {item.label}
            </p>
            <p className="text-2xl font-semibold tracking-tight">{item.value}</p>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

export function MetricGrid({
  items,
}: {
  items: Array<{ label: string; value: string; meta: string; badge?: string }>;
}) {
  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
      {items.map((item) => (
        <Card key={item.label}>
          <CardContent className="space-y-4 p-5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-sm font-medium text-muted-foreground">{item.label}</p>
                <p className="mt-2 text-3xl font-semibold tracking-tight">{item.value}</p>
              </div>
              {item.badge ? <Badge variant="outline">{item.badge}</Badge> : null}
            </div>
            <p className="text-sm leading-6 text-muted-foreground">{item.meta}</p>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

export function StateAlert({
  tone,
  title,
  message,
}: {
  tone: "error" | "success" | "warning";
  title: string;
  message: string;
}) {
  const variant =
    tone === "error" ? "destructive" : tone === "success" ? "success" : "warning";

  return (
    <Alert variant={variant} className="flex gap-3">
      <div className="mt-0.5">
        {tone === "success" ? (
          <CheckCircle2 className="h-4 w-4" />
        ) : tone === "warning" ? (
          <AlertTriangle className="h-4 w-4" />
        ) : (
          <ShieldAlert className="h-4 w-4" />
        )}
      </div>
      <div>
        <AlertTitle>{title}</AlertTitle>
        <AlertDescription>{message}</AlertDescription>
      </div>
    </Alert>
  );
}

export function EmptyState({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <Card className="border-dashed shadow-none">
      <CardContent className="py-10 text-center">
        <p className="text-base font-medium">{title}</p>
        <p className="mx-auto mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
          {description}
        </p>
      </CardContent>
    </Card>
  );
}

export function LoadingState({
  label,
  compact = false,
}: {
  label: string;
  compact?: boolean;
}) {
  return (
    <Card className="shadow-none">
      <CardContent className={cn("space-y-4 p-5", compact ? "py-5" : "py-8")}>
        <div className="flex items-center gap-3 text-sm text-muted-foreground">
          <LoaderCircle className="h-4 w-4 animate-spin text-primary" />
          <span>{label}</span>
        </div>
        <div className="space-y-3">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-3/4" />
        </div>
      </CardContent>
    </Card>
  );
}

export function MixBar({
  active,
  disabled,
  revoked,
  total,
  compact = false,
}: {
  active: number;
  disabled: number;
  revoked: number;
  total: number;
  compact?: boolean;
}) {
  const safeTotal = total || 1;
  const activeWidth = `${(active / safeTotal) * 100}%`;
  const disabledWidth = `${(disabled / safeTotal) * 100}%`;
  const revokedWidth = `${(revoked / safeTotal) * 100}%`;

  return (
    <div className="space-y-2">
      <div
        className={cn(
          "flex overflow-hidden rounded-full bg-muted",
          compact ? "h-2" : "h-2.5",
        )}
      >
        <div className="bg-emerald-500" style={{ width: activeWidth }} />
        <div className="bg-amber-500" style={{ width: disabledWidth }} />
        <div className="bg-rose-500" style={{ width: revokedWidth }} />
      </div>
      <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
        <span>{active} active</span>
        <span>{disabled} disabled</span>
        <span>{revoked} revoked</span>
      </div>
    </div>
  );
}

export function LegendStat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "success" | "warning" | "destructive";
}) {
  return (
    <div className="flex items-center justify-between rounded-lg border bg-background px-3 py-2.5">
      <div className="flex items-center gap-2.5">
        <div
          className={cn(
            "h-2 w-2 rounded-full",
            tone === "success" && "bg-emerald-500",
            tone === "warning" && "bg-amber-500",
            tone === "destructive" && "bg-rose-500",
          )}
        />
        <span className="text-sm text-muted-foreground">{label}</span>
      </div>
      <span className="text-sm font-medium">{value}</span>
    </div>
  );
}

export function Field({
  label,
  hint,
  input,
}: {
  label: string;
  hint?: string;
  input: ReactNode;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <Label>{label}</Label>
        {hint ? <span className="text-xs text-muted-foreground">{hint}</span> : null}
      </div>
      {input}
    </div>
  );
}

export function PaginationBar({
  page,
  count,
  hasMore,
  onPrevious,
  onNext,
}: {
  page: number;
  count: number;
  hasMore: boolean;
  onPrevious: () => void;
  onNext: () => void;
}) {
  const from = count ? page * PAGE_SIZE + 1 : 0;
  const to = page * PAGE_SIZE + count;

  return (
    <div className="flex flex-col gap-3 rounded-xl border bg-muted/30 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="text-sm text-muted-foreground">
        Page {page + 1} · Showing {from}-{to}
      </div>
      <div className="flex gap-2">
        <Button variant="outline" size="sm" onClick={onPrevious} disabled={page === 0}>
          Previous
        </Button>
        <Button variant="outline" size="sm" onClick={onNext} disabled={!hasMore}>
          Next
        </Button>
      </div>
    </div>
  );
}
