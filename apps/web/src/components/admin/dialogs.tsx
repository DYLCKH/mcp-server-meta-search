import { useEffect, useState } from "react";
import { LoaderCircle } from "lucide-react";
import { toast } from "sonner";

import { api } from "@/lib/api";
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
import { Textarea } from "@/components/ui/textarea";

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
    setSubmitting(false);
    setError("");
  }, [open]);

  const handleSubmit = async () => {
    if (!provider) {
      return;
    }

    if (isCloudflare) {
      if (!accountId.trim()) {
        setError("Account ID is required.");
        return;
      }

      if (!apiToken.trim()) {
        setError("API token is required.");
        return;
      }
    } else if (!apiKey.trim()) {
      setError("API key is required.");
      return;
    }

    setSubmitting(true);
    setError("");

    try {
      await api.addKey(
        provider,
        isCloudflare
          ? {
              account_id: accountId.trim(),
              api_token: apiToken.trim(),
            }
          : apiKey.trim(),
      );
      toast.success(`${provider} key added`);
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
            <>
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
            </>
          ) : (
            <Field
              label="API key"
              input={
                <Textarea
                  value={apiKey}
                  onChange={(event) => setApiKey(event.target.value)}
                  placeholder="Paste provider API key"
                  autoFocus
                  className="font-mono text-sm"
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
              "Add key"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
