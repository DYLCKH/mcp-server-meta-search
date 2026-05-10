import { useEffect, useState } from "react";
import { LoaderCircle } from "lucide-react";
import { toast } from "sonner";

import { api, type ProviderKeyInput } from "@/lib/api";
import { extractErrorMessage } from "@/lib/admin";
import { StateAlert, Field } from "@/components/admin/primitives";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";

type CloudflareKeyInput = Extract<ProviderKeyInput, { account_id: string }>;

interface ParseResult<T> {
  items: T[];
  error: string;
}

function parseApiKeyImport(value: string): ParseResult<string> {
  const trimmed = value.trim();
  if (!trimmed) {
    return { items: [], error: "" };
  }

  if (trimmed.startsWith("[")) {
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      if (!Array.isArray(parsed) || parsed.some((item) => typeof item !== "string")) {
        return { items: [], error: "JSON import must be an array of strings." };
      }

      return {
        items: parsed.map((item) => item.trim()).filter(Boolean),
        error: "",
      };
    } catch {
      return { items: [], error: "JSON import is not valid." };
    }
  }

  return {
    items: trimmed
      .split(/[\n,;]+/)
      .map((item) => item.trim())
      .filter(Boolean),
    error: "",
  };
}

function parseCloudflareLine(line: string): CloudflareKeyInput | null {
  const commaIndex = line.indexOf(",");
  if (commaIndex >= 0) {
    const account_id = line.slice(0, commaIndex).trim();
    const api_token = line.slice(commaIndex + 1).trim();
    return account_id && api_token ? { account_id, api_token } : null;
  }

  const [account_id, api_token, ...rest] = line.split(/\s+/);
  if (!account_id || !api_token || rest.length > 0) {
    return null;
  }

  return { account_id, api_token };
}

function parseCloudflareImport(value: string): ParseResult<CloudflareKeyInput> {
  const trimmed = value.trim();
  if (!trimmed) {
    return { items: [], error: "" };
  }

  if (trimmed.startsWith("[")) {
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      if (
        !Array.isArray(parsed) ||
        parsed.some(
          (item) =>
            !item ||
            typeof item !== "object" ||
            typeof (item as CloudflareKeyInput).account_id !== "string" ||
            typeof (item as CloudflareKeyInput).api_token !== "string",
        )
      ) {
        return {
          items: [],
          error: "JSON import must be an array of Cloudflare credentials.",
        };
      }

      return {
        items: (parsed as CloudflareKeyInput[])
          .map((item) => ({
            account_id: item.account_id.trim(),
            api_token: item.api_token.trim(),
          }))
          .filter((item) => item.account_id && item.api_token),
        error: "",
      };
    } catch {
      return { items: [], error: "JSON import is not valid." };
    }
  }

  const lines = trimmed.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const items = lines.map(parseCloudflareLine);
  if (items.some((item) => !item)) {
    return {
      items: [],
      error: "Each Cloudflare line must contain an account ID and API token.",
    };
  }

  return { items: items as CloudflareKeyInput[], error: "" };
}

export function CreatePatDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (name: string, token: string) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [note, setNote] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (open) {
      return;
    }

    setName("");
    setNote("");
    setExpiresAt("");
    setSubmitting(false);
    setError("");
  }, [open]);

  const handleSubmit = async () => {
    if (!name.trim()) {
      setError("Name is required.");
      return;
    }

    setSubmitting(true);
    setError("");

    try {
      const response = await api.createPat({
        name: name.trim(),
        note: note.trim() || undefined,
        expiresAt: expiresAt ? new Date(expiresAt).toISOString() : undefined,
      });
      onOpenChange(false);
      await onCreated(name.trim(), response.token);
    } catch (requestError) {
      setError(extractErrorMessage(requestError));
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create PAT</DialogTitle>
          <DialogDescription className="sr-only">
            Create a new personal access token.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          {error ? (
            <StateAlert tone="error" title="Unable to create PAT" message={error} />
          ) : null}
          <Field
            label="Name"
            input={
              <Input
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="e.g. client-ingest"
                autoFocus
              />
            }
          />
          <Field
            label="Note"
            hint="Optional"
            input={
              <Input
                value={note}
                onChange={(event) => setNote(event.target.value)}
                placeholder="Describe where this token is used"
              />
            }
          />
          <Field
            label="Expiration"
            hint="Optional"
            input={
              <Input
                type="datetime-local"
                value={expiresAt}
                onChange={(event) => setExpiresAt(event.target.value)}
              />
            }
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={submitting}>
            {submitting ? (
              <>
                <LoaderCircle className="h-4 w-4 animate-spin" />
                Creating...
              </>
            ) : (
              "Create"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function AddKeyDialog({
  open,
  provider,
  onOpenChange,
  onAdded,
}: {
  open: boolean;
  provider: string;
  onOpenChange: (open: boolean) => void;
  onAdded: () => Promise<void>;
}) {
  const [apiKey, setApiKey] = useState("");
  const [accountId, setAccountId] = useState("");
  const [apiToken, setApiToken] = useState("");
  const [cloudflareImport, setCloudflareImport] = useState("");
  const [cloudflareMode, setCloudflareMode] = useState<"single" | "import">("single");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const isCloudflare = provider === "cloudflare";

  useEffect(() => {
    if (open) {
      return;
    }

    setApiKey("");
    setAccountId("");
    setApiToken("");
    setCloudflareImport("");
    setCloudflareMode("single");
    setSubmitting(false);
    setError("");
  }, [open]);

  const handleSubmit = async () => {
    if (!provider) {
      return;
    }

    let keys: ProviderKeyInput[];

    if (isCloudflare && cloudflareMode === "single") {
      if (!accountId.trim()) {
        setError("Account ID is required.");
        return;
      }

      if (!apiToken.trim()) {
        setError("API token is required.");
        return;
      }

      keys = [{
        account_id: accountId.trim(),
        api_token: apiToken.trim(),
      }];
    } else if (isCloudflare) {
      const parsed = parseCloudflareImport(cloudflareImport);
      if (parsed.error) {
        setError(parsed.error);
        return;
      }

      if (parsed.items.length === 0) {
        setError("At least one Cloudflare credential is required.");
        return;
      }

      keys = parsed.items;
    } else {
      const parsed = parseApiKeyImport(apiKey);
      if (parsed.error) {
        setError(parsed.error);
        return;
      }

      if (parsed.items.length === 0) {
        setError("API key is required.");
        return;
      }

      keys = parsed.items;
    }

    setSubmitting(true);
    setError("");

    try {
      const response = await api.addKeys(provider, keys);
      const added = response.added ?? keys.length;
      toast.success(
        added === 1 ? `${provider} key added` : `${added} ${provider} keys added`,
      );
      onOpenChange(false);
      await onAdded();
    } catch (requestError) {
      setError(extractErrorMessage(requestError));
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="capitalize">Add {provider || "provider"} key</DialogTitle>
          <DialogDescription className="sr-only">
            Add a new credential for {provider || "provider"}.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          {error ? (
            <StateAlert tone="error" title="Unable to add key" message={error} />
          ) : null}
          {isCloudflare ? (
            <Tabs
              value={cloudflareMode}
              onValueChange={(value) =>
                setCloudflareMode(value === "import" ? "import" : "single")
              }
            >
              <TabsList>
                <TabsTrigger value="single">Single</TabsTrigger>
                <TabsTrigger value="import">Import</TabsTrigger>
              </TabsList>
              <TabsContent value="single" className="space-y-4">
                <Field
                  label="Account ID"
                  input={
                    <Input
                      value={accountId}
                      onChange={(event) => setAccountId(event.target.value)}
                      placeholder="Enter Cloudflare account ID"
                      autoFocus
                    />
                  }
                />
                <Field
                  label="API token"
                  input={
                    <Input
                      value={apiToken}
                      onChange={(event) => setApiToken(event.target.value)}
                      placeholder="Enter Cloudflare API token"
                    />
                  }
                />
              </TabsContent>
              <TabsContent value="import">
                <Field
                  label="Credentials"
                  hint="CSV or JSON"
                  input={
                    <Textarea
                      value={cloudflareImport}
                      onChange={(event) => setCloudflareImport(event.target.value)}
                      placeholder={"account-id, api-token\naccount-id-2, api-token-2"}
                      autoFocus
                      className="min-h-32 font-mono text-sm"
                    />
                  }
                />
              </TabsContent>
            </Tabs>
          ) : (
            <Field
              label="API keys"
              hint="Lines, commas, or JSON"
              input={
                <Textarea
                  value={apiKey}
                  onChange={(event) => setApiKey(event.target.value)}
                  placeholder={"provider-key-1\nprovider-key-2"}
                  autoFocus
                  className="min-h-32 font-mono text-sm"
                />
              }
            />
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={submitting}>
            {submitting ? (
              <>
                <LoaderCircle className="h-4 w-4 animate-spin" />
                Adding...
              </>
            ) : (
              "Add keys"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
