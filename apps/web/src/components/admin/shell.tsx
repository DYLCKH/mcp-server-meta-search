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
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Sheet,
  SheetContent,
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
      <CardHeader className="gap-2 border-b bg-muted/20 p-3">
        <div className="flex items-center justify-between gap-2">
          <Badge variant="secondary" className="w-fit">
            Meta Search
          </Badge>
          <Badge variant="outline">Admin</Badge>
        </div>
        <CardTitle className="text-base">Control Center</CardTitle>
      </CardHeader>

      <CardContent className="flex flex-1 flex-col gap-3 p-2">
        <nav className="space-y-1">
          {NAV_ITEMS.map((item) => {
            const Icon = ICONS[item.path as keyof typeof ICONS];

            return (
              <NavLink
                key={item.path}
                to={item.path}
                end={item.path === "/"}
                className={({ isActive }) =>
                  cn(
                    "group flex items-center gap-2 rounded-md border px-2.5 py-2 text-sm transition-colors",
                    isActive
                      ? "border-primary/20 bg-primary/5 text-foreground"
                      : "border-transparent text-muted-foreground hover:border-border hover:bg-muted/50 hover:text-foreground",
                  )
                }
              >
                {({ isActive }) => (
                  <>
                    <div
                      className={cn(
                        "rounded border p-1",
                        isActive
                          ? "border-primary/20 bg-primary/10 text-primary"
                          : "border-border bg-background text-muted-foreground group-hover:text-foreground",
                      )}
                    >
                      <Icon className="h-4 w-4" />
                    </div>
                    <span className="truncate font-medium">{item.label}</span>
                    <Badge variant="outline" className="ml-auto">
                      {item.shortLabel}
                    </Badge>
                  </>
                )}
              </NavLink>
            );
          })}
        </nav>

        <div className="mt-auto flex flex-col gap-2">
          <ThemeToggle className="w-full" />
          <Button variant="outline" size="sm" className="w-full" onClick={onLogout}>
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
          <header className="sticky top-3 z-20 mb-3">
            <Card className="border-border/80 bg-background/95 backdrop-blur">
              <CardContent className="flex items-center gap-3 p-3">
                <Button
                  variant="outline"
                  size="icon"
                  className="lg:hidden"
                  onClick={() => setNavOpen(true)}
                >
                  <Menu className="h-4 w-4" />
                  <span className="sr-only">Open navigation</span>
                </Button>
                <div className="flex min-w-0 flex-1 items-center gap-2">
                  <Badge variant="secondary">Admin</Badge>
                  <Badge variant="outline">{meta.shortLabel}</Badge>
                  <h1 className="truncate text-base font-semibold tracking-tight md:text-lg">
                    {meta.label}
                  </h1>
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
          </SheetHeader>
          <div className="mt-4 h-[calc(100%-2rem)]">{navContent}</div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
