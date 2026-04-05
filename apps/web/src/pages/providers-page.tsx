import { useEffect, useState } from "react";
import { Filter, Plus, Trash2 } from "lucide-react";
import { useSearchParams } from "react-router-dom";
import { toast } from "sonner";

import { type ProviderDetail, type ProviderKey, type ProviderSummary, api } from "@/lib/api";
import {
  extractErrorMessage,
  providerKeyDescription,
  statusVariant,
} from "@/lib/admin";
import { AddKeyDialog } from "@/components/admin/dialogs";
import {
  EmptyState,
  LegendStat,
  LoadingState,
  MixBar,
  PageHeader,
  StateAlert,
  SummaryStats,
} from "@/components/admin/primitives";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatDate } from "@/lib/format";

export function ProvidersPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [summaries, setSummaries] = useState<ProviderSummary[]>([]);
  const [selected, setSelected] = useState("");
  const [detail, setDetail] = useState<ProviderDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState("");
  const [addKeyOpen, setAddKeyOpen] = useState(false);
  const [providerQuery, setProviderQuery] = useState("");
  const [providerScope, setProviderScope] = useState<
    "all" | "healthy" | "attention"
  >("all");

  async function loadProviders(preferred?: string) {
    setLoading(true);

    try {
      const response = await api.getProviders();
      const nextSummaries = response.providers;
      const requested = searchParams.get("provider");
      const preferredName = preferred || requested || selected;
      const nextSelected = nextSummaries.some(
        (provider) => provider.name === preferredName,
      )
        ? preferredName
        : nextSummaries[0]?.name || "";

      setSummaries(nextSummaries);
      setSelected(nextSelected);
      setError("");
    } catch (requestError) {
      setError(extractErrorMessage(requestError));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadProviders();
  }, []);

  useEffect(() => {
    const requested = searchParams.get("provider");

    if (
      requested &&
      requested !== selected &&
      summaries.some((provider) => provider.name === requested)
    ) {
      setSelected(requested);
    }
  }, [searchParams, selected, summaries]);

  useEffect(() => {
    if (!selected) {
      setDetail(null);
      return;
    }

    if (searchParams.get("provider") !== selected) {
      const nextParams = new URLSearchParams(searchParams);
      nextParams.set("provider", selected);
      setSearchParams(nextParams, { replace: true });
    }

    let active = true;
    setDetailLoading(true);

    void (async () => {
      try {
        const response = await api.getProvider(selected);
        if (!active) {
          return;
        }

        setDetail(response);
        setDetailError("");
      } catch (requestError) {
        if (active) {
          setDetailError(extractErrorMessage(requestError));
        }
      } finally {
        if (active) {
          setDetailLoading(false);
        }
      }
    })();

    return () => {
      active = false;
    };
  }, [searchParams, selected, setSearchParams]);

  const selectedSummary =
    summaries.find((provider) => provider.name === selected) ?? null;
  const visibleSummaries = summaries.filter((provider) => {
    const matchesQuery = provider.name
      .toLowerCase()
      .includes(providerQuery.trim().toLowerCase());

    if (!matchesQuery) {
      return false;
    }

    if (providerScope === "healthy") {
      return provider.activeKeys > 0;
    }

    if (providerScope === "attention") {
      return provider.activeKeys === 0 || provider.disabledKeys + provider.revokedKeys > 0;
    }

    return true;
  });
  const selectedHasAttention =
    (selectedSummary?.activeKeys ?? 0) === 0 ||
    (selectedSummary?.disabledKeys ?? 0) + (selectedSummary?.revokedKeys ?? 0) > 0;

  const handleToggleKey = async (key: ProviderKey, index: number) => {
    if (!selected) {
      return;
    }

    try {
      await api.updateKey(selected, index, { enabled: !key.enabled });
      toast.success(`${selected} key updated`);
      await loadProviders(selected);
    } catch (requestError) {
      toast.error(extractErrorMessage(requestError));
    }
  };

  const handleDeleteKey = async (index: number) => {
    if (!selected) {
      return;
    }

    if (!window.confirm("Delete this API key permanently?")) {
      return;
    }

    try {
      await api.deleteKey(selected, index);
      toast.success(`Deleted key from ${selected}`);
      await loadProviders(selected);
    } catch (requestError) {
      toast.error(extractErrorMessage(requestError));
    }
  };

  return (
    <div className="space-y-4">
      <PageHeader
        badge="Provider pools"
        title="Provider 容量与 key 健康面板"
        description="先筛选 provider，再在右侧工作区集中处理 key 启停和替换。"
        actions={
          <>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setProviderQuery("");
                setProviderScope("all");
              }}
              disabled={!providerQuery && providerScope === "all"}
            >
              <Filter className="h-4 w-4" />
              Reset filters
            </Button>
            <Button size="sm" onClick={() => setAddKeyOpen(true)} disabled={!selectedSummary}>
              <Plus className="h-4 w-4" />
              Add key
            </Button>
          </>
        }
        stats={
          <SummaryStats
            items={[
              { label: "Providers", value: loading ? "..." : String(summaries.length) },
              {
                label: "Healthy pools",
                value: loading
                  ? "..."
                  : String(summaries.filter((provider) => provider.activeKeys > 0).length),
              },
              {
                label: "Attention pools",
                value: loading
                  ? "..."
                  : String(
                      summaries.filter((provider) => provider.activeKeys === 0).length,
                    ),
              },
            ]}
          />
        }
      />

      {error ? (
        <StateAlert tone="error" title="Failed to load providers" message={error} />
      ) : null}

      <div className="grid gap-4 xl:grid-cols-[280px_minmax(0,1fr)]">
        <Card className="xl:sticky xl:top-24 xl:h-fit">
          <CardHeader className="gap-3 border-b bg-muted/20">
            <div className="flex items-center justify-between gap-3">
              <div className="space-y-1.5">
                <Badge variant="secondary" className="w-fit">
                  Provider rail
                </Badge>
                <CardTitle>Choose a working set</CardTitle>
                <CardDescription>
                  左侧只负责检索和切换上下文，不在列表里混入编辑动作。
                </CardDescription>
              </div>
              <Badge variant="outline">
                {loading ? "..." : `${visibleSummaries.length}/${summaries.length}`}
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-3 p-3">
            <Input
              value={providerQuery}
              onChange={(event) => setProviderQuery(event.target.value)}
              placeholder="Filter providers by name"
            />
            <div className="grid grid-cols-3 gap-2">
              {[
                { id: "all", label: "All" },
                { id: "healthy", label: "Healthy" },
                { id: "attention", label: "Attention" },
              ].map((option) => (
                <Button
                  key={option.id}
                  variant={providerScope === option.id ? "default" : "outline"}
                  size="sm"
                  onClick={() =>
                    setProviderScope(option.id as "all" | "healthy" | "attention")
                  }
                >
                  {option.label}
                </Button>
              ))}
            </div>
            {loading ? (
              <LoadingState label="Loading providers" compact />
            ) : visibleSummaries.length ? (
              <div className="space-y-1.5">
                {visibleSummaries.map((provider) => {
                  const isSelected = provider.name === selected;

                  return (
                    <button
                      key={provider.name}
                      type="button"
                      onClick={() => setSelected(provider.name)}
                      className={cn(
                        "w-full rounded-lg border px-3 py-3 text-left transition-colors",
                        isSelected
                          ? "border-primary/20 bg-primary/5 shadow-sm"
                          : "border-border bg-background hover:bg-muted/50",
                      )}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <p className="truncate font-medium capitalize">{provider.name}</p>
                          <p className="text-xs text-muted-foreground">
                            {provider.total} keys · {provider.activeKeys} active
                          </p>
                        </div>
                        <Badge
                          variant={provider.activeKeys > 0 ? "success" : "destructive"}
                        >
                          {provider.activeKeys > 0 ? "Serving" : "Blocked"}
                        </Badge>
                      </div>
                      <div className="mt-2.5">
                        <MixBar
                          active={provider.activeKeys}
                          disabled={provider.disabledKeys}
                          revoked={provider.revokedKeys}
                          total={provider.total}
                          compact
                        />
                      </div>
                    </button>
                  );
                })}
              </div>
            ) : (
              <EmptyState
                title="No providers match"
                description="Clear or widen the filters to bring pools back into the rail."
              />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="gap-4 border-b bg-muted/20 md:flex-row md:items-start md:justify-between">
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="secondary">{selectedSummary?.name || "Provider"}</Badge>
                {selectedSummary ? (
                  <>
                    <Badge variant={selectedHasAttention ? "warning" : "success"}>
                      {selectedHasAttention ? "Needs review" : "Stable"}
                    </Badge>
                    <Badge variant="outline">Total {selectedSummary.total}</Badge>
                    <Badge variant="success">Active {selectedSummary.activeKeys}</Badge>
                    <Badge variant="warning">Disabled {selectedSummary.disabledKeys}</Badge>
                    <Badge variant="destructive">Revoked {selectedSummary.revokedKeys}</Badge>
                  </>
                ) : (
                  <Badge variant="outline">No selection</Badge>
                )}
              </div>
              <div className="space-y-1.5">
                <CardTitle className="capitalize">
                  {selectedSummary?.name || "Select a provider"} workspace
                </CardTitle>
                <CardDescription>
                  右侧工作区保留容量判断、操作说明和逐条 key 处理。
                </CardDescription>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {selectedSummary ? (
                <Badge variant="outline">{detail?.keys?.length ?? selectedSummary.total} keys</Badge>
              ) : null}
              <Button size="sm" onClick={() => setAddKeyOpen(true)} disabled={!selectedSummary}>
                <Plus className="h-4 w-4" />
                Add key
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-4 p-4">
            {!selectedSummary ? (
              <EmptyState
                title="No provider selected"
                description="Pick a provider from the rail to open its credential workspace."
              />
            ) : detailLoading ? (
              <LoadingState label="Loading provider details" compact />
            ) : detailError ? (
              <StateAlert
                tone="error"
                title="Failed to load provider details"
                message={detailError}
              />
            ) : (
              <div className="space-y-4">
                <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_320px]">
                  <div className="space-y-3 rounded-lg border bg-muted/20 p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="space-y-1.5">
                        <p className="text-sm font-medium">
                          {selectedHasAttention
                            ? "This pool is degraded and should be reviewed before traffic shifts toward it."
                            : "This pool is healthy and can keep receiving traffic."}
                        </p>
                        <p className="text-sm leading-6 text-muted-foreground">
                          优先替换 revoked key，再决定 disabled key 是否需要恢复。
                        </p>
                      </div>
                      <Badge variant={selectedHasAttention ? "warning" : "success"}>
                        {selectedHasAttention ? "Degraded" : "Healthy"}
                      </Badge>
                    </div>
                    <MixBar
                      active={selectedSummary.activeKeys}
                      disabled={selectedSummary.disabledKeys}
                      revoked={selectedSummary.revokedKeys}
                      total={selectedSummary.total}
                    />
                    <div className="grid gap-2 sm:grid-cols-3">
                      <LegendStat
                        label="Active"
                        value={selectedSummary.activeKeys}
                        tone="success"
                      />
                      <LegendStat
                        label="Disabled"
                        value={selectedSummary.disabledKeys}
                        tone="warning"
                      />
                      <LegendStat
                        label="Revoked"
                        value={selectedSummary.revokedKeys}
                        tone="destructive"
                      />
                    </div>
                  </div>

                  <div className="space-y-3 rounded-lg border bg-muted/20 p-4">
                    <div className="space-y-1">
                      <p className="text-sm font-medium">Operator notes</p>
                      <p className="text-sm leading-6 text-muted-foreground">
                        先控制风险，再做清理或恢复，避免把唯一仍在承载流量的凭据误下线。
                      </p>
                    </div>
                    <div className="space-y-2 text-sm text-muted-foreground">
                      <div className="rounded-md border bg-background px-3 py-2">
                        Disable suspicious keys first, then delete them after replacement is verified.
                      </div>
                      <div className="rounded-md border bg-background px-3 py-2">
                        Revoked keys cannot be re-enabled and should be replaced instead of recovered.
                      </div>
                      <div className="rounded-md border bg-background px-3 py-2">
                        Use last-used timestamps to avoid rotating out the only credential still serving traffic.
                      </div>
                    </div>
                  </div>
                </div>

                {detail?.keys?.length ? (
                  <div className="space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <p className="text-sm font-medium">Credential inventory</p>
                        <p className="text-sm text-muted-foreground">
                          逐条处理启停和删除动作，减少在长列表中来回扫描。
                        </p>
                      </div>
                      <Badge variant="outline">{detail.keys.length} rows</Badge>
                    </div>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Credential</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead>Last used</TableHead>
                          <TableHead>Notes</TableHead>
                          <TableHead className="text-right">Actions</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {detail.keys.map((key, index) => (
                          <TableRow key={`${selectedSummary.name}-${index}`}>
                            <TableCell className="font-mono text-sm text-primary">
                              {key.masked}
                            </TableCell>
                            <TableCell>
                              <Badge variant={statusVariant(key.status)}>
                                {key.status}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-muted-foreground">
                              {key.lastUsed ? formatDate(key.lastUsed) : "No usage recorded yet"}
                            </TableCell>
                            <TableCell className="max-w-[24rem] whitespace-normal text-muted-foreground">
                              {providerKeyDescription(key)}
                            </TableCell>
                            <TableCell>
                              <div className="flex justify-end gap-2">
                                <Button
                                  variant="outline"
                                  size="sm"
                                  disabled={key.status === "revoked"}
                                  onClick={() => handleToggleKey(key, index)}
                                >
                                  {key.enabled ? "Disable" : "Enable"}
                                </Button>
                                <Button
                                  variant="destructive"
                                  size="sm"
                                  onClick={() => handleDeleteKey(index)}
                                >
                                  <Trash2 className="h-4 w-4" />
                                  Delete
                                </Button>
                              </div>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                ) : (
                  <EmptyState
                    title="No keys configured"
                    description="Add a new key to start serving traffic through this provider."
                  />
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <AddKeyDialog
        open={addKeyOpen}
        provider={selectedSummary?.name ?? ""}
        onOpenChange={setAddKeyOpen}
        onAdded={async () => {
          await loadProviders(selectedSummary?.name);
        }}
      />
    </div>
  );
}
