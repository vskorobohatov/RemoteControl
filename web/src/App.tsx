import { Navigate, Route, Routes } from "react-router";
import { AppShell } from "./components/AppShell";
import { TokenGate } from "./components/TokenGate";
import { useRemoteControlContext } from "./context/RemoteControlProvider";
import { DashboardPage } from "./pages/DashboardPage";
import { SettingsPage } from "./pages/SettingsPage";

export function App() {
  const rc = useRemoteControlContext();

  if (rc.status === "needs-token") {
    return <TokenGate onSubmit={rc.provideToken} />;
  }

  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<DashboardPage />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}

