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
      setSavedMessage("Settings saved and applied immediately.");
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
        badge="Runtime policy"
        title="运行时策略编辑台"
        description="直接修改超时、重试与 key 生命周期参数，保存后立即生效。"
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
              {saving ? "Saving..." : "Save changes"}
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

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_300px]">
        <div className="space-y-4">
          <Card>
            <CardHeader className="gap-3 border-b bg-muted/20">
              <Badge variant="secondary" className="w-fit">
                Traffic orchestration
              </Badge>
              <div className="space-y-1">
                <CardTitle>How requests move through the fleet</CardTitle>
                <CardDescription>
                  这些设置决定 key 选择策略、请求耐心和重试压力。
                </CardDescription>
              </div>
            </CardHeader>
            <CardContent className="p-4">
              {loading || !form ? (
                <LoadingState label="Loading settings" compact />
              ) : (
                <div className="grid gap-3 xl:grid-cols-3">
                  <SettingsFieldShell
                    id="key_rotation_strategy"
                    label={FIELD_META.key_rotation_strategy.label}
                    description={FIELD_META.key_rotation_strategy.description}
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
                    description={FIELD_META.max_attempts_per_request.description}
                    value={form.max_attempts_per_request}
                    onChange={(value) =>
                      setForm({ ...form, max_attempts_per_request: value })
                    }
                  />
                  <SettingsNumberField
                    id="request_timeout_ms"
                    label={FIELD_META.request_timeout_ms.label}
                    description={FIELD_META.request_timeout_ms.description}
                    value={form.request_timeout_ms}
                    onChange={(value) => setForm({ ...form, request_timeout_ms: value })}
                  />
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="gap-3 border-b bg-muted/20">
              <Badge variant="secondary" className="w-fit">
                Key lifecycle
              </Badge>
              <div className="space-y-1">
                <CardTitle>How damaged credentials recover or fail out</CardTitle>
                <CardDescription>
                  这里控制 key 被隔离多久，以及何时被视为不可恢复。
                </CardDescription>
              </div>
            </CardHeader>
            <CardContent className="p-4">
              {loading || !form ? (
                <LoadingState label="Loading settings" compact />
              ) : (
                <div className="grid gap-3 xl:grid-cols-2">
                  <SettingsNumberField
                    id="key_recovery_interval_ms"
                    label={FIELD_META.key_recovery_interval_ms.label}
                    description={FIELD_META.key_recovery_interval_ms.description}
                    value={form.key_recovery_interval_ms}
                    onChange={(value) =>
                      setForm({ ...form, key_recovery_interval_ms: value })
                    }
                  />
                  <SettingsNumberField
                    id="max_disable_before_revoke"
                    label={FIELD_META.max_disable_before_revoke.label}
                    description={FIELD_META.max_disable_before_revoke.description}
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

        <div className="space-y-4 xl:sticky xl:top-24 xl:h-fit">
          <Card>
            <CardHeader className="gap-3 border-b bg-muted/20">
              <Badge variant="secondary" className="w-fit">
                Change summary
              </Badge>
              <CardTitle>{changedFields.length ? "Pending edits" : "No unsaved changes"}</CardTitle>
            </CardHeader>
            <CardContent className="p-4">
              {changedFields.length ? (
                <div className="space-y-2">
                  {changedFields.map((field) => (
                    <div
                      key={field}
                      className="rounded-lg border border-primary/20 bg-primary/5 px-3 py-3"
                    >
                      <p className="font-medium">{FIELD_META[field].label}</p>
                      <p className="mt-1 text-sm leading-6 text-muted-foreground">
                        {FIELD_META[field].description}
                      </p>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-3 dark:border-emerald-900 dark:bg-emerald-950/60">
                  <p className="font-medium">Policy matches runtime</p>
                  <p className="mt-1 text-sm leading-6 text-muted-foreground">
                    The form is aligned with the latest values loaded from the server.
                  </p>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="gap-3 border-b bg-muted/20">
              <Badge variant="secondary" className="w-fit">
                Operator notes
              </Badge>
              <CardTitle>Safer change patterns</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 p-4 text-sm leading-6 text-muted-foreground">
              <div className="rounded-md border bg-muted/30 px-3 py-2">
                Increase timeout and retries together only when upstream latency is the problem. Raising one without the other usually just shifts failure modes.
              </div>
              <div className="rounded-md border bg-muted/30 px-3 py-2">
                Short recovery intervals can oscillate degraded keys back into rotation too early. Use them only when instability is transient.
              </div>
              <div className="rounded-md border bg-muted/30 px-3 py-2">
                Lower revoke thresholds make the system more conservative, but they also require faster key replacement discipline.
              </div>
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
  description,
  value,
  onChange,
}: {
  id: string;
  label: string;
  description: string;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <SettingsFieldShell
      id={id}
      label={label}
      description={description}
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
  description,
  input,
}: {
  id: string;
  label: string;
  description: string;
  input: ReactNode;
}) {
  return (
    <div className="space-y-3 rounded-lg border bg-background p-4 shadow-sm">
      <Label htmlFor={id}>{label}</Label>
      {input}
      <p className="text-sm leading-6 text-muted-foreground">{description}</p>
    </div>
  );
}
