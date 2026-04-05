import { type FormEvent, type ReactNode, useState } from "react";
import { KeyRound, Logs, ShieldCheck } from "lucide-react";
import { toast } from "sonner";

import { api } from "@/lib/api";
import { extractErrorMessage } from "@/lib/admin";
import { StateAlert } from "@/components/admin/primitives";
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
      <div className="grid w-full max-w-6xl gap-6 lg:grid-cols-[1.1fr_420px]">
        <Card className="border-border/80 bg-card/90 shadow-none">
          <CardHeader className="space-y-6">
            <div className="space-y-3">
              <Badge variant="outline" className="w-fit">
                Meta Search
              </Badge>
              <div className="space-y-2">
                <CardTitle className="max-w-2xl text-4xl tracking-tight sm:text-5xl">
                  更纯粹的运维界面，只保留高频操作。
                </CardTitle>
                <CardDescription className="max-w-2xl text-base leading-7">
                  Provider、PAT、运行时策略和日志排查全部收敛到标准化的
                  shadcn/ui 组件里，减少视觉噪声和操作跳转。
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-3">
            <FeatureCard
              icon={<ShieldCheck className="h-4 w-4" />}
              title="Provider posture"
              description="快速定位 active、disabled、revoked key。"
            />
            <FeatureCard
              icon={<KeyRound className="h-4 w-4" />}
              title="Token surface"
              description="统一管理 PAT 暴露面和过期风险。"
            />
            <FeatureCard
              icon={<Logs className="h-4 w-4" />}
              title="Event tracing"
              description="请求日志和审计日志在同一工作台内完成筛查。"
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="space-y-3">
            <Badge className="w-fit">Admin access</Badge>
            <div className="space-y-2">
              <CardTitle className="text-2xl">Sign in</CardTitle>
              <CardDescription>
                使用当前环境配置的管理员密码进入控制台。
              </CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            <form className="space-y-5" onSubmit={handleSubmit}>
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
    <Card className="bg-muted/30 shadow-none">
      <CardContent className="space-y-3 p-5">
        <div className="inline-flex rounded-lg border bg-background p-2 text-primary">
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
