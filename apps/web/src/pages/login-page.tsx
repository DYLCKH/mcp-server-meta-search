import { type FormEvent, useState } from "react";
import { toast } from "sonner";

import { api } from "@/lib/api";
import { extractErrorMessage } from "@/lib/admin";
import { StateAlert } from "@/components/admin/primitives";
import { ThemeToggle } from "@/components/admin/theme-toggle";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function LoginPage({ onSuccess }: { onSuccess: () => void }) {
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitting(true);
    setError("");

    try {
      await api.login(password);
      toast.success("Authenticated");
      onSuccess();
    } catch (submitError) {
      setError(extractErrorMessage(submitError));
      setSubmitting(false);
    }
  };

  return (
    <div className="relative flex min-h-screen items-center justify-center px-4 py-8">
      <div className="absolute right-4 top-4">
        <ThemeToggle />
      </div>
      <div className="flex w-full max-w-sm flex-col items-center gap-8">
        <h1 className="text-3xl font-semibold tracking-tight">Meta Search</h1>
        <Card className="w-full border-border/80 bg-card/95">
          <CardContent className="p-6">
            <form className="space-y-4" onSubmit={handleSubmit}>
              {error ? (
                <StateAlert
                  tone="error"
                  title="Authentication failed"
                  message={error}
                />
              ) : null}
              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  type="password"
                  placeholder="Enter admin password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  required
                  autoFocus
                />
              </div>
              <Button className="w-full" type="submit" disabled={submitting}>
                {submitting ? "Signing in..." : "Sign in"}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
