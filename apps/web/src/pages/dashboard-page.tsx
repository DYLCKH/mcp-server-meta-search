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
    <div className="space-y-6">
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

      <div className="grid gap-6 xl:grid-cols-[420px_minmax(0,1fr)]">
        <Card>
          <CardHeader>
            <Badge variant="outline" className="w-fit">
              Action queue
            </Badge>
            <CardTitle>What needs attention now</CardTitle>
            <CardDescription>
              用明确动作替代装饰性大卡片，先处理容量和暴露面问题。
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {actionQueue.map((item) => (
              <Card key={item.title} className="shadow-none">
                <CardContent className="space-y-3 p-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="space-y-2">
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
                      <p className="font-medium">{item.title}</p>
                      <p className="text-sm leading-6 text-muted-foreground">
                        {item.description}
                      </p>
                    </div>
                    {item.tone === "success" ? (
                      <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                    ) : item.tone === "warning" ? (
                      <AlertTriangle className="h-4 w-4 text-amber-600" />
                    ) : (
                      <ShieldAlert className="h-4 w-4 text-rose-600" />
                    )}
                  </div>
                  <Button asChild variant="ghost" className="px-0">
                    <Link to={item.link}>
                      {item.label}
                      <ArrowRight className="h-4 w-4" />
                    </Link>
                  </Button>
                </CardContent>
              </Card>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="space-y-2">
              <Badge variant="outline" className="w-fit">
                Provider matrix
              </Badge>
              <CardTitle>Where capacity is concentrated</CardTitle>
              <CardDescription>
                按 provider 汇总可用容量，先看总量，再判断哪个池已经失去流量承接能力。
              </CardDescription>
            </div>
            <Button asChild variant="outline">
              <Link to="/providers">Open provider console</Link>
            </Button>
          </CardHeader>
          <CardContent>
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
                        <TableCell>
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
                        <TableCell className="text-right text-sm text-muted-foreground">
                          {provider.total}
                        </TableCell>
                      </TableRow>
                    ))}
                </TableBody>
              </Table>
            ) : (
              <EmptyState
                title="No providers available"
                description="Add provider keys to start routing requests through the admin console."
              />
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
