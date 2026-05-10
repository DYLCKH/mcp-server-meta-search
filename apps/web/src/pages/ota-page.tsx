import { useEffect, useState } from "react";
import {
  Clipboard,
  CloudDownload,
  Power,
  RefreshCcw,
  RotateCcw,
} from "lucide-react";
import { toast } from "sonner";

import { type OtaStatus, api } from "@/lib/api";
import { copyToClipboard, extractErrorMessage } from "@/lib/admin";
import {
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
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

export function OtaPage() {
  const [status, setStatus] = useState<OtaStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [checking, setChecking] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [restart, setRestart] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    let active = true;

    void (async () => {
      try {
        const response = await api.getOtaStatus();
        if (!active) return;
        setStatus(response);
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

  const handleCheck = async () => {
    setChecking(true);
    setError("");
    setMessage("");

    try {
      const response = await api.checkOta();
      setStatus(response);
      setMessage(
        response.updateAvailable
          ? "Update available"
          : response.updateAvailable === false
            ? "Current binary is up to date"
            : "Remote version file was not found",
      );
      toast.success("OTA check complete");
    } catch (requestError) {
      setError(extractErrorMessage(requestError));
    } finally {
      setChecking(false);
    }
  };

  const handleUpdate = async (force: boolean) => {
    setUpdating(true);
    setError("");
    setMessage("");

    try {
      const response = await api.updateOta({ force, restart });
      setStatus(response);
      setMessage(
        response.updated
          ? response.restartScheduled
            ? "Update installed; restart scheduled"
            : "Update installed"
          : "No update installed",
      );
      toast.success(response.updated ? "OTA update installed" : "Already up to date");
    } catch (requestError) {
      setError(extractErrorMessage(requestError));
    } finally {
      setUpdating(false);
    }
  };

  if (loading) {
    return <LoadingState label="Loading OTA status" />;
  }

  if (!status) {
    return (
      <StateAlert
        tone="error"
        title="Failed to load OTA"
        message={error || "No OTA payload returned."}
      />
    );
  }

  const canUpdate = status.enabled && status.updateSupported;
  const updateDisabled =
    !canUpdate ||
    updating ||
    checking ||
    status.updateAvailable === false ||
    status.updateAvailable === null ||
    status.updateAvailable === undefined;

  return (
    <div className="space-y-4">
      <PageHeader
        badge="Update"
        title="OTA"
        actions={
          <>
            <Button
              variant="outline"
              size="sm"
              onClick={handleCheck}
              disabled={checking || updating}
            >
              <RefreshCcw className={cn("h-4 w-4", checking && "animate-spin")} />
              {checking ? "Checking..." : "Check"}
            </Button>
            <Button
              size="sm"
              onClick={() => void handleUpdate(false)}
              disabled={updateDisabled}
            >
              <CloudDownload className="h-4 w-4" />
              {updating ? "Installing..." : "Install"}
            </Button>
          </>
        }
        stats={
          <SummaryStats
            columns={4}
            items={[
              {
                label: "OTA",
                value: status.enabled ? "Enabled" : "Disabled",
              },
              {
                label: "Local",
                value: displayVersion(status.currentVersion),
              },
              {
                label: "Remote",
                value: displayVersion(status.remoteVersion),
              },
              {
                label: "Restart",
                value: status.restartStrategy,
              },
            ]}
          />
        }
      />

      {error ? (
        <StateAlert tone="error" title="OTA request failed" message={error} />
      ) : null}

      {message ? (
        <StateAlert
          tone={
            status.updateAvailable || status.updateAvailable === null
              ? "warning"
              : "success"
          }
          title="OTA status"
          message={message}
        />
      ) : null}

      {!status.updateSupported ? (
        <StateAlert
          tone="warning"
          title="Update target is not writable"
          message={status.unsupportedReason || "Set ota.binary_path before installing updates."}
        />
      ) : null}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
        <Card>
          <CardHeader className="gap-2 border-b bg-muted/20 p-3 md:flex-row md:items-center md:justify-between">
            <div className="flex items-center gap-2">
              <Badge variant="secondary">Release</Badge>
              <CardTitle className="text-sm">Target</CardTitle>
            </div>
            <StatusBadge status={status} />
          </CardHeader>
          <CardContent className="grid gap-3 p-3 lg:grid-cols-2">
            <InfoRow label="Repository" value={status.repository} />
            <InfoRow label="Tag" value={status.tag} />
            <InfoRow label="Asset" value={status.assetName} />
            <InfoRow label="Version asset" value={status.versionUrl} copy />
            <InfoRow label="Binary path" value={status.binaryPath} copy wide />
            <InfoRow label="Version file" value={status.versionFile} copy wide />
          </CardContent>
        </Card>

        <div className="space-y-4 xl:sticky xl:top-20 xl:h-fit">
          <Card>
            <CardHeader className="gap-2 border-b bg-muted/20 p-3">
              <div className="flex items-center gap-2">
                <Badge variant="secondary">Install</Badge>
                <CardTitle className="text-sm">Controls</CardTitle>
              </div>
            </CardHeader>
            <CardContent className="space-y-3 p-3">
              <label className="flex items-start gap-3 rounded-md border bg-background p-3">
                <input
                  type="checkbox"
                  checked={restart}
                  onChange={(event) => setRestart(event.target.checked)}
                  className="mt-1 h-4 w-4 accent-primary"
                />
                <span className="min-w-0">
                  <span className="block text-sm font-medium">Restart after install</span>
                  <span className="block text-xs leading-5 text-muted-foreground">
                    {status.restartStrategy === "self"
                      ? "Starts the updated binary after this process exits."
                      : "Exits after install so the supervisor can restart it."}
                  </span>
                </span>
              </label>

              <div className="grid gap-2">
                <Button
                  onClick={() => void handleUpdate(false)}
                  disabled={updateDisabled}
                  className="w-full"
                >
                  <Power className="h-4 w-4" />
                  Install update
                </Button>
                <Button
                  variant="outline"
                  onClick={() => void handleUpdate(true)}
                  disabled={!canUpdate || updating || checking}
                  className="w-full"
                >
                  <RotateCcw className="h-4 w-4" />
                  Force install
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: OtaStatus }) {
  if (!status.enabled) {
    return <Badge variant="outline">Disabled</Badge>;
  }

  if (!status.updateSupported) {
    return <Badge variant="warning">Needs path</Badge>;
  }

  if (status.updateAvailable) {
    return <Badge variant="warning">Update available</Badge>;
  }

  if (status.updateAvailable === false) {
    return <Badge variant="success">Current</Badge>;
  }

  return <Badge variant="secondary">Ready</Badge>;
}

function InfoRow({
  label,
  value,
  copy = false,
  wide = false,
}: {
  label: string;
  value: string | null | undefined;
  copy?: boolean;
  wide?: boolean;
}) {
  const display = value || "-";

  return (
    <div className={cn("rounded-md border bg-background p-3", wide && "lg:col-span-2")}>
      <div className="mb-1.5 flex items-center justify-between gap-3">
        <Label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {label}
        </Label>
        {copy && value ? (
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={() => void copyToClipboard(value)}
          >
            <Clipboard className="h-3.5 w-3.5" />
            <span className="sr-only">Copy {label}</span>
          </Button>
        ) : null}
      </div>
      <p className="break-all font-mono text-xs leading-5 text-foreground">{display}</p>
    </div>
  );
}

function displayVersion(value: string | null | undefined) {
  return value || "-";
}
