import { type ReactNode, useEffect, useState } from "react";
import { RefreshCcw } from "lucide-react";
import { toast } from "sonner";

import { type SettingsData, api } from "@/lib/api";
import { extractErrorMessage, FIELD_META } from "@/lib/admin";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatStrategy } from "@/lib/format";

export function SettingsPage() {
  const [initialSettings, setInitialSettings] = useState<SettingsData | null>(null);
  const [form, setForm] = useState<SettingsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [savedMessage, setSavedMessage] = useState("");

  useEffect(() => {
    let active = true;

    void (async () => {
      try {
        const response = await api.getSettings();
        if (!active) {
          return;
        }

        setInitialSettings(response);
        setForm(response);
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

  const hasChanges =
    initialSettings && form
      ? JSON.stringify(initialSettings) !== JSON.stringify(form)
      : false;
  const changedFields =
    initialSettings && form
      ? (Object.keys(form) as Array<keyof SettingsData>).filter(
          (key) => form[key] !== initialSettings[key],
        )
      : [];

  const handleSave = async () => {
    if (!form) {
      return;
    }

    setSaving(true);
    setError("");
    setSavedMessage("");

    try {
      const response = await api.saveSettings(form);
      setInitialSettings(response.settings);
      setForm(response.settings);
      setSavedMessage("Applied");
      toast.success("Settings saved");
    } catch (requestError) {
      setError(extractErrorMessage(requestError));
    } finally {
      setSaving(false);
    }
  };

  const handleReset = () => {
    if (!initialSettings) {
      return;
    }

    setForm(initialSettings);
    setSavedMessage("");
    setError("");
  };

  return (
    <div className="space-y-4">
      <PageHeader
        badge="Policy"
        title="Runtime"
        actions={
          <>
            <Button
              variant="outline"
              size="sm"
              onClick={handleReset}
              disabled={!hasChanges || saving}
            >
              <RefreshCcw className="h-4 w-4" />
              Revert
            </Button>
            <Button size="sm" onClick={handleSave} disabled={!hasChanges || saving || !form}>
              {saving ? "Saving..." : "Save"}
            </Button>
          </>
        }
        stats={
          <SummaryStats
            items={[
              {
                label: "Rotation",
                value: loading || !form ? "..." : formatStrategy(form.key_rotation_strategy),
              },
              {
                label: "Timeout",
                value: loading || !form ? "..." : `${form.request_timeout_ms}ms`,
              },
              {
                label: "Retries",
                value: loading || !form ? "..." : String(form.max_attempts_per_request),
              },
              {
                label: "Pending edits",
                value: String(changedFields.length),
              },
            ]}
            columns={4}
          />
        }
      />

      {error ? (
        <StateAlert tone="error" title="Failed to save settings" message={error} />
      ) : null}

      {savedMessage ? (
        <StateAlert tone="success" title="Policy updated" message={savedMessage} />
      ) : null}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_280px]">
        <div className="space-y-4">
          <Card>
            <CardHeader className="gap-2 border-b bg-muted/20 p-3">
              <div className="flex items-center gap-2">
                <Badge variant="secondary">Traffic</Badge>
                <CardTitle className="text-sm">Routing</CardTitle>
              </div>
            </CardHeader>
            <CardContent className="p-3">
              {loading || !form ? (
                <LoadingState label="Loading settings" compact />
              ) : (
                <div className="grid gap-3 xl:grid-cols-3">
                  <SettingsFieldShell
                    id="key_rotation_strategy"
                    label={FIELD_META.key_rotation_strategy.label}
                    input={
                      <Select
                        value={form.key_rotation_strategy}
                        onValueChange={(value: SettingsData["key_rotation_strategy"]) =>
                          setForm({ ...form, key_rotation_strategy: value })
                        }
                      >
                        <SelectTrigger id="key_rotation_strategy">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="round_robin">Round robin</SelectItem>
                          <SelectItem value="random">Random</SelectItem>
                        </SelectContent>
                      </Select>
                    }
                  />
                  <SettingsNumberField
                    id="max_attempts_per_request"
                    label={FIELD_META.max_attempts_per_request.label}
                    value={form.max_attempts_per_request}
                    onChange={(value) =>
                      setForm({ ...form, max_attempts_per_request: value })
                    }
                  />
                  <SettingsNumberField
                    id="request_timeout_ms"
                    label={FIELD_META.request_timeout_ms.label}
                    value={form.request_timeout_ms}
                    onChange={(value) => setForm({ ...form, request_timeout_ms: value })}
                  />
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="gap-2 border-b bg-muted/20 p-3">
              <div className="flex items-center gap-2">
                <Badge variant="secondary">Lifecycle</Badge>
                <CardTitle className="text-sm">Keys</CardTitle>
              </div>
            </CardHeader>
            <CardContent className="p-3">
              {loading || !form ? (
                <LoadingState label="Loading settings" compact />
              ) : (
                <div className="grid gap-3 xl:grid-cols-2">
                  <SettingsNumberField
                    id="key_recovery_interval_ms"
                    label={FIELD_META.key_recovery_interval_ms.label}
                    value={form.key_recovery_interval_ms}
                    onChange={(value) =>
                      setForm({ ...form, key_recovery_interval_ms: value })
                    }
                  />
                  <SettingsNumberField
                    id="max_disable_before_revoke"
                    label={FIELD_META.max_disable_before_revoke.label}
                    value={form.max_disable_before_revoke}
                    onChange={(value) =>
                      setForm({ ...form, max_disable_before_revoke: value })
                    }
                  />
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-4 xl:sticky xl:top-20 xl:h-fit">
          <Card>
            <CardHeader className="gap-2 border-b bg-muted/20 p-3">
              <div className="flex items-center gap-2">
                <Badge variant="secondary">Diff</Badge>
                <CardTitle className="text-sm">
                  {changedFields.length ? `${changedFields.length} pending` : "Clean"}
                </CardTitle>
              </div>
            </CardHeader>
            <CardContent className="p-3">
              {changedFields.length ? (
                <div className="space-y-1.5">
                  {changedFields.map((field) => (
                    <div
                      key={field}
                      className="rounded-md border border-primary/20 bg-primary/5 px-3 py-2 text-sm font-medium"
                    >
                      {FIELD_META[field].label}
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">No pending edits</p>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

function SettingsNumberField({
  id,
  label,
  value,
  onChange,
}: {
  id: string;
  label: string;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <SettingsFieldShell
      id={id}
      label={label}
      input={
        <Input
          id={id}
          type="number"
          value={value}
          onChange={(event) => onChange(Number(event.target.value || 0))}
        />
      }
    />
  );
}

function SettingsFieldShell({
  id,
  label,
  input,
}: {
  id: string;
  label: string;
  input: ReactNode;
}) {
  return (
    <div className="space-y-1.5 rounded-md border bg-background p-3">
      <Label htmlFor={id} className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </Label>
      {input}
    </div>
  );
}
