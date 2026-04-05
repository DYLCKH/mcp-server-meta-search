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
    <div className="space-y-6">
      <PageHeader
        badge="Provider pools"
        title="Provider 容量与 key 健康面板"
        description="先筛选 provider，再在右侧工作区集中处理 key 启停和替换。"
        actions={
          <>
            <Button
              variant="outline"
              onClick={() => {
                setProviderQuery("");
                setProviderScope("all");
              }}
              disabled={!providerQuery && providerScope === "all"}
            >
              <Filter className="h-4 w-4" />
              Reset filters
            </Button>
            <Button onClick={() => setAddKeyOpen(true)} disabled={!selectedSummary}>
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

      <div className="grid gap-6 xl:grid-cols-[320px_minmax(0,1fr)]">
        <Card className="xl:sticky xl:top-28 xl:h-fit">
          <CardHeader className="space-y-2">
            <Badge variant="outline" className="w-fit">
              Provider rail
            </Badge>
            <CardTitle>Choose a working set</CardTitle>
            <CardDescription>
              左侧只负责检索和切换上下文，避免在一个页面里混入过多编辑操作。
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
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
              <div className="space-y-2">
                {visibleSummaries.map((provider) => {
                  const isSelected = provider.name === selected;

                  return (
                    <button
                      key={provider.name}
                      type="button"
                      onClick={() => setSelected(provider.name)}
                      className={cn(
                        "w-full rounded-xl border px-4 py-3 text-left transition-colors",
                        isSelected
                          ? "border-primary/30 bg-primary/5"
                          : "border-border bg-background hover:bg-muted/40",
                      )}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="font-medium capitalize">{provider.name}</p>
                          <p className="text-sm text-muted-foreground">
                            {provider.total} keys · {provider.activeKeys} active
                          </p>
                        </div>
                        <Badge
                          variant={provider.activeKeys > 0 ? "success" : "destructive"}
                        >
                          {provider.activeKeys > 0 ? "Serving" : "Blocked"}
                        </Badge>
                      </div>
                      <div className="mt-3">
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
          <CardHeader className="gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="space-y-3">
              <div className="space-y-2">
                <Badge variant="outline" className="w-fit">
                  {selectedSummary?.name || "Provider"}
                </Badge>
                <CardTitle className="capitalize">
                  {selectedSummary?.name || "Select a provider"} workspace
                </CardTitle>
                <CardDescription>
                  右侧只保留容量判断、operator notes 和逐条 key 操作。
                </CardDescription>
              </div>
              {selectedSummary ? (
                <div className="flex flex-wrap gap-2">
                  <Badge variant={selectedHasAttention ? "warning" : "success"}>
                    {selectedHasAttention ? "Needs review" : "Stable"}
                  </Badge>
                  <Badge variant="outline">Total {selectedSummary.total}</Badge>
                  <Badge variant="success">Active {selectedSummary.activeKeys}</Badge>
                  <Badge variant="warning">Disabled {selectedSummary.disabledKeys}</Badge>
                  <Badge variant="destructive">Revoked {selectedSummary.revokedKeys}</Badge>
                </div>
              ) : null}
            </div>
            <Button onClick={() => setAddKeyOpen(true)} disabled={!selectedSummary}>
              <Plus className="h-4 w-4" />
              Add key
            </Button>
          </CardHeader>
          <CardContent>
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
              <div className="space-y-6">
                <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_280px]">
                  <Card className="shadow-none">
                    <CardContent className="space-y-4 p-5">
                      <div>
                        <p className="font-medium">
                          {selectedHasAttention
                            ? "This pool is degraded and should be reviewed before traffic shifts toward it."
                            : "This pool is healthy and can keep receiving traffic."}
                        </p>
                        <p className="mt-1 text-sm leading-6 text-muted-foreground">
                          优先替换 revoked key，再决定 disabled key 是否恢复。
                        </p>
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
                    </CardContent>
                  </Card>

                  <Card className="shadow-none">
                    <CardHeader className="pb-3">
                      <CardTitle className="text-base">Operator notes</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3 text-sm leading-6 text-muted-foreground">
                      <p>Disable suspicious keys first, then delete them after replacement is verified.</p>
                      <p>Revoked keys cannot be re-enabled and should be replaced instead of recovered.</p>
                      <p>Use last-used timestamps to avoid rotating out the only credential still serving traffic.</p>
                    </CardContent>
                  </Card>
                </div>

                {detail?.keys?.length ? (
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
                          <TableCell className="max-w-[24rem] text-muted-foreground">
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
