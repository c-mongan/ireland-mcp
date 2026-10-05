import { app, type InvocationContext, type Timer } from "@azure/functions";
import { createContext } from "../gateway/context.js";
import { buildPprIndex, defaultYears } from "../sources/ppr/build.js";
import { pprIndexStoreFromEnv } from "../sources/ppr/indexStore.js";

/** Rebuilds the national Property Price Register index nightly (03:15 UTC) into Blob Storage. */
export async function pprTimerHandler(_timer: Timer, invocation: InvocationContext): Promise<void> {
  const ctx = createContext();
  const index = await buildPprIndex(ctx, pprIndexStoreFromEnv(), defaultYears(ctx.now()));
  invocation.log(`PPR index built: ${index.rows.length} sales for ${index.years.join(", ")}`);
}

app.timer("pprIndex", { schedule: "0 15 3 * * *", runOnStartup: false, handler: pprTimerHandler });
