import { useEffect, useState } from "react";
import { AlertTriangle, ArrowRight, CheckCircle2, ShieldAlert } from "lucide-react";
import { Link } from "react-router-dom";

import { type DashboardData, api } from "@/lib/api";
import { extractErrorMessage, summarizeNames } from "@/lib/admin";
import {
  EmptyState,
  LoadingState,
  MetricGrid,
  MixBar,
  PageHeader,
  StateAlert,
  SummaryStats,
} from "@/components/admin/primitives";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export function DashboardPage() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;

    void (async () => {
      try {
        const response = await api.getDashboard();
        if (!active) {
          return;
        }

        setData(response);
        setError("");
      } catch (requestError) {
        if (active) {
          setError(extractErrorMessage(requestError));
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    })();

    return () => {
      active = false;
    };
  }, []);

  if (loading) {
    return <LoadingState label="Loading dashboard" />;
  }

  if (error || !data) {
    return (
      <StateAlert
        tone="error"
        title="Failed to load dashboard"
        message={error || "No dashboard payload returned."}
      />
    );
  }

  const providers = data.providers;
  const totalProviders = providers.length;
  const configuredProviders = providers.filter((provider) => provider.total > 0).length;
  const healthyProviders = providers.filter((provider) => provider.activeKeys > 0).length;
  const totalKeys = providers.reduce((sum, provider) => sum + provider.total, 0);
  const activeKeys = providers.reduce((sum, provider) => sum + provider.activeKeys, 0);
  const disabledKeys = providers.reduce(
    (sum, provider) => sum + provider.disabledKeys,
    0,
  );
  const revokedKeys = providers.reduce((sum, provider) => sum + provider.revokedKeys, 0);
  const attentionProviders = providers.filter(
    (provider) => provider.total > 0 && provider.activeKeys === 0,
  );
  const degradedProviders = providers.filter(
    (provider) => provider.disabledKeys + provider.revokedKeys > 0,
  );
  const actionQueue = [
    attentionProviders.length
      ? {
          title: "No active keys",
          description: summarizeNames(
            attentionProviders.map((provider) => provider.name),
          ),
          link: "/providers",
          label: "Open",
          tone: "warning" as const,
        }
      : null,
    degradedProviders.length
      ? {
          title: "Degraded keys",
          description: `${disabledKeys} disabled · ${revokedKeys} revoked`,
          link: "/providers",
          label: "Inspect",
          tone: "error" as const,
        }
      : null,
    data.patCount === 0
      ? {
          title: "No PATs",
          description: "",
          link: "/pats",
          label: "Create",
          tone: "warning" as const,
        }
      : {
          title: "PATs",
          description: `${data.patCount} active`,
          link: "/pats",
          label: "Open",
          tone: "success" as const,
        },
  ].filter(
    (
      item,
    ): item is {
      title: string;
      description: string;
      link: string;
      label: string;
      tone: "success" | "warning" | "error";
    } => item !== null,
  );

  return (
    <div className="space-y-4">
      <PageHeader
        badge="Overview"
        title="Operations"
        actions={
          <>
            <Button asChild size="sm">
              <Link to="/providers">Providers</Link>
            </Button>
            <Button asChild size="sm" variant="outline">
              <Link to="/logs">Logs</Link>
            </Button>
          </>
        }
        stats={
          <SummaryStats
            items={[
              {
                label: "Providers",
                value: `${configuredProviders}/${totalProviders}`,
              },
              {
                label: "Attention",
                value: String(attentionProviders.length),
              },
              {
                label: "PATs",
                value: String(data.patCount),
              },
            ]}
          />
        }
      />

      <MetricGrid
        items={[
          {
            label: "Providers",
            value: `${configuredProviders}/${totalProviders}`,
            meta: `${healthyProviders} healthy`,
            badge: "Pools",
          },
          {
            label: "Active keys",
            value: String(activeKeys),
            meta: `${totalKeys} total`,
            badge: "Keys",
          },
          {
            label: "Attention keys",
            value: String(disabledKeys + revokedKeys),
            meta: `${disabledKeys} disabled · ${revokedKeys} revoked`,
            badge: "Risk",
          },
          {
            label: "PATs",
            value: String(data.patCount),
            meta: "active",
            badge: "Access",
          },
        ]}
      />

      <div className="grid gap-4 xl:grid-cols-[360px_minmax(0,1fr)]">
        <Card>
          <CardHeader className="gap-2 border-b bg-muted/20 p-3">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Badge variant="secondary">Queue</Badge>
                <CardTitle className="text-sm">Attention</CardTitle>
              </div>
              <Badge
                variant={
                  actionQueue.some((item) => item.tone !== "success")
                    ? "warning"
                    : "success"
                }
              >
                {actionQueue.length}
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {actionQueue.map((item) => (
              <div
                key={item.title}
                className="border-b px-3 py-3 last:border-b-0"
              >
                <div className="flex items-start gap-2.5">
                  <div
                    className={
                      item.tone === "success"
                        ? "rounded border border-emerald-200 bg-emerald-50 p-1.5 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/70 dark:text-emerald-300"
                        : item.tone === "warning"
                          ? "rounded border border-amber-200 bg-amber-50 p-1.5 text-amber-700 dark:border-amber-900 dark:bg-amber-950/70 dark:text-amber-300"
                          : "rounded border border-rose-200 bg-rose-50 p-1.5 text-rose-700 dark:border-rose-900 dark:bg-rose-950/70 dark:text-rose-300"
                    }
                  >
                    {item.tone === "success" ? (
                      <CheckCircle2 className="h-4 w-4" />
                    ) : item.tone === "warning" ? (
                      <AlertTriangle className="h-4 w-4" />
                    ) : (
                      <ShieldAlert className="h-4 w-4" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-sm">{item.title}</p>
                    {item.description ? (
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {item.description}
                      </p>
                    ) : null}
                    <Button
                      asChild
                      variant="ghost"
                      size="sm"
                      className="mt-1 h-auto px-0 text-primary hover:bg-transparent"
                    >
                      <Link to={item.link}>
                        {item.label}
                        <ArrowRight className="h-4 w-4" />
                      </Link>
                    </Button>
                  </div>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="gap-2 border-b bg-muted/20 p-3 md:flex-row md:items-center md:justify-between">
            <div className="flex items-center gap-2">
              <Badge variant="secondary">Providers</Badge>
              <CardTitle className="text-sm">Capacity</CardTitle>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant="outline">{providers.length}</Badge>
              <Button asChild variant="outline" size="sm">
                <Link to="/providers">Open</Link>
              </Button>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {providers.length ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Provider</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Capacity mix</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {providers
                    .slice()
                    .sort((left, right) => right.total - left.total)
                    .map((provider) => (
                      <TableRow key={provider.name}>
                        <TableCell className="w-[32%]">
                          <Link to={`/providers?provider=${provider.name}`} className="block">
                            <div className="font-medium capitalize">{provider.name}</div>
                            <div className="text-sm text-muted-foreground">
                              {provider.total
                                ? `${Math.round((provider.activeKeys / provider.total) * 100)}% active`
                                : "No keys configured"}
                            </div>
                          </Link>
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant={
                              provider.activeKeys > 0 ? "success" : "destructive"
                            }
                          >
                            {provider.activeKeys > 0 ? "Serving" : "Blocked"}
                          </Badge>
                        </TableCell>
                        <TableCell className="min-w-[220px]">
                          <MixBar
                            active={provider.activeKeys}
                            disabled={provider.disabledKeys}
                            revoked={provider.revokedKeys}
                            total={provider.total}
                            compact
                          />
                        </TableCell>
                        <TableCell className="text-right font-mono text-sm text-muted-foreground">
                          {provider.total}
                        </TableCell>
                      </TableRow>
                    ))}
                </TableBody>
              </Table>
            ) : (
              <div className="p-4">
                <EmptyState title="No providers" />
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
