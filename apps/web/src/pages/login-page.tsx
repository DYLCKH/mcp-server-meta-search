import { type FormEvent, type ReactNode, useState } from "react";
import { KeyRound, Logs, ShieldCheck } from "lucide-react";
import { toast } from "sonner";

import { api } from "@/lib/api";
import { extractErrorMessage } from "@/lib/admin";
import { StateAlert } from "@/components/admin/primitives";
import { ThemeToggle } from "@/components/admin/theme-toggle";
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
    <div className="flex min-h-screen items-center justify-center px-4 py-8">
      <div className="grid w-full max-w-5xl gap-4 lg:grid-cols-[minmax(0,1fr)_380px]">
        <Card className="border-border/80 bg-card/95">
          <CardHeader className="gap-4 border-b bg-muted/20">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <Badge variant="secondary" className="w-fit">
                Meta Search
              </Badge>
              <ThemeToggle />
            </div>
            <div className="space-y-2">
              <CardTitle className="max-w-2xl text-3xl tracking-tight sm:text-4xl">
                更紧凑的管理入口，只保留高频操作。
              </CardTitle>
              <CardDescription className="max-w-2xl text-sm leading-6">
                Provider、PAT、运行时策略和日志排查统一收敛到
                `shadcn/ui` 风格的单层控制台里，减少扫描成本和操作跳转。
              </CardDescription>
            </div>
          </CardHeader>
          <CardContent className="grid gap-3 p-4 md:grid-cols-3">
            <FeatureCard
              icon={<ShieldCheck className="h-4 w-4" />}
              title="Provider posture"
              description="集中判断 active、disabled、revoked key 的容量分布。"
            />
            <FeatureCard
              icon={<KeyRound className="h-4 w-4" />}
              title="Token surface"
              description="统一管理 PAT 暴露面、启停和轮换风险。"
            />
            <FeatureCard
              icon={<Logs className="h-4 w-4" />}
              title="Event tracing"
              description="请求日志和审计日志在同一工作台内筛查。"
            />
          </CardContent>
        </Card>

        <Card className="border-border/80 bg-card/95">
          <CardHeader className="gap-3 border-b">
            <Badge className="w-fit">Admin access</Badge>
            <div className="space-y-2">
              <CardTitle className="text-xl">Sign in</CardTitle>
              <CardDescription className="leading-6">
                使用当前环境配置的管理员密码进入控制台。
              </CardDescription>
            </div>
          </CardHeader>
          <CardContent className="space-y-4 p-4">
            <div className="rounded-lg border bg-muted/20 px-3 py-2 text-sm text-muted-foreground">
              登录后可直接进入 provider、PAT、策略和日志工作区。
            </div>
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

function FeatureCard({
  icon,
  title,
  description,
}: {
  icon: ReactNode;
  title: string;
  description: string;
}) {
  return (
    <Card className="bg-background shadow-none">
      <CardContent className="space-y-3 p-4">
        <div className="inline-flex rounded-md border bg-muted/40 p-2 text-primary">
          {icon}
        </div>
        <div>
          <p className="font-medium">{title}</p>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">{description}</p>
        </div>
      </CardContent>
    </Card>
  );
}
