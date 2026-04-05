import { type ReactNode, useEffect, useState } from "react";
import { Search } from "lucide-react";

import {
  type AuditLog,
  type PaginatedResponse,
  type RequestLog,
  api,
} from "@/lib/api";
import {
  EMPTY_AUDIT_FILTERS,
  EMPTY_REQUEST_FILTERS,
  PAGE_SIZE,
  type AuditLogFilters,
  type RequestLogFilters,
  extractErrorMessage,
  statusVariant,
} from "@/lib/admin";
import {
  EmptyState,
  LoadingState,
  PageHeader,
  PaginationBar,
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
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatDate, formatDuration } from "@/lib/format";

export function LogsPage() {
  const [activeTab, setActiveTab] = useState<"requests" | "audit">("requests");
  const [requestDraft, setRequestDraft] = useState<RequestLogFilters>(
    EMPTY_REQUEST_FILTERS,
  );
  const [requestFilters, setRequestFilters] = useState<RequestLogFilters>(
    EMPTY_REQUEST_FILTERS,
  );
  const [auditDraft, setAuditDraft] = useState<AuditLogFilters>(
    EMPTY_AUDIT_FILTERS,
  );
  const [auditFilters, setAuditFilters] = useState<AuditLogFilters>(
    EMPTY_AUDIT_FILTERS,
  );
  const [requestPage, setRequestPage] = useState(0);
  const [auditPage, setAuditPage] = useState(0);
  const [requestData, setRequestData] =
    useState<PaginatedResponse<RequestLog> | null>(null);
  const [auditData, setAuditData] =
    useState<PaginatedResponse<AuditLog> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    setLoading(true);

    void (async () => {
      try {
        if (activeTab === "requests") {
          const response = await api.getRequestLogs({
            tool: requestFilters.tool,
            provider: requestFilters.provider,
            status: requestFilters.status,
            from: requestFilters.from
              ? new Date(requestFilters.from).toISOString()
              : undefined,
            to: requestFilters.to ? new Date(requestFilters.to).toISOString() : undefined,
            limit: PAGE_SIZE,
            offset: requestPage * PAGE_SIZE,
          });

          if (!active) {
            return;
          }

          setRequestData(response);
        } else {
          const response = await api.getAuditLogs({
            action: auditFilters.action,
            target: auditFilters.target,
            from: auditFilters.from ? new Date(auditFilters.from).toISOString() : undefined,
            to: auditFilters.to ? new Date(auditFilters.to).toISOString() : undefined,
            limit: PAGE_SIZE,
            offset: auditPage * PAGE_SIZE,
          });

          if (!active) {
            return;
          }

          setAuditData(response);
        }

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
  }, [activeTab, auditFilters, auditPage, requestFilters, requestPage]);

  const currentRequestData = requestData?.logs ?? [];
  const currentAuditData = auditData?.logs ?? [];

  return (
    <div className="space-y-4">
      <PageHeader
        badge="Observability"
        title="请求与审计日志工作台"
        description="在同一视图里切换 request log 和 audit log，直接按时间、状态和目标缩小排查范围。"
        stats={
          <SummaryStats
            items={[
              {
                label: "Request rows",
                value: requestData ? String(requestData.logs.length) : "...",
              },
              {
                label: "Audit rows",
                value: auditData ? String(auditData.logs.length) : "...",
              },
              {
                label: "Page size",
                value: String(PAGE_SIZE),
              },
            ]}
          />
        }
      />

      <Card>
        <CardHeader className="gap-4 border-b bg-muted/20 md:flex-row md:items-start md:justify-between">
          <div className="space-y-1.5">
            <Badge variant="secondary" className="w-fit">
              Filters
            </Badge>
            <CardTitle>Slice the event stream</CardTitle>
            <CardDescription>
              不再依赖数据库查询，直接在界面里切换数据流并应用服务端分页。
            </CardDescription>
          </div>
          <Badge variant="outline">Server-backed pagination</Badge>
        </CardHeader>
        <CardContent className="space-y-4 p-4">
          <Tabs
            value={activeTab}
            onValueChange={(value) => setActiveTab(value as "requests" | "audit")}
          >
            <TabsList>
              <TabsTrigger value="requests">Request logs</TabsTrigger>
              <TabsTrigger value="audit">Audit logs</TabsTrigger>
            </TabsList>

            <TabsContent value="requests">
              <form
                className="grid gap-3 lg:grid-cols-[repeat(5,minmax(0,1fr))_auto]"
                onSubmit={(event) => {
                  event.preventDefault();
                  setRequestFilters(requestDraft);
                  setRequestPage(0);
                }}
              >
                <FilterField
                  label="Tool"
                  input={
                    <Input
                      value={requestDraft.tool}
                      onChange={(event) =>
                        setRequestDraft({ ...requestDraft, tool: event.target.value })
                      }
                      placeholder="e.g. web.search"
                    />
                  }
                />
                <FilterField
                  label="Provider"
                  input={
                    <Input
                      value={requestDraft.provider}
                      onChange={(event) =>
                        setRequestDraft({ ...requestDraft, provider: event.target.value })
                      }
                      placeholder="e.g. exa"
                    />
                  }
                />
                <FilterField
                  label="Status"
                  input={
                    <Select
                      value={requestDraft.status || "all"}
                      onValueChange={(value) =>
                        setRequestDraft({
                          ...requestDraft,
                          status: value === "all" ? "" : value,
                        })
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All statuses</SelectItem>
                        <SelectItem value="success">Success</SelectItem>
                        <SelectItem value="error">Error</SelectItem>
                      </SelectContent>
                    </Select>
                  }
                />
                <FilterField
                  label="From"
                  input={
                    <Input
                      type="datetime-local"
                      value={requestDraft.from}
                      onChange={(event) =>
                        setRequestDraft({ ...requestDraft, from: event.target.value })
                      }
                    />
                  }
                />
                <FilterField
                  label="To"
                  input={
                    <Input
                      type="datetime-local"
                      value={requestDraft.to}
                      onChange={(event) =>
                        setRequestDraft({ ...requestDraft, to: event.target.value })
                      }
                    />
                  }
                />
                <div className="flex items-end gap-2">
                  <Button type="submit" size="sm">
                    <Search className="h-4 w-4" />
                    Apply
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setRequestDraft(EMPTY_REQUEST_FILTERS);
                      setRequestFilters(EMPTY_REQUEST_FILTERS);
                      setRequestPage(0);
                    }}
                  >
                    Reset
                  </Button>
                </div>
              </form>
            </TabsContent>

            <TabsContent value="audit">
              <form
                className="grid gap-3 lg:grid-cols-[repeat(4,minmax(0,1fr))_auto]"
                onSubmit={(event) => {
                  event.preventDefault();
                  setAuditFilters(auditDraft);
                  setAuditPage(0);
                }}
              >
                <FilterField
                  label="Action"
                  input={
                    <Input
                      value={auditDraft.action}
                      onChange={(event) =>
                        setAuditDraft({ ...auditDraft, action: event.target.value })
                      }
                      placeholder="e.g. create_pat"
                    />
                  }
                />
                <FilterField
                  label="Target"
                  input={
                    <Input
                      value={auditDraft.target}
                      onChange={(event) =>
                        setAuditDraft({ ...auditDraft, target: event.target.value })
                      }
                      placeholder="e.g. provider"
                    />
                  }
                />
                <FilterField
                  label="From"
                  input={
                    <Input
                      type="datetime-local"
                      value={auditDraft.from}
                      onChange={(event) =>
                        setAuditDraft({ ...auditDraft, from: event.target.value })
                      }
                    />
                  }
                />
                <FilterField
                  label="To"
                  input={
                    <Input
                      type="datetime-local"
                      value={auditDraft.to}
                      onChange={(event) =>
                        setAuditDraft({ ...auditDraft, to: event.target.value })
                      }
                    />
                  }
                />
                <div className="flex items-end gap-2">
                  <Button type="submit" size="sm">
                    <Search className="h-4 w-4" />
                    Apply
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setAuditDraft(EMPTY_AUDIT_FILTERS);
                      setAuditFilters(EMPTY_AUDIT_FILTERS);
                      setAuditPage(0);
                    }}
                  >
                    Reset
                  </Button>
                </div>
              </form>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      {error ? (
        <StateAlert tone="error" title="Failed to load logs" message={error} />
      ) : null}

      {activeTab === "requests" ? (
        <Card>
          <CardHeader className="gap-4 border-b bg-muted/20 md:flex-row md:items-start md:justify-between">
            <div className="space-y-1.5">
              <Badge variant="secondary" className="w-fit">
                Requests
              </Badge>
              <CardTitle>Latest provider traffic</CardTitle>
              <CardDescription>
                Showing {currentRequestData.length} entries from the current page.
              </CardDescription>
            </div>
            <Badge variant={requestData?.hasMore ? "success" : "outline"}>
              {requestData?.hasMore ? "More available" : "Newest page"}
            </Badge>
          </CardHeader>
          <CardContent className="space-y-3 p-4">
            {loading ? (
              <LoadingState label="Loading request logs" compact />
            ) : currentRequestData.length ? (
              <>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Timestamp</TableHead>
                      <TableHead>Tool</TableHead>
                      <TableHead>Provider</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Latency</TableHead>
                      <TableHead>Error</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {currentRequestData.map((log, index) => (
                      <TableRow key={`${log.createdAt ?? "request"}-${index}`}>
                        <TableCell className="font-mono text-sm">
                          {formatDate(log.createdAt)}
                        </TableCell>
                        <TableCell>{log.tool || "-"}</TableCell>
                        <TableCell>{log.provider || "-"}</TableCell>
                        <TableCell>
                          <Badge variant={statusVariant(log.status || "")}>
                            {log.status || "-"}
                          </Badge>
                        </TableCell>
                        <TableCell className="font-mono text-sm">
                          {formatDuration(log.latency)}
                        </TableCell>
                        <TableCell className="max-w-[20rem] truncate text-muted-foreground">
                          {log.error || "-"}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                <PaginationBar
                  page={requestPage}
                  count={currentRequestData.length}
                  hasMore={requestData?.hasMore ?? false}
                  onPrevious={() => setRequestPage((current) => Math.max(current - 1, 0))}
                  onNext={() => setRequestPage((current) => current + 1)}
                />
              </>
            ) : (
              <EmptyState
                title="No request logs found"
                description="Try widening the time range or removing a filter."
              />
            )}
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader className="gap-4 border-b bg-muted/20 md:flex-row md:items-start md:justify-between">
            <div className="space-y-1.5">
              <Badge variant="secondary" className="w-fit">
                Audit
              </Badge>
              <CardTitle>Latest admin actions</CardTitle>
              <CardDescription>
                Showing {currentAuditData.length} entries from the current page.
              </CardDescription>
            </div>
            <Badge variant={auditData?.hasMore ? "success" : "outline"}>
              {auditData?.hasMore ? "More available" : "Newest page"}
            </Badge>
          </CardHeader>
          <CardContent className="space-y-3 p-4">
            {loading ? (
              <LoadingState label="Loading audit logs" compact />
            ) : currentAuditData.length ? (
              <>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Timestamp</TableHead>
                      <TableHead>Action</TableHead>
                      <TableHead>Target</TableHead>
                      <TableHead>Details</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {currentAuditData.map((log, index) => (
                      <TableRow key={`${log.createdAt ?? "audit"}-${index}`}>
                        <TableCell className="font-mono text-sm">
                          {formatDate(log.createdAt)}
                        </TableCell>
                        <TableCell className="font-medium">{log.action || "-"}</TableCell>
                        <TableCell className="font-mono text-sm">
                          {log.target || "-"}
                        </TableCell>
                        <TableCell className="max-w-[26rem] truncate text-muted-foreground">
                          {log.detail || "-"}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                <PaginationBar
                  page={auditPage}
                  count={currentAuditData.length}
                  hasMore={auditData?.hasMore ?? false}
                  onPrevious={() => setAuditPage((current) => Math.max(current - 1, 0))}
                  onNext={() => setAuditPage((current) => current + 1)}
                />
              </>
            ) : (
              <EmptyState
                title="No audit logs found"
                description="Try widening the time range or removing a filter."
              />
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function FilterField({
  label,
  input,
}: {
  label: string;
  input: ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs font-medium text-muted-foreground">{label}</Label>
      {input}
    </div>
  );
}
