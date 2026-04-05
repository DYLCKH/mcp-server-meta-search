import { useEffect, useState } from "react";
import {
  KeyRound,
  LayoutDashboard,
  LockKeyhole,
  Logs,
  Menu,
  Settings2,
} from "lucide-react";
import { NavLink, Outlet, useLocation } from "react-router-dom";

import type { NavItem } from "@/lib/admin";
import { NAV_ITEMS } from "@/lib/admin";
import { cn } from "@/lib/utils";
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
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";

const ICONS = {
  "/": LayoutDashboard,
  "/providers": KeyRound,
  "/pats": LockKeyhole,
  "/settings": Settings2,
  "/logs": Logs,
} as const;

export function AppShell({
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

  const navContent = (
    <Card className="flex h-full flex-col overflow-hidden border-border/80 bg-card/95">
      <CardHeader className="gap-3 border-b bg-muted/20">
        <div className="flex items-center justify-between gap-3">
          <Badge variant="secondary" className="w-fit">
            Meta Search
          </Badge>
          <Badge variant="outline">Admin</Badge>
        </div>
        <div className="space-y-1.5">
          <CardTitle>Control Center</CardTitle>
          <CardDescription className="leading-6">
            更紧凑的运维控制台，把高频动作压缩到单层工作区里。
          </CardDescription>
        </div>
      </CardHeader>

      <CardContent className="flex flex-1 flex-col gap-4 p-3">
        <div className="space-y-2">
          <p className="px-2 text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
            Workspaces
          </p>
          <nav className="space-y-1.5">
            {NAV_ITEMS.map((item) => {
              const Icon = ICONS[item.path];

              return (
                <NavLink
                  key={item.path}
                  to={item.path}
                  end={item.path === "/"}
                  className={({ isActive }) =>
                    cn(
                      "group flex items-center gap-3 rounded-lg border px-3 py-2.5 text-sm transition-colors",
                      isActive
                        ? "border-primary/20 bg-primary/5 text-foreground shadow-sm"
                        : "border-transparent text-muted-foreground hover:border-border hover:bg-muted/50 hover:text-foreground",
                    )
                  }
                >
                  {({ isActive }) => (
                    <>
                      <div className="flex min-w-0 flex-1 items-center gap-3">
                        <div
                          className={cn(
                            "rounded-md border p-1.5",
                            isActive
                              ? "border-primary/20 bg-primary/10 text-primary"
                              : "border-border bg-background text-muted-foreground group-hover:text-foreground",
                          )}
                        >
                          <Icon className="h-4 w-4" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <div className="truncate font-medium">{item.label}</div>
                            <Badge variant="outline" className="hidden xl:inline-flex">
                              {item.shortLabel}
                            </Badge>
                          </div>
                          <div className="mt-0.5 truncate text-xs text-muted-foreground">
                            {item.description}
                          </div>
                        </div>
                      </div>
                      <Badge variant={isActive ? "secondary" : "outline"} className="lg:hidden">
                        {item.shortLabel}
                      </Badge>
                    </>
                  )}
                </NavLink>
              );
            })}
          </nav>
        </div>

        <div className="mt-auto space-y-3 rounded-lg border bg-muted/20 p-3">
          <div className="space-y-1">
            <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
              Current view
            </p>
            <p className="text-sm font-medium">{meta.label}</p>
            <p className="text-sm leading-6 text-muted-foreground">
              {meta.description}
            </p>
          </div>
          <ThemeToggle className="w-full" />
          <Button variant="outline" className="w-full" onClick={onLogout}>
            Sign out
          </Button>
        </div>
      </CardContent>
    </Card>
  );

  return (
    <div className="min-h-screen">
      <div className="mx-auto flex max-w-[1680px] gap-4 px-3 py-3 lg:px-4">
        <aside className="hidden w-72 shrink-0 lg:block">
          <div className="sticky top-3 h-[calc(100vh-1.5rem)]">{navContent}</div>
        </aside>

        <div className="min-w-0 flex-1">
          <header className="sticky top-3 z-20 mb-4">
            <Card className="border-border/80 bg-background/95 backdrop-blur">
              <CardContent className="flex items-start gap-3 p-3 md:p-4">
                <Button
                  variant="outline"
                  size="icon"
                  className="lg:hidden"
                  onClick={() => setNavOpen(true)}
                >
                  <Menu className="h-4 w-4" />
                  <span className="sr-only">Open navigation</span>
                </Button>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="secondary">Admin console</Badge>
                    <Badge variant="outline">{meta.shortLabel}</Badge>
                  </div>
                  <h1 className="mt-2 truncate text-xl font-semibold tracking-tight md:text-2xl">
                    {meta.label}
                  </h1>
                  <p className="mt-1 max-w-3xl text-sm leading-6 text-muted-foreground">
                    {meta.description}
                  </p>
                </div>
                <ThemeToggle />
              </CardContent>
            </Card>
          </header>

          <main className="pb-8">
            <Outlet />
          </main>
        </div>
      </div>

      <Sheet open={navOpen} onOpenChange={setNavOpen}>
        <SheetContent side="left" className="w-[min(22rem,100vw)] overflow-y-auto border-r">
          <SheetHeader>
            <SheetTitle>Navigation</SheetTitle>
            <SheetDescription>切换到对应工作区继续操作。</SheetDescription>
          </SheetHeader>
          <div className="mt-4 h-[calc(100%-2rem)]">{navContent}</div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
