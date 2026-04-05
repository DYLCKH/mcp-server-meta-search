import { useEffect, useState } from "react";
import { Copy, Filter, Plus } from "lucide-react";
import { toast } from "sonner";

import { type PatRecord, api } from "@/lib/api";
import { copyToClipboard, extractErrorMessage, isPatExpiringSoon } from "@/lib/admin";
import { CreatePatDialog } from "@/components/admin/dialogs";
import {
  EmptyState,
  LoadingState,
  MetricGrid,
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

export function PatsPage() {
  const [pats, setPats] = useState<PatRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [createdToken, setCreatedToken] = useState<string | null>(null);
  const [revealedMessage, setRevealedMessage] = useState<string | null>(null);
  const [patQuery, setPatQuery] = useState("");
  const [patScope, setPatScope] = useState<
    "all" | "active" | "disabled" | "expiring"
  >("all");

  async function loadPats() {
    setLoading(true);

    try {
      const response = await api.getPats();
      setPats(response.pats);
      setError("");
    } catch (requestError) {
      setError(extractErrorMessage(requestError));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadPats();
  }, []);

  const handleTogglePat = async (pat: PatRecord) => {
    try {
      await api.updatePat(pat.name, { enabled: !pat.enabled });
      toast.success(`Updated PAT "${pat.name}"`);
      await loadPats();
    } catch (requestError) {
      toast.error(extractErrorMessage(requestError));
    }
  };

  const handleDeletePat = async (pat: PatRecord) => {
    if (!window.confirm(`Delete PAT "${pat.name}" permanently?`)) {
      return;
    }

    try {
      await api.deletePat(pat.name);
      toast.success(`Deleted PAT "${pat.name}"`);
      await loadPats();
    } catch (requestError) {
      toast.error(extractErrorMessage(requestError));
    }
  };

  const handleRevealPat = async (pat: PatRecord) => {
    try {
      const response = await api.revealPat(pat.name);
      setRevealedMessage(
        response.message || "Full tokens are only returned when the PAT is created.",
      );
    } catch (requestError) {
      toast.error(extractErrorMessage(requestError));
    }
  };

  const activeCount = pats.filter((pat) => pat.enabled).length;
  const disabledCount = pats.length - activeCount;
  const expiringPats = pats.filter((pat) => isPatExpiringSoon(pat));
  const filteredPats = pats.filter((pat) => {
    const haystack = `${pat.name} ${pat.note || ""}`.toLowerCase();
    const matchesQuery = haystack.includes(patQuery.trim().toLowerCase());

    if (!matchesQuery) {
      return false;
    }

    if (patScope === "active") {
      return pat.enabled;
    }

    if (patScope === "disabled") {
      return !pat.enabled;
    }

    if (patScope === "expiring") {
      return isPatExpiringSoon(pat);
    }

    return true;
  });

  return (
    <div className="space-y-6">
      <PageHeader
        badge="Access tokens"
        title="PAT 暴露面与过期风险控制"
        description="统一处理 token 创建、启停、删除和即将过期的清理队列。"
        actions={
          <>
            <Button
              variant="outline"
              onClick={() => {
                setPatQuery("");
                setPatScope("all");
              }}
              disabled={!patQuery && patScope === "all"}
            >
              <Filter className="h-4 w-4" />
              Reset filters
            </Button>
            <Button onClick={() => setCreateOpen(true)}>
              <Plus className="h-4 w-4" />
              Create PAT
            </Button>
          </>
        }
        stats={
          <SummaryStats
            items={[
              { label: "Active", value: loading ? "..." : String(activeCount) },
              { label: "Disabled", value: loading ? "..." : String(disabledCount) },
              {
                label: "Expiring soon",
                value: loading ? "..." : String(expiringPats.length),
              },
            ]}
          />
        }
      />

      {error ? (
        <StateAlert tone="error" title="Failed to load PATs" message={error} />
      ) : null}

      {createdToken ? (
        <Card className="border-emerald-200 bg-emerald-50">
          <CardHeader>
            <Badge variant="success" className="w-fit">
              Copy now
            </Badge>
            <CardTitle>PAT created successfully</CardTitle>
            <CardDescription>
              完整 token 只会展示这一次，建议立刻复制并分发到目标客户端。
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <code className="overflow-x-auto rounded-lg border bg-white px-3 py-2 font-mono text-sm">
              {createdToken}
            </code>
            <Button
              variant="outline"
              onClick={async () => {
                await copyToClipboard(createdToken);
              }}
            >
              <Copy className="h-4 w-4" />
              Copy token
            </Button>
          </CardContent>
        </Card>
      ) : null}

      {revealedMessage ? (
        <StateAlert tone="warning" title="Reveal unavailable" message={revealedMessage} />
      ) : null}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
        <Card>
          <CardHeader className="space-y-2">
            <Badge variant="outline" className="w-fit">
              Registry
            </Badge>
            <CardTitle>Token registry</CardTitle>
            <CardDescription>
              通过检索和状态过滤快速缩小待处理范围，不再在长列表里人工扫描。
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto]">
              <Input
                value={patQuery}
                onChange={(event) => setPatQuery(event.target.value)}
                placeholder="Search PATs by name or note"
              />
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {[
                  { id: "all", label: "All" },
                  { id: "active", label: "Active" },
                  { id: "disabled", label: "Disabled" },
                  { id: "expiring", label: "Expiring" },
                ].map((option) => (
                  <Button
                    key={option.id}
                    variant={patScope === option.id ? "default" : "outline"}
                    size="sm"
                    onClick={() =>
                      setPatScope(
                        option.id as "all" | "active" | "disabled" | "expiring",
                      )
                    }
                  >
                    {option.label}
                  </Button>
                ))}
              </div>
            </div>

            {loading ? (
              <LoadingState label="Loading tokens" compact />
            ) : pats.length ? (
              filteredPats.length ? (
                <>
                  <MetricGrid
                    items={[
                      {
                        label: "Active",
                        value: String(activeCount),
                        meta: "Tokens currently usable by downstream clients.",
                      },
                      {
                        label: "Disabled",
                        value: String(disabledCount),
                        meta: "Disabled tokens stay visible until explicit deletion.",
                      },
                      {
                        label: "Filtered view",
                        value: String(filteredPats.length),
                        meta: "The number of rows in the current working set.",
                      },
                      {
                        label: "Expiring soon",
                        value: String(expiringPats.length),
                        meta: "Tokens that should enter the rotation queue now.",
                      },
                    ]}
                  />

                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Name</TableHead>
                        <TableHead>Prefix</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Created</TableHead>
                        <TableHead>Last used</TableHead>
                        <TableHead>Expires</TableHead>
                        <TableHead className="text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredPats.map((pat) => (
                        <TableRow key={pat.name}>
                          <TableCell>
                            <div className="font-medium">{pat.name}</div>
                            <div className="text-sm text-muted-foreground">
                              {pat.note || "No note provided"}
                            </div>
                          </TableCell>
                          <TableCell className="font-mono text-sm">
                            {pat.prefix || "-"}
                          </TableCell>
                          <TableCell>
                            <Badge
                              variant={
                                pat.enabled
                                  ? isPatExpiringSoon(pat)
                                    ? "warning"
                                    : "success"
                                  : "outline"
                              }
                            >
                              {pat.enabled
                                ? isPatExpiringSoon(pat)
                                  ? "Expiring"
                                  : "Active"
                                : "Disabled"}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-muted-foreground">
                            {formatDate(pat.createdAt)}
                          </TableCell>
                          <TableCell className="text-muted-foreground">
                            {formatDate(pat.lastUsedAt)}
                          </TableCell>
                          <TableCell className="text-muted-foreground">
                            {pat.expiresAt ? formatDate(pat.expiresAt) : "Never"}
                          </TableCell>
                          <TableCell>
                            <div className="flex justify-end gap-2">
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => handleRevealPat(pat)}
                              >
                                Reveal
                              </Button>
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => handleTogglePat(pat)}
                              >
                                {pat.enabled ? "Disable" : "Enable"}
                              </Button>
                              <Button
                                variant="destructive"
                                size="sm"
                                onClick={() => handleDeletePat(pat)}
                              >
                                Delete
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </>
              ) : (
                <EmptyState
                  title="No PATs match"
                  description="Clear or widen the filters to bring tokens back into view."
                />
              )
            ) : (
              <EmptyState
                title="No PATs created yet"
                description="Create one to authenticate clients against the admin surface."
              />
            )}
          </CardContent>
        </Card>

        <div className="space-y-6">
          <Card>
            <CardHeader className="space-y-2">
              <Badge variant="outline" className="w-fit">
                Rotation radar
              </Badge>
              <CardTitle>Risky tokens</CardTitle>
              <CardDescription>
                把近期到期令牌单独提取出来，减少在主表中滚动查找。
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {expiringPats.length ? (
                expiringPats.slice(0, 4).map((pat) => (
                  <Card key={pat.name} className="border-amber-200 bg-amber-50 shadow-none">
                    <CardContent className="flex items-start justify-between gap-3 p-4">
                      <div>
                        <p className="font-medium">{pat.name}</p>
                        <p className="mt-1 text-sm text-muted-foreground">
                          Expires {formatDate(pat.expiresAt)}
                        </p>
                      </div>
                      <Badge variant="warning">Rotate</Badge>
                    </CardContent>
                  </Card>
                ))
              ) : (
                <Card className="border-emerald-200 bg-emerald-50 shadow-none">
                  <CardContent className="p-4">
                    <p className="font-medium">No tokens expiring soon</p>
                    <p className="mt-1 text-sm leading-6 text-muted-foreground">
                      The current registry does not show any token expiring within 7 days.
                    </p>
                  </CardContent>
                </Card>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="space-y-2">
              <Badge variant="outline" className="w-fit">
                Handling notes
              </Badge>
              <CardTitle>Safer token operations</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm leading-6 text-muted-foreground">
              <Card className="bg-muted/30 shadow-none">
                <CardContent className="p-4">
                  Full tokens are only shown once, right after creation. Treat that reveal
                  event as a handoff point, not as a recoverable view.
                </CardContent>
              </Card>
              <Card className="bg-muted/30 shadow-none">
                <CardContent className="p-4">
                  Disable a token before deleting it if you need a controlled rollout or
                  want to observe whether any client still depends on it.
                </CardContent>
              </Card>
              <Card className="bg-muted/30 shadow-none">
                <CardContent className="p-4">
                  Keep notes specific. Good notes turn a token list into an ownership map.
                </CardContent>
              </Card>
            </CardContent>
          </Card>
        </div>
      </div>

      <CreatePatDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={async (name, token) => {
          setCreatedToken(token);
          setRevealedMessage(null);
          toast.success(`PAT "${name}" created`);
          await loadPats();
        }}
      />
    </div>
  );
}
