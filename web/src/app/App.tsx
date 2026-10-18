import type { ReactNode } from "react";
import { Navigate, Route, Routes } from "react-router";
import type { Permission } from "@server/types";
import { AuthGate } from "./layouts/AuthGate";
import { AppShell } from "./layouts/AppShell";
import { useRemoteControlContext } from "./providers/RemoteControlContext";
import { DashboardPage } from "@pages/DashboardPage";
import { SettingsPage } from "@pages/SettingsPage";
import { UsersPage } from "@pages/UsersPage";

function RequirePermission({ permission, children }: { permission: Permission; children: ReactNode }) {
  const rc = useRemoteControlContext();
  return rc.can(permission) ? <>{children}</> : <Navigate to="/" replace />;
}

export function App() {
  const rc = useRemoteControlContext();

  if (rc.session === null) {
    return <AuthGate />;
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
