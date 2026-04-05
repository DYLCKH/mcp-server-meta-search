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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
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
    <div className="flex h-full flex-col gap-6">
      <Card className="shadow-none">
        <CardHeader className="space-y-3">
          <Badge variant="outline" className="w-fit">
            Meta Search
          </Badge>
          <div className="space-y-2">
            <CardTitle className="text-xl">Admin Console</CardTitle>
            <p className="text-sm leading-6 text-muted-foreground">
              更克制的运维界面，把 provider、PAT、策略和日志放回同一套标准组件体系。
            </p>
          </div>
        </CardHeader>
      </Card>

      <Card className="shadow-none">
        <CardContent className="p-3">
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
                      "flex items-center justify-between rounded-xl px-3 py-3 text-sm transition-colors",
                      isActive
                        ? "bg-primary/10 text-foreground"
                        : "text-muted-foreground hover:bg-muted hover:text-foreground",
                    )
                  }
                >
                  {({ isActive }) => (
                    <>
                      <div className="flex items-center gap-3">
                        <div
                          className={cn(
                            "rounded-lg border p-2",
                            isActive
                              ? "border-primary/20 bg-primary/10 text-primary"
                              : "border-border bg-background text-muted-foreground",
                          )}
                        >
                          <Icon className="h-4 w-4" />
                        </div>
                        <div>
                          <div className="font-medium">{item.label}</div>
                          <div className="text-xs text-muted-foreground">
                            {item.shortLabel}
                          </div>
                        </div>
                      </div>
                      <Badge variant={isActive ? "default" : "outline"}>
                        {item.shortLabel}
                      </Badge>
                    </>
                  )}
                </NavLink>
              );
            })}
          </nav>
        </CardContent>
      </Card>

      <div className="mt-auto">
        <Card className="shadow-none">
          <CardContent className="space-y-4 p-4">
            <div className="space-y-1">
              <p className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
                Current view
              </p>
              <p className="text-sm font-medium">{meta.label}</p>
              <p className="text-sm leading-6 text-muted-foreground">
                {meta.description}
              </p>
            </div>
            <Separator />
            <Button variant="outline" className="w-full" onClick={onLogout}>
              Sign out
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen">
      <div className="mx-auto flex max-w-[1600px] gap-6 px-4 py-4 lg:px-6">
        <aside className="hidden w-72 shrink-0 lg:block">
          <div className="sticky top-4 h-[calc(100vh-2rem)]">{navContent}</div>
        </aside>

        <div className="min-w-0 flex-1">
          <header className="sticky top-4 z-20 mb-6">
            <Card className="border-border/80 bg-card/90">
              <CardContent className="flex flex-wrap items-center gap-4 p-4 sm:p-5">
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
                    <Badge>Admin</Badge>
                    <Badge variant="outline">Live configuration</Badge>
                  </div>
                  <h1 className="mt-2 truncate text-2xl font-semibold tracking-tight">
                    {meta.label}
                  </h1>
                  <p className="mt-1 text-sm leading-6 text-muted-foreground">
                    {meta.description}
                  </p>
                </div>
              </CardContent>
            </Card>
          </header>

          <main className="pb-10">
            <Outlet />
          </main>
        </div>
      </div>

      <Sheet open={navOpen} onOpenChange={setNavOpen}>
        <SheetContent side="left" className="w-[min(22rem,100vw)] overflow-y-auto">
          <SheetHeader>
            <SheetTitle>Navigation</SheetTitle>
            <SheetDescription>切换到对应工作区继续操作。</SheetDescription>
          </SheetHeader>
          <div className="mt-6">{navContent}</div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
