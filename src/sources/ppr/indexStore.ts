import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";
import type { SaleRow } from "./parse.js";

export interface PprIndex {
  built_at: string;
  years: number[];
  rows: SaleRow[];
}

/** Where the nightly-built index lives: Blob Storage in Azure, a local file elsewhere. */
export interface PprIndexStore {
  read(): Promise<PprIndex | undefined>;
  write(index: PprIndex): Promise<void>;
}

export const encodeIndex = (index: PprIndex) => gzipSync(Buffer.from(JSON.stringify(index), "utf8"));
export const decodeIndex = (bytes: Uint8Array) => JSON.parse(gunzipSync(bytes).toString("utf8")) as PprIndex;

export class MemoryIndexStore implements PprIndexStore {
  constructor(private index?: PprIndex) {}
  async read() {
    return this.index;
  }
  async write(index: PprIndex) {
    this.index = index;
  }
}

export class FileIndexStore implements PprIndexStore {
  constructor(private readonly path: string) {}
  async read() {
    try {
      return decodeIndex(await readFile(this.path));
    } catch {
      return undefined;
    }
  }
  async write(index: PprIndex) {
    await mkdir(dirname(this.path), { recursive: true });
    await writeFile(this.path, encodeIndex(index));
  }
}

export class BlobIndexStore implements PprIndexStore {
  constructor(
    private readonly accountName: string,
    private readonly container = "ppr",
    private readonly blobName = "index-v1.json.gz"
  ) {}

  private async client() {
    const [{ BlobServiceClient }, { DefaultAzureCredential }] = await Promise.all([import("@azure/storage-blob"), import("@azure/identity")]);
    const service = new BlobServiceClient(`https://${this.accountName}.blob.core.windows.net`, new DefaultAzureCredential());
    return service.getContainerClient(this.container);
  }

  async read() {
    try {
      const blob = (await this.client()).getBlockBlobClient(this.blobName);
      return decodeIndex(await blob.downloadToBuffer());
    } catch {
      return undefined;
    }
  }

  async write(index: PprIndex) {
    const container = await this.client();
    await container.createIfNotExists();
    const bytes = encodeIndex(index);
    await container.getBlockBlobClient(this.blobName).uploadData(bytes, { blobHTTPHeaders: { blobContentType: "application/gzip" } });
  }
}

export function pprIndexStoreFromEnv(env: Record<string, string | undefined> = process.env): PprIndexStore {
  if (env.AzureWebJobsStorage__accountName) return new BlobIndexStore(env.AzureWebJobsStorage__accountName, env.PPR_CONTAINER ?? "ppr");
  return new FileIndexStore(env.PPR_INDEX_PATH ?? join(process.cwd(), ".ppr-cache", "index-v1.json.gz"));
}
