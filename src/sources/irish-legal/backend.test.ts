import { beforeEach, describe, expect, it, vi } from "vitest";
import { legalRepositoryFromEnv } from "./backend.js";

const azure = vi.hoisted(() => ({
  credentials: [] as object[],
  services: [] as { url: string; credential: object }[],
  containers: [] as { url: string; name: string }[],
  objects: new Map<string, { text: string; etag: string }>()
}));

vi.mock("@azure/identity", () => ({
  DefaultAzureCredential: class {
    constructor() { azure.credentials.push(this); }
  }
}));

vi.mock("@azure/storage-blob", () => ({
  BlobServiceClient: class {
    constructor(readonly url: string, credential: object) { azure.services.push({ url, credential }); }
    getContainerClient(name: string) {
      azure.containers.push({ url: this.url, name });
      const prefix = `${this.url}/${name}/`;
      return {
        async createIfNotExists() {},
        getBlockBlobClient(key: string) {
          return {
            async download() {
              const stored = azure.objects.get(prefix + key);
              if (!stored) throw Object.assign(new Error("Not found."), { statusCode: 404 });
              return { etag: stored.etag, readableStreamBody: (async function* () { yield Buffer.from(stored.text); })() };
            },
            async uploadData(bytes: Buffer) {
              azure.objects.set(prefix + key, { text: bytes.toString("utf8"), etag: `revision-${azure.objects.size}` });
            }
          };
        }
      };
    }
  }
}));

beforeEach(() => {
  azure.credentials.length = 0;
  azure.services.length = 0;
  azure.containers.length = 0;
  azure.objects.clear();
});

describe("Irish legal Azure repository client reuse", () => {
  it("creates Azure clients lazily and shares them across concurrent reads and later writes", async () => {
    const repository = legalRepositoryFromEnv({ LEGAL_STORAGE_ACCOUNT: "legaltest", LEGAL_BLOB_CONTAINER: "legal-corpus" });
    expect(azure.credentials).toHaveLength(0);
    expect(azure.services).toHaveLength(0);
    const statuses = await Promise.all(Array.from({ length: 4 }, () => repository.status()));
    expect(statuses.map(status => status.document_count)).toEqual([0, 0, 0, 0]);
    await repository.noteFailure("citizens-info", "https://www.citizensinformation.ie/en/employment/annual-leave/", {
      checked_at: "2026-10-11T10:00:00.000Z", reason: "Source unavailable."
    });
    expect((await repository.status()).sources).toMatchObject({ "citizens-info": { last_error: "Source unavailable." } });
    expect(azure.credentials).toHaveLength(1);
    expect(azure.services).toEqual([{ url: "https://legaltest.blob.core.windows.net", credential: azure.credentials[0] }]);
    expect(azure.containers).toEqual([{ url: "https://legaltest.blob.core.windows.net", name: "legal-corpus" }]);
  });

  it("keeps the cached container client scoped to its repository instance", async () => {
    const first = legalRepositoryFromEnv({ LEGAL_STORAGE_ACCOUNT: "legalone", LEGAL_BLOB_CONTAINER: "first-corpus" });
    const second = legalRepositoryFromEnv({ LEGAL_STORAGE_ACCOUNT: "legaltwo", LEGAL_BLOB_CONTAINER: "second-corpus" });
    await first.noteFailure("citizens-info", "https://www.citizensinformation.ie/en/employment/annual-leave/", {
      checked_at: "2026-10-11T10:00:00.000Z", reason: "First repository failure."
    });
    expect((await first.status()).sources).toHaveProperty("citizens-info");
    expect((await second.status()).sources).toEqual({});
    expect(azure.credentials).toHaveLength(2);
    expect(azure.containers).toEqual([
      { url: "https://legalone.blob.core.windows.net", name: "first-corpus" },
      { url: "https://legaltwo.blob.core.windows.net", name: "second-corpus" }
    ]);
  });
});
