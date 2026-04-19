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
  const requestedProvider = searchParams.get("provider") ?? "";
  const selected = summaries.some((provider) => provider.name === requestedProvider)
    ? requestedProvider
    : summaries[0]?.name ?? "";

  async function loadProviders() {
    setLoading(true);

    try {
      const response = await api.getProviders();
      setSummaries(response.providers);
      setError("");
    } catch (requestError) {
      setError(extractErrorMessage(requestError));
    } finally {
      setLoading(false);
    }
  }

  async function loadProviderDetail(name: string) {
    setDetailLoading(true);
    setDetailError("");

    try {
      const response = await api.getProvider(name);
      setDetail(response);
      setDetailError("");
    } catch (requestError) {
      setDetail(null);
      setDetailError(extractErrorMessage(requestError));
    } finally {
      setDetailLoading(false);
    }
  }

  async function refreshSelectedProvider(name: string) {
    await Promise.all([loadProviders(), loadProviderDetail(name)]);
  }

  useEffect(() => {
    void loadProviders();
  }, []);

  useEffect(() => {
    if (loading || requestedProvider === selected) {
      return;
    }

    const nextParams = new URLSearchParams(searchParams);
    if (selected) {
      nextParams.set("provider", selected);
    } else {
      nextParams.delete("provider");
    }
    setSearchParams(nextParams, { replace: true });
  }, [loading, requestedProvider, searchParams, selected, setSearchParams]);

  useEffect(() => {
    if (!selected) {
      setDetail(null);
      setDetailError("");
      setDetailLoading(false);
      return;
    }

    let active = true;
    setDetailLoading(true);
    setDetailError("");

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
          setDetail(null);
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
  }, [selected]);

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
      await refreshSelectedProvider(selected);
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
      await refreshSelectedProvider(selected);
    } catch (requestError) {
      toast.error(extractErrorMessage(requestError));
    }
  };

  return (
    <div className="space-y-4">
      <PageHeader
        badge="Providers"
        title="Keys"
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
              Reset
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
        <Card className="xl:sticky xl:top-20 xl:h-fit">
          <CardHeader className="gap-2 border-b bg-muted/20 p-3">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Badge variant="secondary">Rail</Badge>
                <CardTitle className="text-sm">Providers</CardTitle>
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
                      onClick={() => {
                        const nextParams = new URLSearchParams(searchParams);
                        nextParams.set("provider", provider.name);
                        setSearchParams(nextParams);
                      }}
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
              <EmptyState title="No matches" />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="gap-2 border-b bg-muted/20 p-3 md:flex-row md:items-center md:justify-between">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="secondary" className="capitalize">{selectedSummary?.name || "Provider"}</Badge>
              {selectedSummary ? (
                <>
                  <Badge variant={selectedHasAttention ? "warning" : "success"}>
                    {selectedHasAttention ? "Review" : "Stable"}
                  </Badge>
                  <Badge variant="outline">Total {selectedSummary.total}</Badge>
                  <Badge variant="success">Active {selectedSummary.activeKeys}</Badge>
                  <Badge variant="warning">Disabled {selectedSummary.disabledKeys}</Badge>
                  <Badge variant="destructive">Revoked {selectedSummary.revokedKeys}</Badge>
                </>
              ) : (
                <Badge variant="outline">None</Badge>
              )}
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
          <CardContent className="space-y-3 p-3">
            {!selectedSummary ? (
              <EmptyState title="Select a provider" />
            ) : detailLoading ? (
              <LoadingState label="Loading" compact />
            ) : detailError ? (
              <StateAlert
                tone="error"
                title="Failed to load provider details"
                message={detailError}
              />
            ) : (
              <div className="space-y-3">
                <div className="space-y-3 rounded-lg border bg-muted/20 p-3">
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
                ) : (
                  <EmptyState title="No keys configured" />
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
          if (!selectedSummary) {
            await loadProviders();
            return;
          }

          await refreshSelectedProvider(selectedSummary.name);
        }}
      />
    </div>
  );
}
