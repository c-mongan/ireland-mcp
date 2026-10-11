import { join } from "node:path";
import { FileBackend, ObjectBackend, createRepository } from "../../../packages/irish-legal-mcp/src/store.mjs";
import type { Repository, Generator } from "../../../packages/irish-legal-mcp/src/types.mjs";
import { createAzureGenerator } from "../../../packages/irish-legal-mcp/src/azure-openai.mjs";

/** Only a 404 is an empty store. Authentication failures must reach callers. */
export function legalRepositoryFromEnv(env: Record<string, string | undefined> = process.env): Repository {
  const account = env.LEGAL_STORAGE_ACCOUNT ?? env.AzureWebJobsStorage__accountName;
  if (!account) return createRepository(new FileBackend(env.LEGAL_STORE_DIR ?? join(process.cwd(), ".irish-legal-cache")));
  if (!/^[a-z0-9]{3,24}$/.test(account)) throw new Error("Invalid legal storage account name.");
  const containerName = env.LEGAL_BLOB_CONTAINER ?? "irish-legal";
  if (!/^[a-z0-9](?:[a-z0-9]|-(?=[a-z0-9])){1,61}[a-z0-9]$/.test(containerName)) throw new Error("Invalid legal storage container name.");
  const container = async () => {
    const [{ BlobServiceClient }, { DefaultAzureCredential }] = await Promise.all([import("@azure/storage-blob"), import("@azure/identity")]);
    return new BlobServiceClient(`https://${account}.blob.core.windows.net`, new DefaultAzureCredential()).getContainerClient(containerName);
  };
  return createRepository(new ObjectBackend({
    async get(key) {
      try {
        const blob = (await container()).getBlockBlobClient(key);
        const download = await blob.download();
        const chunks: Buffer[] = [];
        let size = 0;
        for await (const chunk of download.readableStreamBody!) {
          const bytes = Buffer.from(chunk);
          size += bytes.length;
          if (size > 64 * 1024 * 1024) throw new Error("Legal index exceeds the supported size.");
          chunks.push(bytes);
        }
        return { text: Buffer.concat(chunks).toString("utf8"), etag: download.etag! };
      } catch (error) {
        if ((error as { statusCode?: number }).statusCode === 404) return null;
        throw error;
      }
    },
    async put(key, text, conditions) {
      try {
        const client = await container();
        await client.createIfNotExists();
        await client.getBlockBlobClient(key).uploadData(Buffer.from(text), { conditions, blobHTTPHeaders: { blobContentType: key.endsWith(".json") ? "application/json" : "text/plain; charset=utf-8" } });
      } catch (error) {
        if ((error as { statusCode?: number }).statusCode === 412) {
          const conflict = new Error(key === "index.json" ? "CONFLICT: legal index changed; retry refresh." : "Immutable snapshot already exists.") as Error & { code: string };
          conflict.code = key === "index.json" ? "CONFLICT" : "ALREADY_EXISTS";
          throw conflict;
        }
        throw error;
      }
    }
  }));
}

export function legalGeneratorFromEnv(env: Record<string, string | undefined> = process.env): Generator | undefined {
  if (!env.AZURE_OPENAI_ENDPOINT || !env.AZURE_OPENAI_DEPLOYMENT) return undefined;
  return createAzureGenerator({ endpoint: env.AZURE_OPENAI_ENDPOINT, deployment: env.AZURE_OPENAI_DEPLOYMENT,
    ...(env.AZURE_OPENAI_API_KEY ? { apiKey: env.AZURE_OPENAI_API_KEY } : { getToken: async () => {
      const { DefaultAzureCredential } = await import("@azure/identity");
      const token = await new DefaultAzureCredential().getToken("https://cognitiveservices.azure.com/.default");
      if (!token) throw new Error("Azure OpenAI token is unavailable.");
      return token.token;
    } }) });
}
