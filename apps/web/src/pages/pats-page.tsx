import { useEffect, useState } from "react";
import { Copy, Filter, Plus } from "lucide-react";
import { toast } from "sonner";

import { type PatRecord, api } from "@/lib/api";
import { copyToClipboard, extractErrorMessage, isPatExpiringSoon } from "@/lib/admin";
import { CreatePatDialog } from "@/components/admin/dialogs";
import {
  EmptyState,
  LoadingState,
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
    <div className="space-y-4">
      <PageHeader
        badge="PATs"
        title="Tokens"
        actions={
          <>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setPatQuery("");
                setPatScope("all");
              }}
              disabled={!patQuery && patScope === "all"}
            >
              <Filter className="h-4 w-4" />
              Reset
            </Button>
            <Button size="sm" onClick={() => setCreateOpen(true)}>
              <Plus className="h-4 w-4" />
              Create
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
        <Card className="border-emerald-200 bg-emerald-50 dark:border-emerald-900 dark:bg-emerald-950/60">
          <CardContent className="flex flex-col gap-3 p-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex items-center gap-2 min-w-0 flex-1">
              <Badge variant="success">Copy now</Badge>
              <code className="overflow-x-auto rounded-md border bg-background px-3 py-2 font-mono text-sm">
                {createdToken}
              </code>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={async () => {
                if (!createdToken) {
                  return;
                }

                await copyToClipboard(createdToken);
              }}
            >
              <Copy className="h-4 w-4" />
              Copy
            </Button>
          </CardContent>
        </Card>
      ) : null}

      {revealedMessage ? (
        <StateAlert tone="warning" title="Reveal unavailable" message={revealedMessage} />
      ) : null}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_300px]">
        <Card>
          <CardHeader className="gap-2 border-b bg-muted/20 p-3 md:flex-row md:items-center md:justify-between">
            <div className="flex items-center gap-2">
              <Badge variant="secondary">Registry</Badge>
              <CardTitle className="text-sm">Tokens</CardTitle>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant="outline">{filteredPats.length} visible</Badge>
              <Badge variant="outline">{expiringPats.length} expiring</Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-3 p-3">
            <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto]">
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
                            {pat.note ? (
                              <div className="text-sm text-muted-foreground">
                                {pat.note}
                              </div>
                            ) : null}
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
              ) : (
                <EmptyState title="No matches" />
              )
            ) : (
              <EmptyState title="No PATs" />
            )}
          </CardContent>
        </Card>

        <div className="space-y-3">
          <Card>
            <CardHeader className="gap-2 border-b bg-muted/20 p-3">
              <div className="flex items-center gap-2">
                <Badge variant="secondary">Expiring</Badge>
                <CardTitle className="text-sm">Rotate soon</CardTitle>
              </div>
            </CardHeader>
            <CardContent className="space-y-2 p-3">
              {expiringPats.length ? (
                expiringPats.slice(0, 4).map((pat) => (
                  <div
                    key={pat.name}
                    className="flex items-center justify-between gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 dark:border-amber-900 dark:bg-amber-950/60"
                  >
                    <div className="min-w-0">
                      <p className="truncate font-medium text-sm">{pat.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {formatDate(pat.expiresAt)}
                      </p>
                    </div>
                    <Badge variant="warning">Rotate</Badge>
                  </div>
                ))
              ) : (
                <p className="text-sm text-muted-foreground">None within 7d</p>
              )}
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
