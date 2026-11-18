import type { ServiceState } from "@server/types";
import { EmptyState } from "@shared/ui/Actions";
import { ServiceCard } from "./ServiceCard";
import styles from "./ServiceList.module.scss";

interface ServiceListProps {
  services: ServiceState[];
  storedKeys: Record<string, string>;
  canControl: boolean;
  canViewLogs: boolean;
  onStart: (id: string, model: string | null, apiKey: string | null) => Promise<void>;
  onStop: (id: string) => Promise<void>;
}

export function ServiceList({ services, storedKeys, canControl, canViewLogs, onStart, onStop }: ServiceListProps) {
  if (services.length === 0) {
    return (
      <EmptyState>
        No services defined. Add entries to <code>config/services.yaml</code> on the remote host.
      </EmptyState>
    );
  }

  return (
    <div className={styles.list}>
      {services.map((service) => (
        <ServiceCard
          key={service.id}
          service={service}
          storedKey={storedKeys[service.id] ?? null}
          canControl={canControl}
          canViewLogs={canViewLogs}
          onStart={onStart}
          onStop={onStop}
        />
      ))}
    </div>
  );
}
