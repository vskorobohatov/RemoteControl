import type { Db } from "../db/connection.js";

/**
 * A row of the service_keys table. The key itself only ever leaves this module on
 * the way to a scope's environment: no route, log or service state carries it.
 */
export interface StoredApiKey {
  serviceId: string;
  envName: string;
  apiKey: string;
  updatedAt: number;
}

export class ApiKeyStore {
  /* Prepared once per process; the type is inferred from this assignment. */
  private readonly statements;

  public constructor(db: Db) {
    this.statements = {
      get: db.prepare("SELECT env_name, api_key, updated_at FROM service_keys WHERE service_id = ?"),
      insert: db.prepare(
        "INSERT INTO service_keys (service_id, env_name, api_key, updated_at) VALUES (?, ?, ?, ?)",
      ),
      update: db.prepare("UPDATE service_keys SET env_name = ?, api_key = ?, updated_at = ? WHERE service_id = ?"),
      remove: db.prepare("DELETE FROM service_keys WHERE service_id = ?"),
      ids: db.prepare("SELECT service_id FROM service_keys"),
    };
  }

  public get(serviceId: string): StoredApiKey | null {
    const row = this.statements.get.get(serviceId) as
      { env_name: string; api_key: string; updated_at: number } | undefined;
    if (row === undefined) {
      return null;
    }
    return { serviceId, envName: row.env_name, apiKey: row.api_key, updatedAt: row.updated_at };
  }

  /** The one writer of a key: the service that started with it. */
  public set(serviceId: string, envName: string, apiKey: string, now: number = Date.now()): void {
    if (this.get(serviceId) === null) {
      this.statements.insert.run(serviceId, envName, apiKey, now);
      return;
    }
    this.statements.update.run(envName, apiKey, now, serviceId);
  }

  public clear(serviceId: string): boolean {
    return this.statements.remove.run(serviceId).changes > 0;
  }

  /** Keys of services that are no longer in the services file - a renamed service's key is dead. */
  public pruneUnknown(knownServiceIds: readonly string[]): number {
    const known = new Set(knownServiceIds);
    const rows = this.statements.ids.all() as { service_id: string }[];
    let removed = 0;
    for (const row of rows) {
      if (!known.has(row.service_id) && this.clear(row.service_id)) {
        removed += 1;
      }
    }
    return removed;
  }
}
