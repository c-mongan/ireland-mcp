import { createHash } from "node:crypto";
import { TableClient } from "@azure/data-tables";
import type { CacheEntry, PersistentStore } from "./cache.js";

/** Azure Table Storage property limit is 64 KiB of UTF-16; stay well under it. */
const MAX_VALUE_CHARS = 30_000;

export class TableStore implements PersistentStore {
  constructor(private readonly client: TableClient) {}

  async get(key: string): Promise<CacheEntry | undefined> {
    const rowKey = hashKey(key);
    try {
      const entity = await this.client.getEntity<{ value: string; expiresAt: number; storedAt: number }>("c", rowKey);
      return { value: JSON.parse(entity.value), expiresAt: Number(entity.expiresAt), storedAt: Number(entity.storedAt) };
    } catch {
      return undefined;
    }
  }

  async set(key: string, entry: CacheEntry): Promise<void> {
    const value = JSON.stringify(entry.value);
    if (value.length > MAX_VALUE_CHARS) return;
    await this.client.upsertEntity({
      partitionKey: "c",
      rowKey: hashKey(key),
      value,
      expiresAt: entry.expiresAt,
      storedAt: entry.storedAt
    });
  }
}

/** Uses managed identity against the Functions storage account when it is configured. */
export function tableStoreFromEnv(env: NodeJS.ProcessEnv = process.env): PersistentStore | undefined {
  const accountName = env.AzureWebJobsStorage__accountName;
  if (!accountName) return undefined;
  return new LazyTableStore(accountName, env.CACHE_TABLE_NAME ?? "mcpcache");
}

class LazyTableStore implements PersistentStore {
  private inner?: Promise<TableStore>;
  constructor(
    private readonly accountName: string,
    private readonly tableName: string
  ) {}

  private resolve(): Promise<TableStore> {
    this.inner ??= (async () => {
      // Imported lazily so local and stdio runs do not load identity libraries.
      const { DefaultAzureCredential } = await import("@azure/identity");
      const client = new TableClient(
        `https://${this.accountName}.table.core.windows.net`,
        this.tableName,
        new DefaultAzureCredential()
      );
      await client.createTable().catch(() => undefined);
      return new TableStore(client);
    })();
    return this.inner;
  }

  async get(key: string): Promise<CacheEntry | undefined> {
    return (await this.resolve()).get(key);
  }

  async set(key: string, entry: CacheEntry): Promise<void> {
    return (await this.resolve()).set(key, entry);
  }
}

function hashKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}
