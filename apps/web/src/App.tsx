import { useEffect, useRef, useState } from "react";
import { LoaderCircle } from "lucide-react";
import {
  Navigate,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from "react-router-dom";
import { Toaster } from "sonner";

import { AppShell } from "@/components/admin/shell";
import { NAV_ITEMS, type AuthStatus } from "@/lib/admin";
import {
  UNAUTHORIZED_EVENT,
  UnauthorizedError,
  api,
} from "@/lib/api";
import { Card, CardContent } from "@/components/ui/card";
import { DashboardPage } from "@/pages/dashboard-page";
import { LoginPage } from "@/pages/login-page";
import { LogsPage } from "@/pages/logs-page";
import { PatsPage } from "@/pages/pats-page";
import { ProvidersPage } from "@/pages/providers-page";
import { SettingsPage } from "@/pages/settings-page";

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
        theme="light"
        toastOptions={{
          className: "font-sans",
        }}
      />
    </>
  );
}

function AppLoadingScreen() {
  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <Card className="w-full max-w-md">
        <CardContent className="flex items-center gap-3 p-5">
          <LoaderCircle className="h-5 w-5 animate-spin text-primary" />
          <div>
            <p className="font-medium">Loading admin console</p>
            <p className="text-sm text-muted-foreground">
              Verifying the current session and preparing the UI shell.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
