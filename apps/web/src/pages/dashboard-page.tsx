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
  CardDescription,
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
          title: "Restore provider capacity",
          description: `${summarizeNames(
            attentionProviders.map((provider) => provider.name),
          )} currently have no active keys.`,
          link: "/providers",
          label: "Open providers",
          tone: "warning" as const,
        }
      : null,
    degradedProviders.length
      ? {
          title: "Review degraded credentials",
          description: `${disabledKeys} disabled and ${revokedKeys} revoked keys are reducing usable capacity.`,
          link: "/providers",
          label: "Inspect keys",
          tone: "error" as const,
        }
      : null,
    data.patCount === 0
      ? {
          title: "Create the first client token",
          description: "Downstream clients still do not have PAT-based access.",
          link: "/pats",
          label: "Create PAT",
          tone: "warning" as const,
        }
      : {
          title: "Review PAT exposure",
          description: `${data.patCount} PATs are active in the current environment.`,
          link: "/pats",
          label: "Open PAT registry",
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
        badge="Operations overview"
        title="搜索基础设施运行总览"
        description="先确认容量、暴露面和风险点，再进入具体工作区执行操作。"
        actions={
          <>
            <Button asChild>
              <Link to="/providers">Manage providers</Link>
            </Button>
            <Button asChild variant="outline">
              <Link to="/logs">Inspect logs</Link>
            </Button>
          </>
        }
        stats={
          <SummaryStats
            items={[
              {
                label: "Configured providers",
                value: `${configuredProviders}/${totalProviders}`,
              },
              {
                label: "Attention pools",
                value: String(attentionProviders.length),
              },
              {
                label: "PAT inventory",
                value: String(data.patCount),
              },
            ]}
          />
        }
      />

      <MetricGrid
        items={[
          {
            label: "Provider fleet",
            value: `${configuredProviders}/${totalProviders}`,
            meta: `${healthyProviders} healthy pools in service.`,
            badge: "Providers",
          },
          {
            label: "Active capacity",
            value: String(activeKeys),
            meta: `${totalKeys} total keys across all providers.`,
            badge: "Keys",
          },
          {
            label: "Keys needing action",
            value: String(disabledKeys + revokedKeys),
            meta: `${disabledKeys} disabled, ${revokedKeys} revoked.`,
            badge: "Risk",
          },
          {
            label: "PAT inventory",
            value: String(data.patCount),
            meta: "Keep the client token surface intentionally small.",
            badge: "Access",
          },
        ]}
      />

      <div className="grid gap-4 xl:grid-cols-[360px_minmax(0,1fr)]">
        <Card>
          <CardHeader className="gap-4 border-b bg-muted/20">
            <div className="flex items-center justify-between gap-3">
              <div className="space-y-1.5">
                <Badge variant="secondary" className="w-fit">
                  Action queue
                </Badge>
                <CardTitle>What needs attention now</CardTitle>
                <CardDescription>
                  首屏只保留当前最值得处理的动作，避免信息分散在多个装饰区块里。
                </CardDescription>
              </div>
              <Badge
                variant={
                  actionQueue.some((item) => item.tone !== "success")
                    ? "warning"
                    : "success"
                }
              >
                {actionQueue.length} items
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {actionQueue.map((item) => (
              <div
                key={item.title}
                className="border-b px-4 py-4 last:border-b-0"
              >
                <div className="flex items-start gap-3">
                  <div
                    className={
                      item.tone === "success"
                        ? "rounded-md border border-emerald-200 bg-emerald-50 p-2 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/70 dark:text-emerald-300"
                        : item.tone === "warning"
                          ? "rounded-md border border-amber-200 bg-amber-50 p-2 text-amber-700 dark:border-amber-900 dark:bg-amber-950/70 dark:text-amber-300"
                          : "rounded-md border border-rose-200 bg-rose-50 p-2 text-rose-700 dark:border-rose-900 dark:bg-rose-950/70 dark:text-rose-300"
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
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-medium">{item.title}</p>
                      <Badge
                        variant={
                          item.tone === "success"
                            ? "success"
                            : item.tone === "warning"
                              ? "warning"
                              : "destructive"
                        }
                      >
                        {item.tone === "success"
                          ? "Stable"
                          : item.tone === "warning"
                            ? "Attention"
                            : "Risk"}
                      </Badge>
                    </div>
                    <p className="mt-1 text-sm leading-6 text-muted-foreground">
                      {item.description}
                    </p>
                    <Button
                      asChild
                      variant="ghost"
                      size="sm"
                      className="mt-2 h-auto px-0 text-primary hover:bg-transparent"
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
          <CardHeader className="gap-4 border-b bg-muted/20 md:flex-row md:items-start md:justify-between">
            <div className="space-y-1.5">
              <Badge variant="secondary" className="w-fit">
                Provider matrix
              </Badge>
              <CardTitle>Where capacity is concentrated</CardTitle>
              <CardDescription>
                按 provider 汇总可用容量，先看总量，再判断哪个池已经失去流量承接能力。
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant="outline">{providers.length} providers</Badge>
              <Button asChild variant="outline" size="sm">
                <Link to="/providers">Open provider console</Link>
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
                <EmptyState
                  title="No providers available"
                  description="Add provider keys to start routing requests through the admin console."
                />
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
