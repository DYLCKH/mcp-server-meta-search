import { type FormEvent, type ReactNode, useEffect, useRef, useState } from "react";
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  ChevronRight,
  Copy,
  Filter,
  KeyRound,
  LayoutDashboard,
  LoaderCircle,
  LockKeyhole,
  Logs,
  Menu,
  Plus,
  RefreshCcw,
  Search,
  Settings2,
  ShieldCheck,
  ShieldAlert,
  Sparkles,
  Trash2,
} from "lucide-react";
import {
  Link,
  NavLink,
  Navigate,
  Outlet,
  Route,
  Routes,
  useLocation,
  useNavigate,
  useSearchParams,
} from "react-router-dom";
import { Toaster, toast } from "sonner";

import {
  api,
  type AuditLog,
  type DashboardData,
  type PaginatedResponse,
  type PatRecord,
  type ProviderDetail,
  type ProviderKey,
  type ProviderSummary,
  type RequestLog,
  type SettingsData,
  UNAUTHORIZED_EVENT,
  UnauthorizedError,
} from "@/lib/api";
import { formatDate, formatDuration, formatStrategy } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";

type AuthStatus = "checking" | "authenticated" | "guest";

interface NavItem {
  path: string;
  label: string;
  description: string;
  shortLabel: string;
  icon: typeof LayoutDashboard;
}

interface RequestLogFilters {
  tool: string;
  provider: string;
  status: string;
  from: string;
  to: string;
}

interface AuditLogFilters {
  action: string;
  target: string;
  from: string;
  to: string;
}

const PAGE_SIZE = 50;

const NAV_ITEMS: NavItem[] = [
  {
    path: "/",
    label: "Dashboard",
    description: "Fleet health, key capacity, and token posture at a glance.",
    shortLabel: "Overview",
    icon: LayoutDashboard,
  },
  {
    path: "/providers",
    label: "Providers",
    description: "Inspect provider pools, rotate keys, and recover degraded capacity.",
    shortLabel: "Capacity",
    icon: KeyRound,
  },
  {
    path: "/pats",
    label: "PATs",
    description: "Manage personal access tokens for downstream clients.",
    shortLabel: "Access",
    icon: LockKeyhole,
  },
  {
    path: "/settings",
    label: "Settings",
    description: "Tune retries, timeouts, and key policy without redeploying.",
    shortLabel: "Policy",
    icon: Settings2,
  },
  {
    path: "/logs",
    label: "Logs",
    description: "Trace request outcomes and audit sensitive admin actions.",
    shortLabel: "Events",
    icon: Logs,
  },
];

const EMPTY_REQUEST_FILTERS: RequestLogFilters = {
  tool: "",
  provider: "",
  status: "",
  from: "",
  to: "",
};

const EMPTY_AUDIT_FILTERS: AuditLogFilters = {
  action: "",
  target: "",
  from: "",
  to: "",
};

const FIELD_META: Record<
  keyof SettingsData,
  { label: string; description: string }
> = {
  key_rotation_strategy: {
    label: "Key rotation strategy",
    description: "Choose how the runtime selects among active keys.",
  },
  max_attempts_per_request: {
    label: "Max attempts per request",
    description: "Upper bound on retries before a request is marked failed.",
  },
  request_timeout_ms: {
    label: "Request timeout (ms)",
    description: "Timeout applied to each upstream provider request.",
  },
  key_recovery_interval_ms: {
    label: "Key recovery interval (ms)",
    description: "How long a disabled key waits before re-entering rotation.",
  },
  max_disable_before_revoke: {
    label: "Max disables before revoke",
    description: "How many disable cycles a key can survive before revocation.",
  },
};

export default function App() {
  const location = useLocation();
  const navigate = useNavigate();
  const [authStatus, setAuthStatus] = useState<AuthStatus>("checking");
  const checkedRef = useRef(false);

  useEffect(() => {
    const handleUnauthorized = () => {
      setAuthStatus("guest");
      navigate("/login", { replace: true });
    };

    window.addEventListener(UNAUTHORIZED_EVENT, handleUnauthorized);
    return () => {
      window.removeEventListener(UNAUTHORIZED_EVENT, handleUnauthorized);
    };
  }, [navigate]);

  useEffect(() => {
    if (checkedRef.current) {
      return;
    }

    checkedRef.current = true;

    void (async () => {
      try {
        await api.getDashboard();
        setAuthStatus("authenticated");

        if (location.pathname === "/login") {
          navigate("/", { replace: true });
        }
      } catch (error) {
        if (error instanceof UnauthorizedError) {
          setAuthStatus("guest");
          if (location.pathname !== "/login") {
            navigate("/login", { replace: true });
          }
          return;
        }

        setAuthStatus("guest");
        if (location.pathname !== "/login") {
          navigate("/login", { replace: true });
        }
      }
    })();
  }, [location.pathname, navigate]);

  const currentMeta =
    NAV_ITEMS.find((item) => item.path === location.pathname) ?? NAV_ITEMS[0];

  const handleLoginSuccess = () => {
    setAuthStatus("authenticated");
    navigate("/", { replace: true });
  };

  const handleLogout = async () => {
    await api.logout();
    setAuthStatus("guest");
    navigate("/login", { replace: true });
  };

  if (authStatus === "checking") {
    return <AppLoadingScreen />;
  }

  return (
    <>
      <Routes>
        <Route
          path="/login"
          element={
            authStatus === "authenticated" ? (
              <Navigate to="/" replace />
            ) : (
              <LoginPage onSuccess={handleLoginSuccess} />
            )
          }
        />
        <Route
          element={
            authStatus === "authenticated" ? (
              <AppShell meta={currentMeta} onLogout={handleLogout} />
            ) : (
              <Navigate to="/login" replace />
            )
          }
        >
          <Route path="/" element={<DashboardPage />} />
          <Route path="/providers" element={<ProvidersPage />} />
          <Route path="/pats" element={<PatsPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/logs" element={<LogsPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
      <Toaster
        closeButton
        richColors
        theme="dark"
        toastOptions={{
          className: "font-sans",
        }}
      />
    </>
  );
}

function AppShell({
  meta,
  onLogout,
}: {
  meta: NavItem;
  onLogout: () => Promise<void>;
}) {
  const location = useLocation();
  const [navOpen, setNavOpen] = useState(false);

  useEffect(() => {
    setNavOpen(false);
  }, [location.pathname]);

  return (
    <div className="min-h-screen px-4 py-4 lg:px-6">
      <div className="mx-auto flex max-w-[1600px] gap-6">
        <div
          className={cn(
            "fixed inset-0 z-30 bg-slate-950/65 backdrop-blur-sm transition-opacity lg:hidden",
            navOpen ? "opacity-100" : "pointer-events-none opacity-0",
          )}
          onClick={() => setNavOpen(false)}
        />
        <aside
          className={cn(
            "subtle-grid fixed inset-y-4 left-4 z-40 flex w-[min(21rem,calc(100vw-2rem))] flex-col rounded-[2rem] border border-border/70 bg-card/85 p-5 shadow-panel backdrop-blur-2xl transition-transform duration-200 lg:sticky lg:top-4 lg:h-[calc(100vh-2rem)] lg:w-[20rem]",
            navOpen
              ? "translate-x-0"
              : "-translate-x-[calc(100%+2rem)] lg:translate-x-0",
          )}
        >
          <div className="rounded-[1.5rem] border border-primary/20 bg-primary/10 p-5">
            <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-primary">
              Meta Search
            </p>
            <h1 className="mt-2 text-2xl font-semibold tracking-tight">
              Control Center
            </h1>
            <p className="mt-3 text-sm text-muted-foreground">
              Rebuilt with a component-driven admin shell so provider, token, and
              policy operations now live in one cohesive surface.
            </p>
          </div>

          <nav className="mt-6 flex-1">
            <div className="space-y-2">
              {NAV_ITEMS.map((item) => {
                const Icon = item.icon;

                return (
                  <NavLink
                    key={item.path}
                    to={item.path}
                    end={item.path === "/"}
                    className={({ isActive }) =>
                      cn(
                        "group flex items-center justify-between rounded-2xl border px-4 py-3 transition-all",
                        isActive
                          ? "border-primary/30 bg-primary/10 text-foreground shadow-glow"
                          : "border-transparent text-muted-foreground hover:border-border/70 hover:bg-muted/20 hover:text-foreground",
                      )
                    }
                  >
                    {({ isActive }) => (
                      <>
                        <div className="flex items-center gap-3">
                          <div
                            className={cn(
                              "rounded-xl border p-2 transition-colors",
                              isActive
                                ? "border-primary/30 bg-primary/15 text-primary"
                                : "border-border/70 bg-background/40 text-muted-foreground",
                            )}
                          >
                            <Icon className="h-4 w-4" />
                          </div>
                          <div>
                            <p className="font-semibold">{item.label}</p>
                            <p className="text-xs text-muted-foreground">
                              {item.shortLabel}
                            </p>
                          </div>
                        </div>
                        <ChevronRight className="h-4 w-4 opacity-60 transition-transform group-hover:translate-x-0.5" />
                      </>
                    )}
                  </NavLink>
                );
              })}
            </div>
          </nav>

          <div className="space-y-4">
            <Separator />
            <div className="rounded-2xl border border-border/70 bg-background/40 p-4">
              <p className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
                Current View
              </p>
              <p className="mt-2 font-semibold">{meta.label}</p>
              <p className="mt-1 text-sm text-muted-foreground">
                {meta.description}
              </p>
            </div>
            <Button variant="ghost" className="w-full justify-center" onClick={onLogout}>
              Sign out
            </Button>
          </div>
        </aside>

        <div className="min-w-0 flex-1 lg:ml-0">
          <header className="sticky top-4 z-20 mb-6">
            <div className="rounded-[1.75rem] border border-border/70 bg-card/80 px-4 py-4 shadow-panel backdrop-blur-xl sm:px-6">
              <div className="flex flex-wrap items-center gap-4">
                <Button
                  variant="outline"
                  size="icon"
                  className="lg:hidden"
                  onClick={() => setNavOpen((current) => !current)}
                >
                  <Menu className="h-4 w-4" />
                  <span className="sr-only">Toggle navigation</span>
                </Button>
                <div className="min-w-0 flex-1">
                  <p className="text-[11px] uppercase tracking-[0.22em] text-primary">
                    Secure Admin Surface
                  </p>
                  <h2 className="mt-1 truncate text-xl font-semibold tracking-tight">
                    {meta.label}
                  </h2>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {meta.description}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="default">Live configuration</Badge>
                  <Badge variant="outline">Session secured</Badge>
                </div>
              </div>
            </div>
          </header>

          <main className="pb-8">
            <Outlet />
          </main>
        </div>
      </div>
    </div>
  );
}

function LoginPage({ onSuccess }: { onSuccess: () => void }) {
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
      <div className="grid w-full max-w-6xl gap-6 lg:grid-cols-[1.15fr_0.85fr]">
        <section className="hero-grid flex flex-col justify-between gap-8 p-8">
          <div>
            <Badge variant="outline" className="border-primary/30 text-primary">
              Meta Search
            </Badge>
            <h1 className="mt-6 max-w-2xl text-4xl font-semibold tracking-tight sm:text-5xl">
              Operate the search stack without losing context.
            </h1>
            <p className="mt-4 max-w-2xl text-base text-muted-foreground sm:text-lg">
              This admin UI now runs on a React and shadcn component layer, which
              makes the operational surface faster to evolve and easier to scan
              under pressure.
            </p>
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            <FeatureTile
              icon={<ShieldCheck className="h-5 w-5" />}
              title="Provider posture"
              description="Inspect active, disabled, and revoked credentials in one pass."
            />
            <FeatureTile
              icon={<Sparkles className="h-5 w-5" />}
              title="Live policy"
              description="Adjust retries, rotation strategy, and recovery timing without redeploying."
            />
            <FeatureTile
              icon={<Logs className="h-5 w-5" />}
              title="Traceability"
              description="Review request outcomes and audit history from the same shell."
            />
          </div>
        </section>

        <Card className="border-border/70 bg-card/85">
          <CardHeader>
            <Badge variant="success" className="w-fit">
              Admin Access
            </Badge>
            <CardTitle className="mt-3 text-3xl">Sign in to continue</CardTitle>
            <CardDescription className="text-sm">
              Use the server-side admin password configured for this environment.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form className="space-y-5" onSubmit={handleSubmit}>
              {error ? (
                <InlineAlert tone="error" title="Authentication failed" message={error} />
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
                {submitting ? (
                  <>
                    <LoaderCircle className="h-4 w-4 animate-spin" />
                    Signing in...
                  </>
                ) : (
                  "Sign in"
                )}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function DashboardPage() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;

    void (async () => {
      try {
        const response = await api.getDashboard();
        if (!active) {
          return;
        }

        setData(response);
        setError("");
      } catch (requestError) {
        if (!active) {
          return;
        }

        setError(extractErrorMessage(requestError));
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

  if (loading) {
    return <LoadingPanel label="Loading dashboard" />;
  }

  if (error || !data) {
    return (
      <InlineAlert
        tone="error"
        title="Failed to load dashboard"
        message={error || "No dashboard payload returned."}
      />
    );
  }

  const providers = data.providers;
  const totalProviders = providers.length;
  const configuredProviders = providers.filter((provider) => provider.total > 0).length;
  const healthyProviders = providers.filter((provider) => provider.activeKeys > 0).length;
  const totalKeys = providers.reduce((sum, provider) => sum + provider.total, 0);
  const activeKeys = providers.reduce((sum, provider) => sum + provider.activeKeys, 0);
  const disabledKeys = providers.reduce(
    (sum, provider) => sum + provider.disabledKeys,
    0,
  );
  const revokedKeys = providers.reduce((sum, provider) => sum + provider.revokedKeys, 0);
  const attentionProviders = providers.filter(
    (provider) => provider.total > 0 && provider.activeKeys === 0,
  );
  const degradedProviders = providers.filter(
    (provider) => provider.disabledKeys + provider.revokedKeys > 0,
  );
  const actionQueue: Array<{
    title: string;
    description: string;
    link: string;
    label: string;
    tone: "success" | "warning" | "error";
  }> = [
    attentionProviders.length
      ? {
          title: "Restore provider capacity",
          description: `${summarizeNames(
            attentionProviders.map((provider) => provider.name),
          )} currently have no active keys and cannot safely receive traffic.`,
          link: "/providers",
          label: "Open provider workspace",
          tone: "warning" as const,
        }
      : null,
    degradedProviders.length
      ? {
          title: "Review degraded credentials",
          description: `${disabledKeys} disabled and ${revokedKeys} revoked keys are reducing usable headroom across the fleet.`,
          link: "/providers",
          label: "Inspect key posture",
          tone: "error" as const,
        }
      : null,
    data.patCount === 0
      ? {
          title: "Create a client token",
          description: "No personal access tokens are registered yet, so downstream access still depends on direct credentials.",
          link: "/pats",
          label: "Create PAT",
          tone: "warning" as const,
        }
      : {
          title: "Review token surface",
          description: `${data.patCount} PATs are currently available to clients. Keep the exposed token surface intentionally small.`,
          link: "/pats",
          label: "Review PAT inventory",
          tone: "success" as const,
        },
  ].filter(
    (
      item,
    ): item is {
      title: string;
      description: string;
      link: string;
      label: string;
      tone: "success" | "warning" | "error";
    } => item !== null,
  );

  return (
    <div className="space-y-6">
      <PageHero
        kicker="Operations Overview"
        title="Search infrastructure at a glance"
        description="Provider health, access surface, and runtime posture stay visible without switching tools."
        actions={
          <>
            <Button asChild>
              <Link to="/providers">Manage providers</Link>
            </Button>
            <Button asChild variant="outline">
              <Link to="/logs">Inspect logs</Link>
            </Button>
          </>
        }
        aside={
          <div className="grid gap-3 sm:grid-cols-3">
            <HeroStat label="Configured providers" value={`${configuredProviders}/${totalProviders}`} />
            <HeroStat label="Attention pools" value={String(attentionProviders.length)} />
            <HeroStat label="PAT inventory" value={String(data.patCount)} />
          </div>
        }
      />

      <div className="data-grid">
        <MetricCard
          kicker="Provider Fleet"
          value={`${configuredProviders}/${totalProviders}`}
          label="providers configured"
          meta={`${healthyProviders} healthy, ${Math.max(totalProviders - healthyProviders, 0)} need attention`}
        />
        <MetricCard
          kicker="Active Capacity"
          value={String(activeKeys)}
          label="keys serving traffic"
          meta={`${totalKeys} total keys across all providers`}
        />
        <MetricCard
          kicker="Key Posture"
          value={String(disabledKeys + revokedKeys)}
          label="keys need operator action"
          meta={`${disabledKeys} disabled, ${revokedKeys} revoked`}
        />
        <MetricCard
          kicker="Access Surface"
          value={String(data.patCount)}
          label="personal access tokens"
          meta="Review PAT usage and rotation regularly"
        />
      </div>

      <div className="grid gap-6 xl:grid-cols-[0.9fr_1.1fr]">
        <Card>
          <CardHeader>
            <SectionKicker>Action Queue</SectionKicker>
            <CardTitle>What needs attention now</CardTitle>
            <CardDescription className="mt-2">
              This surface now biases toward next actions instead of leaving you
              to infer urgency from raw counts.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {actionQueue.map((item) => (
              <div
                key={item.title}
                className="rounded-3xl border border-border/70 bg-background/25 p-5"
              >
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <Badge
                      variant={
                        item.tone === "success"
                          ? "success"
                          : item.tone === "warning"
                            ? "warning"
                            : "destructive"
                      }
                    >
                      {item.tone === "success"
                        ? "Stable"
                        : item.tone === "warning"
                          ? "Attention"
                          : "Risk"}
                    </Badge>
                    <p className="mt-3 text-base font-semibold">{item.title}</p>
                    <p className="mt-2 text-sm text-muted-foreground">
                      {item.description}
                    </p>
                  </div>
                  <div
                    className={cn(
                      "rounded-2xl p-3",
                      item.tone === "success" && "bg-success/10 text-success-foreground",
                      item.tone === "warning" && "bg-warning/10 text-warning-foreground",
                      item.tone === "error" && "bg-destructive/10 text-destructive",
                    )}
                  >
                    {item.tone === "success" ? (
                      <CheckCircle2 className="h-5 w-5" />
                    ) : item.tone === "warning" ? (
                      <AlertTriangle className="h-5 w-5" />
                    ) : (
                      <ShieldAlert className="h-5 w-5" />
                    )}
                  </div>
                </div>
                <Button asChild variant="ghost" className="mt-4 px-0 text-primary">
                  <Link to={item.link}>
                    {item.label}
                    <ArrowRight className="h-4 w-4" />
                  </Link>
                </Button>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <SectionKicker>Provider Health Matrix</SectionKicker>
              <CardTitle>Where capacity is concentrated</CardTitle>
              <CardDescription className="mt-2">
                The distribution bar shows which providers can absorb traffic and
                which ones are drifting out of service.
              </CardDescription>
            </div>
            <Button asChild variant="outline">
              <Link to="/providers">Open provider console</Link>
            </Button>
          </CardHeader>
          <CardContent>
            {providers.length ? (
              <div className="space-y-4">
                {providers
                  .slice()
                  .sort((left, right) => right.total - left.total)
                  .map((provider) => (
                    <Link
                      key={provider.name}
                      to={`/providers?provider=${provider.name}`}
                      className="block"
                    >
                      <div className="rounded-3xl border border-border/70 bg-background/25 p-5 transition-all hover:-translate-y-0.5 hover:border-primary/30">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <div>
                            <div className="flex items-center gap-3">
                              <h3 className="text-lg font-semibold capitalize">
                                {provider.name}
                              </h3>
                              <Badge
                                variant={
                                  provider.activeKeys > 0 ? "success" : "destructive"
                                }
                              >
                                {provider.activeKeys > 0 ? "Serving" : "Blocked"}
                              </Badge>
                            </div>
                            <p className="mt-1 text-sm text-muted-foreground">
                              {provider.total
                                ? `${Math.round((provider.activeKeys / provider.total) * 100)}% of this pool is active`
                                : "No keys configured"}
                            </p>
                          </div>
                          <span className="text-sm text-muted-foreground">
                            {provider.total} total keys
                          </span>
                        </div>
                        <div className="mt-4">
                          <HealthMixBar
                            active={provider.activeKeys}
                            disabled={provider.disabledKeys}
                            revoked={provider.revokedKeys}
                            total={provider.total}
                          />
                        </div>
                        <div className="mt-4 grid gap-3 sm:grid-cols-3">
                          <StatRow label="Active" value={provider.activeKeys} tone="success" />
                          <StatRow label="Disabled" value={provider.disabledKeys} tone="warning" />
                          <StatRow label="Revoked" value={provider.revokedKeys} tone="destructive" />
                        </div>
                      </div>
                    </Link>
                  ))}
              </div>
            ) : (
              <EmptyState
                title="No providers available"
                description="Add provider keys to start routing requests through the admin console."
              />
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function ProvidersPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [summaries, setSummaries] = useState<ProviderSummary[]>([]);
  const [selected, setSelected] = useState("");
  const [detail, setDetail] = useState<ProviderDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState("");
  const [addKeyOpen, setAddKeyOpen] = useState(false);
  const [providerQuery, setProviderQuery] = useState("");
  const [providerScope, setProviderScope] = useState<
    "all" | "healthy" | "attention"
  >("all");

  async function loadProviders(preferred?: string) {
    setLoading(true);

    try {
      const response = await api.getProviders();
      const nextSummaries = response.providers;
      const requested = searchParams.get("provider");
      const preferredName = preferred || requested || selected;
      const nextSelected = nextSummaries.some(
        (provider) => provider.name === preferredName,
      )
        ? preferredName
        : nextSummaries[0]?.name || "";

      setSummaries(nextSummaries);
      setSelected(nextSelected);
      setError("");
    } catch (requestError) {
      setError(extractErrorMessage(requestError));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadProviders();
  }, []);

  useEffect(() => {
    const requested = searchParams.get("provider");

    if (requested && requested !== selected && summaries.some((provider) => provider.name === requested)) {
      setSelected(requested);
    }
  }, [searchParams, selected, summaries]);

  useEffect(() => {
    if (!selected) {
      setDetail(null);
      return;
    }

    if (searchParams.get("provider") !== selected) {
      const nextParams = new URLSearchParams(searchParams);
      nextParams.set("provider", selected);
      setSearchParams(nextParams, { replace: true });
    }

    let active = true;
    setDetailLoading(true);

    void (async () => {
      try {
        const response = await api.getProvider(selected);
        if (!active) {
          return;
        }

        setDetail(response);
        setDetailError("");
      } catch (requestError) {
        if (!active) {
          return;
        }

        setDetailError(extractErrorMessage(requestError));
      } finally {
        if (active) {
          setDetailLoading(false);
        }
      }
    })();

    return () => {
      active = false;
    };
  }, [searchParams, selected, setSearchParams]);

  const selectedSummary =
    summaries.find((provider) => provider.name === selected) ?? null;
  const visibleSummaries = summaries.filter((provider) => {
    const matchesQuery = provider.name
      .toLowerCase()
      .includes(providerQuery.trim().toLowerCase());

    if (!matchesQuery) {
      return false;
    }

    if (providerScope === "healthy") {
      return provider.activeKeys > 0;
    }

    if (providerScope === "attention") {
      return (
        provider.activeKeys === 0 ||
        provider.disabledKeys + provider.revokedKeys > 0
      );
    }

    return true;
  });
  const selectedHasAttention =
    (selectedSummary?.activeKeys ?? 0) === 0 ||
    (selectedSummary?.disabledKeys ?? 0) + (selectedSummary?.revokedKeys ?? 0) > 0;

  const handleToggleKey = async (key: ProviderKey, index: number) => {
    if (!selected) {
      return;
    }

    try {
      await api.updateKey(selected, index, { enabled: !key.enabled });
      toast.success(`${selected} key updated`);
      await loadProviders(selected);
    } catch (requestError) {
      toast.error(extractErrorMessage(requestError));
    }
  };

  const handleDeleteKey = async (index: number) => {
    if (!selected) {
      return;
    }

    if (!window.confirm("Delete this API key permanently?")) {
      return;
    }

    try {
      await api.deleteKey(selected, index);
      toast.success(`Deleted key from ${selected}`);
      await loadProviders(selected);
    } catch (requestError) {
      toast.error(extractErrorMessage(requestError));
    }
  };

  return (
    <div className="space-y-6">
      <PageHero
        kicker="Provider Pools"
        title="Keep key capacity healthy"
        description="Inspect every provider pool, add fresh credentials, and isolate degraded keys before they impact traffic."
        actions={
          <>
            <Button
              variant="outline"
              onClick={() => {
                setProviderQuery("");
                setProviderScope("all");
              }}
              disabled={!providerQuery && providerScope === "all"}
            >
              <Filter className="h-4 w-4" />
              Reset filters
            </Button>
            <Button onClick={() => setAddKeyOpen(true)} disabled={!selectedSummary}>
              <Plus className="h-4 w-4" />
              Add key
            </Button>
          </>
        }
        aside={
          <div className="grid gap-3 sm:grid-cols-3">
            <HeroStat
              label="Providers"
              value={loading ? "..." : String(summaries.length)}
            />
            <HeroStat
              label="Healthy pools"
              value={
                loading
                  ? "..."
                  : String(summaries.filter((provider) => provider.activeKeys > 0).length)
              }
            />
            <HeroStat
              label="Attention pools"
              value={
                loading
                  ? "..."
                  : String(summaries.filter((provider) => provider.activeKeys === 0).length)
              }
            />
          </div>
        }
      />

      {error ? (
        <InlineAlert
          tone="error"
          title="Failed to load providers"
          message={error}
        />
      ) : null}

      <div className="grid gap-6 xl:grid-cols-[320px_minmax(0,1fr)]">
        <Card className="xl:sticky xl:top-28 xl:h-fit">
          <CardHeader>
            <SectionKicker>Provider Rail</SectionKicker>
            <CardTitle>Choose a working set</CardTitle>
            <CardDescription className="mt-2">
              Search the fleet, narrow to attention states, and keep the detail
              panel focused on one pool at a time.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Input
              value={providerQuery}
              onChange={(event) => setProviderQuery(event.target.value)}
              placeholder="Filter providers by name"
            />
            <div className="grid grid-cols-3 gap-2">
              {[
                { id: "all", label: "All" },
                { id: "healthy", label: "Healthy" },
                { id: "attention", label: "Attention" },
              ].map((option) => (
                <Button
                  key={option.id}
                  variant={providerScope === option.id ? "default" : "outline"}
                  size="sm"
                  onClick={() =>
                    setProviderScope(option.id as "all" | "healthy" | "attention")
                  }
                >
                  {option.label}
                </Button>
              ))}
            </div>
            {loading ? (
              <LoadingPanel label="Loading providers" compact />
            ) : visibleSummaries.length ? (
              <div className="space-y-3">
                {visibleSummaries.map((provider) => {
                  const isSelected = provider.name === selected;

                  return (
                    <button
                      key={provider.name}
                      type="button"
                      onClick={() => setSelected(provider.name)}
                      className={cn(
                        "w-full rounded-3xl border p-4 text-left transition-all",
                        isSelected
                          ? "border-primary/30 bg-primary/10 shadow-glow"
                          : "border-border/70 bg-background/25 hover:border-primary/20 hover:bg-background/40",
                      )}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-base font-semibold capitalize">
                            {provider.name}
                          </p>
                          <p className="mt-1 text-sm text-muted-foreground">
                            {provider.total} keys · {provider.activeKeys} active
                          </p>
                        </div>
                        <Badge
                          variant={
                            provider.activeKeys > 0 ? "success" : "destructive"
                          }
                        >
                          {provider.activeKeys > 0 ? "Serving" : "Blocked"}
                        </Badge>
                      </div>
                      <div className="mt-4">
                        <HealthMixBar
                          active={provider.activeKeys}
                          disabled={provider.disabledKeys}
                          revoked={provider.revokedKeys}
                          total={provider.total}
                          compact
                        />
                      </div>
                    </button>
                  );
                })}
              </div>
            ) : (
              <EmptyState
                title="No providers match"
                description="Clear or widen the filters to bring pools back into the rail."
              />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <SectionKicker>{selectedSummary?.name || "Provider"}</SectionKicker>
              <CardTitle className="capitalize">
                {selectedSummary?.name || "Select a provider"} workspace
              </CardTitle>
              <CardDescription className="mt-2">
                The right-hand workspace is tuned for action: understand the pool,
                decide whether it is healthy, then change individual keys.
              </CardDescription>
              {selectedSummary ? (
                <div className="mt-4 flex flex-wrap gap-2">
                  <Badge variant={selectedHasAttention ? "warning" : "success"}>
                    {selectedHasAttention ? "Needs review" : "Stable"}
                  </Badge>
                  <Badge variant="outline">Total {selectedSummary.total}</Badge>
                  <Badge variant="success">Active {selectedSummary.activeKeys}</Badge>
                  <Badge variant="warning">Disabled {selectedSummary.disabledKeys}</Badge>
                  <Badge variant="destructive">Revoked {selectedSummary.revokedKeys}</Badge>
                </div>
              ) : null}
            </div>
            <Button onClick={() => setAddKeyOpen(true)} disabled={!selectedSummary}>
              <Plus className="h-4 w-4" />
              Add key
            </Button>
          </CardHeader>
          <CardContent>
            {!selectedSummary ? (
              <EmptyState
                title="No provider selected"
                description="Pick a provider from the rail to open its credential workspace."
              />
            ) : detailLoading ? (
              <LoadingPanel label="Loading provider details" compact />
            ) : detailError ? (
              <InlineAlert
                tone="error"
                title="Failed to load provider details"
                message={detailError}
              />
            ) : (
              <div className="space-y-6">
                <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_280px]">
                  <div className="rounded-3xl border border-border/70 bg-background/25 p-5">
                    <p className="text-sm font-medium">
                      {selectedHasAttention
                        ? "This pool has degraded capacity and should be reviewed before traffic shifts toward it."
                        : "This pool is currently healthy and can continue serving traffic."}
                    </p>
                    <div className="mt-4">
                      <HealthMixBar
                        active={selectedSummary.activeKeys}
                        disabled={selectedSummary.disabledKeys}
                        revoked={selectedSummary.revokedKeys}
                        total={selectedSummary.total}
                      />
                    </div>
                  </div>
                  <div className="rounded-3xl border border-border/70 bg-background/25 p-5">
                    <p className="text-sm font-semibold">Operator guidance</p>
                    <ul className="mt-3 space-y-3 text-sm text-muted-foreground">
                      <li>Disable suspicious keys first, then delete them after replacement is verified.</li>
                      <li>Revoked keys cannot be re-enabled, so they should be replaced rather than recovered.</li>
                      <li>Use last-used timestamps to avoid rotating out the only credential still serving traffic.</li>
                    </ul>
                  </div>
                </div>

                {detail?.keys?.length ? (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Credential</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Last used</TableHead>
                        <TableHead>Notes</TableHead>
                        <TableHead className="text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {detail.keys.map((key, index) => (
                        <TableRow key={`${selectedSummary.name}-${index}`}>
                          <TableCell className="font-mono text-sm text-primary">
                            {key.masked}
                          </TableCell>
                          <TableCell>
                            <Badge variant={statusVariant(key.status)}>
                              {capitalize(key.status)}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-muted-foreground">
                            {key.lastUsed ? formatDate(key.lastUsed) : "No usage recorded yet"}
                          </TableCell>
                          <TableCell className="max-w-[24rem] text-muted-foreground">
                            {providerKeyDescription(key)}
                          </TableCell>
                          <TableCell>
                            <div className="flex justify-end gap-2">
                              <Button
                                variant="outline"
                                size="sm"
                                disabled={key.status === "revoked"}
                                onClick={() => handleToggleKey(key, index)}
                              >
                                {key.enabled ? "Disable" : "Enable"}
                              </Button>
                              <Button
                                variant="destructive"
                                size="sm"
                                onClick={() => handleDeleteKey(index)}
                              >
                                <Trash2 className="h-4 w-4" />
                                Delete
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                ) : (
                  <EmptyState
                    title="No keys configured"
                    description="Add a new key to start serving traffic through this provider."
                  />
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <AddKeyDialog
        open={addKeyOpen}
        provider={selectedSummary?.name ?? ""}
        onOpenChange={setAddKeyOpen}
        onAdded={async () => {
          await loadProviders(selectedSummary?.name);
        }}
      />
    </div>
  );
}

function PatsPage() {
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
        response.message ||
          "Full tokens are only returned when the PAT is created.",
      );
    } catch (requestError) {
      toast.error(extractErrorMessage(requestError));
    }
  };

  const activeCount = pats.filter((pat) => pat.enabled).length;
  const disabledCount = pats.length - activeCount;
  const expiringPats = pats.filter((pat) => isPatExpiringSoon(pat));
  const expiringSoon = expiringPats.length;
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
    <div className="space-y-6">
      <PageHero
        kicker="Access Tokens"
        title="Personal access token control"
        description="Create client-facing tokens, review expiry posture, and remove stale credentials before they become a risk."
        actions={
          <>
            <Button
              variant="outline"
              onClick={() => {
                setPatQuery("");
                setPatScope("all");
              }}
              disabled={!patQuery && patScope === "all"}
            >
              <Filter className="h-4 w-4" />
              Reset filters
            </Button>
            <Button onClick={() => setCreateOpen(true)}>
              <Plus className="h-4 w-4" />
              Create PAT
            </Button>
          </>
        }
        aside={
          <div className="grid gap-3 sm:grid-cols-3">
            <HeroStat label="Active" value={loading ? "..." : String(activeCount)} />
            <HeroStat label="Disabled" value={loading ? "..." : String(disabledCount)} />
            <HeroStat
              label="Expiring soon"
              value={loading ? "..." : String(expiringSoon)}
            />
          </div>
        }
      />

      {error ? (
        <InlineAlert tone="error" title="Failed to load PATs" message={error} />
      ) : null}

      {createdToken ? (
        <Card className="border-success/30 bg-success/10">
          <CardHeader>
            <SectionKicker>Copy Now</SectionKicker>
            <CardTitle>PAT created successfully</CardTitle>
            <CardDescription className="mt-2">
              This is the only time the full token will be shown.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <code className="overflow-x-auto rounded-2xl border border-success/20 bg-background/50 px-4 py-3 font-mono text-sm text-success-foreground">
              {createdToken}
            </code>
            <Button
              variant="outline"
              onClick={async () => {
                await copyToClipboard(createdToken);
              }}
            >
              <Copy className="h-4 w-4" />
              Copy token
            </Button>
          </CardContent>
        </Card>
      ) : null}

      {revealedMessage ? (
        <InlineAlert
          tone="warning"
          title="Reveal unavailable"
          message={revealedMessage}
        />
      ) : null}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
        <Card>
          <CardHeader>
            <SectionKicker>Inventory</SectionKicker>
            <CardTitle>Token registry</CardTitle>
            <CardDescription className="mt-2">
              Search by usage context, isolate risky subsets, and keep token
              rotation decisions visible.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto]">
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
              <LoadingPanel label="Loading tokens" compact />
            ) : pats.length ? (
              filteredPats.length ? (
                <>
                  <div className="grid gap-4 md:grid-cols-3">
                    <MetricCard
                      kicker="Active"
                      value={String(activeCount)}
                      label="tokens currently usable"
                      meta="These tokens can authenticate downstream clients right now."
                    />
                    <MetricCard
                      kicker="Disabled"
                      value={String(disabledCount)}
                      label="tokens removed from use"
                      meta="Disabled tokens remain available for inspection until deletion."
                    />
                    <MetricCard
                      kicker="Filtered"
                      value={String(filteredPats.length)}
                      label="tokens in the current view"
                      meta="Use the filter bar to narrow the rotation queue."
                    />
                  </div>

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
                            <div className="font-semibold">{pat.name}</div>
                            <div className="text-sm text-muted-foreground">
                              {pat.note || "No note provided"}
                            </div>
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
                </>
              ) : (
                <EmptyState
                  title="No PATs match"
                  description="Clear or widen the filters to bring tokens back into view."
                />
              )
            ) : (
              <EmptyState
                title="No PATs created yet"
                description="Create one to authenticate clients against the admin surface."
              />
            )}
          </CardContent>
        </Card>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <SectionKicker>Rotation Radar</SectionKicker>
              <CardTitle>Risky tokens</CardTitle>
              <CardDescription className="mt-2">
                Expiring or dormant credentials should be easy to spot without
                scanning the entire registry.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {expiringPats.length ? (
                expiringPats.slice(0, 4).map((pat) => (
                  <div
                    key={pat.name}
                    className="rounded-3xl border border-warning/25 bg-warning/10 p-4"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-semibold">{pat.name}</p>
                        <p className="mt-1 text-sm text-muted-foreground">
                          Expires {formatDate(pat.expiresAt)}
                        </p>
                      </div>
                      <Badge variant="warning">Rotate</Badge>
                    </div>
                  </div>
                ))
              ) : (
                <div className="rounded-3xl border border-success/25 bg-success/10 p-4">
                  <p className="font-semibold">No tokens expiring soon</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    The current registry does not show any token expiring within 7 days.
                  </p>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <SectionKicker>Handling Notes</SectionKicker>
              <CardTitle>Safer token operations</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm text-muted-foreground">
              <div className="rounded-3xl border border-border/70 bg-background/25 p-4">
                Full tokens are only shown once, right after creation. Treat that
                reveal event as a handoff point, not as a recoverable view.
              </div>
              <div className="rounded-3xl border border-border/70 bg-background/25 p-4">
                Disable a token before deleting it if you need a controlled rollout
                or want to observe whether any client still depends on it.
              </div>
              <div className="rounded-3xl border border-border/70 bg-background/25 p-4">
                Keep notes specific. Good notes turn a token list into an ownership
                map instead of an opaque secret inventory.
              </div>
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

function SettingsPage() {
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
    <div className="space-y-6">
      <PageHero
        kicker="Runtime Policy"
        title="Tune behavior without redeploying"
        description="Update retry, timeout, and key lifecycle policy from the admin console. Changes apply immediately after save."
        actions={
          <>
            <Button
              variant="outline"
              onClick={handleReset}
              disabled={!hasChanges || saving}
            >
              <RefreshCcw className="h-4 w-4" />
              Revert
            </Button>
            <Button onClick={handleSave} disabled={!hasChanges || saving || !form}>
              {saving ? (
                <>
                  <LoaderCircle className="h-4 w-4 animate-spin" />
                  Saving...
                </>
              ) : (
                "Save changes"
              )}
            </Button>
          </>
        }
        aside={
          <div className="grid gap-3 sm:grid-cols-4">
            <HeroStat
              label="Rotation"
              value={loading || !form ? "..." : formatStrategy(form.key_rotation_strategy)}
            />
            <HeroStat
              label="Timeout"
              value={loading || !form ? "..." : `${form.request_timeout_ms}ms`}
            />
            <HeroStat
              label="Retries"
              value={
                loading || !form
                  ? "..."
                  : String(form.max_attempts_per_request)
              }
            />
            <HeroStat label="Pending edits" value={String(changedFields.length)} />
          </div>
        }
      />

      {error ? (
        <InlineAlert tone="error" title="Failed to save settings" message={error} />
      ) : null}

      {savedMessage ? (
        <InlineAlert tone="success" title="Policy updated" message={savedMessage} />
      ) : null}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <SectionKicker>Traffic Orchestration</SectionKicker>
              <CardTitle>How requests move through the fleet</CardTitle>
              <CardDescription className="mt-2">
                These settings define selection, retry pressure, and request patience.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {loading || !form ? (
                <LoadingPanel label="Loading settings" compact />
              ) : (
                <div className="grid gap-4 xl:grid-cols-2">
                  <Card className="border-border/70 bg-background/25">
                    <CardContent className="space-y-3 p-5">
                      <Label htmlFor="key_rotation_strategy">
                        {FIELD_META.key_rotation_strategy.label}
                      </Label>
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
                      <p className="text-sm text-muted-foreground">
                        {FIELD_META.key_rotation_strategy.description}
                      </p>
                    </CardContent>
                  </Card>

                  <SettingsNumberCard
                    id="max_attempts_per_request"
                    label={FIELD_META.max_attempts_per_request.label}
                    description={FIELD_META.max_attempts_per_request.description}
                    value={form.max_attempts_per_request}
                    onChange={(value) =>
                      setForm({ ...form, max_attempts_per_request: value })
                    }
                  />
                  <SettingsNumberCard
                    id="request_timeout_ms"
                    label={FIELD_META.request_timeout_ms.label}
                    description={FIELD_META.request_timeout_ms.description}
                    value={form.request_timeout_ms}
                    onChange={(value) =>
                      setForm({ ...form, request_timeout_ms: value })
                    }
                  />
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <SectionKicker>Key Lifecycle</SectionKicker>
              <CardTitle>How damaged credentials recover or fail out</CardTitle>
              <CardDescription className="mt-2">
                These controls decide how long keys stay sidelined and when they
                are treated as permanently unsafe.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {loading || !form ? (
                <LoadingPanel label="Loading settings" compact />
              ) : (
                <div className="grid gap-4 xl:grid-cols-2">
                  <SettingsNumberCard
                    id="key_recovery_interval_ms"
                    label={FIELD_META.key_recovery_interval_ms.label}
                    description={FIELD_META.key_recovery_interval_ms.description}
                    value={form.key_recovery_interval_ms}
                    onChange={(value) =>
                      setForm({ ...form, key_recovery_interval_ms: value })
                    }
                  />
                  <SettingsNumberCard
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

        <div className="space-y-6 xl:sticky xl:top-28 xl:h-fit">
          <Card>
            <CardHeader>
              <SectionKicker>Change Summary</SectionKicker>
              <CardTitle>{changedFields.length ? "Pending edits" : "No unsaved changes"}</CardTitle>
            </CardHeader>
            <CardContent>
              {changedFields.length ? (
                <div className="space-y-3">
                  {changedFields.map((field) => (
                    <div
                      key={field}
                      className="rounded-3xl border border-primary/20 bg-primary/10 p-4"
                    >
                      <p className="font-semibold">{FIELD_META[field].label}</p>
                      <p className="mt-1 text-sm text-muted-foreground">
                        {FIELD_META[field].description}
                      </p>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="rounded-3xl border border-success/25 bg-success/10 p-4">
                  <p className="font-semibold">Policy matches runtime</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    The form is aligned with the latest values loaded from the server.
                  </p>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <SectionKicker>Operator Notes</SectionKicker>
              <CardTitle>Safer change patterns</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm text-muted-foreground">
              <div className="rounded-3xl border border-border/70 bg-background/25 p-4">
                Increase timeout and retries together only when upstream latency is
                the problem. Raising one without the other usually just shifts failure modes.
              </div>
              <div className="rounded-3xl border border-border/70 bg-background/25 p-4">
                Short recovery intervals can oscillate degraded keys back into rotation
                too early. Use them only when upstream instability is transient.
              </div>
              <div className="rounded-3xl border border-border/70 bg-background/25 p-4">
                Lower revoke thresholds make the system more conservative, but they
                also require faster key replacement discipline from operators.
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

function LogsPage() {
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
            to: requestFilters.to
              ? new Date(requestFilters.to).toISOString()
              : undefined,
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
            from: auditFilters.from
              ? new Date(auditFilters.from).toISOString()
              : undefined,
            to: auditFilters.to
              ? new Date(auditFilters.to).toISOString()
              : undefined,
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
    <div className="space-y-6">
      <PageHero
        kicker="Observability"
        title="Request and audit trails"
        description="Filter recent request outcomes and operator actions from one place so investigations do not require database access."
        aside={
          <div className="grid gap-3 sm:grid-cols-3">
            <HeroStat
              label="Request rows"
              value={requestData ? String(requestData.logs.length) : "..."}
            />
            <HeroStat
              label="Audit rows"
              value={auditData ? String(auditData.logs.length) : "..."}
            />
            <HeroStat label="Page size" value={String(PAGE_SIZE)} />
          </div>
        }
      />

      <Card>
        <CardHeader className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <SectionKicker>Filters</SectionKicker>
            <CardTitle>Slice the event stream</CardTitle>
            <CardDescription className="mt-2">
              Switch between request and audit logs, then narrow by time, target, or outcome.
            </CardDescription>
          </div>
          <Badge variant="outline">Server-backed pagination</Badge>
        </CardHeader>
        <CardContent>
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
                className="grid gap-4 lg:grid-cols-[repeat(5,minmax(0,1fr))_auto]"
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
                        setRequestDraft({
                          ...requestDraft,
                          provider: event.target.value,
                        })
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
                  <Button type="submit">
                    <Search className="h-4 w-4" />
                    Apply
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
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
                className="grid gap-4 lg:grid-cols-[repeat(4,minmax(0,1fr))_auto]"
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
                  <Button type="submit">
                    <Search className="h-4 w-4" />
                    Apply
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
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
        <InlineAlert tone="error" title="Failed to load logs" message={error} />
      ) : null}

      {activeTab === "requests" ? (
        <Card>
          <CardHeader className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <SectionKicker>Requests</SectionKicker>
              <CardTitle>Latest provider traffic</CardTitle>
              <CardDescription className="mt-2">
                Showing {currentRequestData.length} entries from the current page.
              </CardDescription>
            </div>
            <Badge variant={requestData?.hasMore ? "success" : "outline"}>
              {requestData?.hasMore ? "More available" : "Newest page"}
            </Badge>
          </CardHeader>
          <CardContent className="space-y-5">
            {loading ? (
              <LoadingPanel label="Loading request logs" compact />
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
          <CardHeader className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <SectionKicker>Audit</SectionKicker>
              <CardTitle>Latest admin actions</CardTitle>
              <CardDescription className="mt-2">
                Showing {currentAuditData.length} entries from the current page.
              </CardDescription>
            </div>
            <Badge variant={auditData?.hasMore ? "success" : "outline"}>
              {auditData?.hasMore ? "More available" : "Newest page"}
            </Badge>
          </CardHeader>
          <CardContent className="space-y-5">
            {loading ? (
              <LoadingPanel label="Loading audit logs" compact />
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
                        <TableCell className="font-semibold">
                          {log.action || "-"}
                        </TableCell>
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

function CreatePatDialog({
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
          <DialogDescription>
            The token can be copied once after creation. Expiration is optional
            but recommended.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          {error ? (
            <InlineAlert tone="error" title="Unable to create PAT" message={error} />
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

function AddKeyDialog({
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
          <DialogTitle className="capitalize">Add key for {provider || "provider"}</DialogTitle>
          <DialogDescription>
            This updates the runtime configuration immediately after validation succeeds.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          {error ? (
            <InlineAlert tone="error" title="Unable to add key" message={error} />
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
                  className="min-h-[112px] font-mono text-sm"
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

function AppLoadingScreen() {
  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <Card className="w-full max-w-lg">
        <CardContent className="flex items-center gap-4 p-6">
          <LoaderCircle className="h-6 w-6 animate-spin text-primary" />
          <div>
            <p className="font-semibold">Loading admin console</p>
            <p className="text-sm text-muted-foreground">
              Verifying the current session and preparing the UI shell.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function PageHero({
  kicker,
  title,
  description,
  actions,
  aside,
}: {
  kicker: string;
  title: string;
  description: string;
  actions?: ReactNode;
  aside?: ReactNode;
}) {
  return (
    <section className="hero-grid">
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
        <div>
          <SectionKicker>{kicker}</SectionKicker>
          <h1 className="max-w-3xl text-4xl font-semibold tracking-tight sm:text-5xl">
            {title}
          </h1>
          <p className="mt-4 max-w-3xl text-base text-muted-foreground sm:text-lg">
            {description}
          </p>
          {actions ? <div className="mt-6 flex flex-wrap gap-3">{actions}</div> : null}
        </div>
        {aside ? <div className="lg:max-w-md">{aside}</div> : null}
      </div>
    </section>
  );
}

function HeroStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-border/70 bg-background/35 p-4">
      <p className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
        {label}
      </p>
      <p className="mt-2 text-2xl font-semibold tracking-tight">{value}</p>
    </div>
  );
}

function FeatureTile({
  icon,
  title,
  description,
}: {
  icon: ReactNode;
  title: string;
  description: string;
}) {
  return (
    <div className="rounded-2xl border border-border/70 bg-background/35 p-4">
      <div className="inline-flex rounded-xl border border-primary/20 bg-primary/10 p-2 text-primary">
        {icon}
      </div>
      <p className="mt-4 font-semibold">{title}</p>
      <p className="mt-2 text-sm text-muted-foreground">{description}</p>
    </div>
  );
}

function SectionKicker({ children }: { children: ReactNode }) {
  return (
    <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-primary">
      {children}
    </p>
  );
}

function MetricCard({
  kicker,
  value,
  label,
  meta,
}: {
  kicker: string;
  value: string;
  label: string;
  meta: string;
}) {
  return (
    <Card className="h-full">
      <CardContent className="flex h-full flex-col justify-between p-6">
        <div>
          <p className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
            {kicker}
          </p>
          <div className="mt-5 text-4xl font-semibold tracking-tight sm:text-5xl">
            {value}
          </div>
        </div>
        <div className="mt-6">
          <p className="text-base font-medium">{label}</p>
          <p className="mt-2 text-sm text-muted-foreground">{meta}</p>
        </div>
      </CardContent>
    </Card>
  );
}

function StatRow({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "success" | "warning" | "destructive";
}) {
  return (
    <div className="flex items-center justify-between rounded-2xl border border-border/60 bg-background/30 px-4 py-3">
      <div className="flex items-center gap-3">
        <div
          className={cn(
            "h-2.5 w-2.5 rounded-full",
            tone === "success" && "bg-emerald-400",
            tone === "warning" && "bg-amber-400",
            tone === "destructive" && "bg-rose-400",
          )}
        />
        <span className="text-sm text-muted-foreground">{label}</span>
      </div>
      <span className="font-semibold">{value}</span>
    </div>
  );
}

function HealthMixBar({
  active,
  disabled,
  revoked,
  total,
  compact = false,
}: {
  active: number;
  disabled: number;
  revoked: number;
  total: number;
  compact?: boolean;
}) {
  const safeTotal = total || 1;
  const activeWidth = `${(active / safeTotal) * 100}%`;
  const disabledWidth = `${(disabled / safeTotal) * 100}%`;
  const revokedWidth = `${(revoked / safeTotal) * 100}%`;

  return (
    <div className="space-y-2">
      <div
        className={cn(
          "flex overflow-hidden rounded-full bg-muted/50",
          compact ? "h-2.5" : "h-3",
        )}
      >
        <div className="bg-emerald-400" style={{ width: activeWidth }} />
        <div className="bg-amber-400" style={{ width: disabledWidth }} />
        <div className="bg-rose-400" style={{ width: revokedWidth }} />
      </div>
      <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
        <span>{active} active</span>
        <span>{disabled} disabled</span>
        <span>{revoked} revoked</span>
      </div>
    </div>
  );
}

function LoadingPanel({
  label,
  compact = false,
}: {
  label: string;
  compact?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex items-center justify-center rounded-3xl border border-dashed border-border/70 bg-background/20 px-6 py-12 text-muted-foreground",
        compact && "py-8",
      )}
    >
      <div className="flex items-center gap-3">
        <LoaderCircle className="h-5 w-5 animate-spin text-primary" />
        <span>{label}</span>
      </div>
    </div>
  );
}

function EmptyState({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="rounded-3xl border border-dashed border-border/70 bg-background/20 px-6 py-10 text-center">
      <p className="text-lg font-semibold">{title}</p>
      <p className="mx-auto mt-2 max-w-2xl text-sm text-muted-foreground">
        {description}
      </p>
    </div>
  );
}

function InlineAlert({
  tone,
  title,
  message,
}: {
  tone: "error" | "success" | "warning";
  title: string;
  message: string;
}) {
  return (
    <div
      className={cn(
        "rounded-3xl border px-5 py-4",
        tone === "error" && "border-destructive/30 bg-destructive/10",
        tone === "success" && "border-success/30 bg-success/10",
        tone === "warning" && "border-warning/30 bg-warning/10",
      )}
    >
      <div className="flex items-start gap-3">
        <div
          className={cn(
            "mt-0.5 rounded-full p-2",
            tone === "error" && "bg-destructive/15 text-destructive",
            tone === "success" && "bg-success/15 text-success-foreground",
            tone === "warning" && "bg-warning/15 text-warning-foreground",
          )}
        >
          {tone === "success" ? (
            <ShieldCheck className="h-4 w-4" />
          ) : tone === "warning" ? (
            <AlertTriangle className="h-4 w-4" />
          ) : (
            <Activity className="h-4 w-4" />
          )}
        </div>
        <div>
          <p className="font-semibold">{title}</p>
          <p className="mt-1 text-sm text-muted-foreground">{message}</p>
        </div>
      </div>
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
    <div className="space-y-2">
      <Label>{label}</Label>
      {input}
    </div>
  );
}

function Field({
  label,
  hint,
  input,
}: {
  label: string;
  hint?: string;
  input: ReactNode;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <Label>{label}</Label>
        {hint ? <span className="text-xs text-muted-foreground">{hint}</span> : null}
      </div>
      {input}
    </div>
  );
}

function SettingsNumberCard({
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
    <Card className="border-border/70 bg-background/25">
      <CardContent className="space-y-3 p-5">
        <Label htmlFor={id}>{label}</Label>
        <Input
          id={id}
          type="number"
          value={value}
          onChange={(event) => onChange(Number(event.target.value || 0))}
        />
        <p className="text-sm text-muted-foreground">{description}</p>
      </CardContent>
    </Card>
  );
}

function PaginationBar({
  page,
  count,
  hasMore,
  onPrevious,
  onNext,
}: {
  page: number;
  count: number;
  hasMore: boolean;
  onPrevious: () => void;
  onNext: () => void;
}) {
  const from = count ? page * PAGE_SIZE + 1 : 0;
  const to = page * PAGE_SIZE + count;

  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-border/70 bg-background/20 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="text-sm text-muted-foreground">
        Page {page + 1} · Showing {from}-{to}
      </div>
      <div className="flex gap-2">
        <Button variant="outline" size="sm" onClick={onPrevious} disabled={page === 0}>
          Previous
        </Button>
        <Button variant="outline" size="sm" onClick={onNext} disabled={!hasMore}>
          Next
        </Button>
      </div>
    </div>
  );
}

function providerKeyDescription(key: ProviderKey) {
  if (key.status === "revoked") {
    return "Revoked keys are blocked from re-entry and must be replaced.";
  }

  if (key.enabled) {
    return "This key is currently eligible to receive traffic.";
  }

  return "This key is held out of rotation until you re-enable it.";
}

function statusVariant(status: string) {
  if (status === "active" || status === "success") {
    return "success" as const;
  }

  if (status === "disabled") {
    return "warning" as const;
  }

  if (status === "revoked" || status === "error") {
    return "destructive" as const;
  }

  return "outline" as const;
}

function capitalize(value: string) {
  if (!value) {
    return value;
  }

  return value.charAt(0).toUpperCase() + value.slice(1);
}

function summarizeNames(names: string[], max = 2) {
  if (names.length <= max) {
    return names.join(", ");
  }

  return `${names.slice(0, max).join(", ")} and ${names.length - max} more`;
}

function isPatExpiringSoon(pat: PatRecord) {
  if (!pat.expiresAt) {
    return false;
  }

  const expiresAt = new Date(pat.expiresAt).getTime();
  const now = Date.now();
  return expiresAt >= now && expiresAt <= now + 7 * 24 * 60 * 60 * 1000;
}

function extractErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }

  return "Unexpected error";
}

async function copyToClipboard(value: string) {
  try {
    await navigator.clipboard.writeText(value);
    toast.success("Copied to clipboard");
  } catch {
    toast.error("Failed to copy");
  }
}
