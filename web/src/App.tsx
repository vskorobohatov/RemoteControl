import type { ReactNode } from "react";
import { Navigate, Route, Routes } from "react-router";
import { AppShell } from "./components/AppShell";
import { AuthGate } from "./components/AuthGate";
import { useRemoteControlContext } from "./context/RemoteControlProvider";
import { DashboardPage } from "./pages/DashboardPage";
import { SettingsPage } from "./pages/SettingsPage";
import { UsersPage } from "./pages/UsersPage";
import type { Permission } from "../../src/types";

/**
 * A route the signed-in role may not use is not an error page, it is simply not there:
 * the server would refuse it anyway, and the nav never offered it in the first place.
 */
function RequirePermission({ permission, children }: { permission: Permission; children: ReactNode }) {
  const rc = useRemoteControlContext();
  return rc.can(permission) ? <>{children}</> : <Navigate to="/" replace />;
}

export function App() {
  const rc = useRemoteControlContext();

  if (rc.session === null) {
    return (
      <AuthGate
        mode={rc.needsBootstrap ? "bootstrap" : "login"}
        error={rc.status === "offline" ? rc.error : null}
        onSubmit={rc.needsBootstrap ? rc.createFirstAccount : rc.signIn}
        onRetry={rc.reconnect}
      />
    );
  }

  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<DashboardPage />} />
        <Route
          path="settings"
          element={
            <RequirePermission permission="update:view">
              <SettingsPage />
            </RequirePermission>
          }
        />
        <Route
          path="users"
          element={
            <RequirePermission permission="users:manage">
              <UsersPage />
            </RequirePermission>
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}

