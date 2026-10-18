import { createContext, useContext, type ReactNode } from "react";
import { useRemoteControl, type RemoteControl } from "../useRemoteControl";

const RemoteControlContext = createContext<RemoteControl | null>(null);

export function RemoteControlProvider({ children }: { children: ReactNode }) {
  return <RemoteControlContext.Provider value={useRemoteControl()}>{children}</RemoteControlContext.Provider>;
}

export function useRemoteControlContext(): RemoteControl {
  const value = useContext(RemoteControlContext);
  if (value === null) {
    throw new Error("useRemoteControlContext must be used inside RemoteControlProvider");
  }
  return value;
}