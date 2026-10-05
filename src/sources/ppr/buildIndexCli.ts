#!/usr/bin/env node
import { createContext } from "../../gateway/context.js";
import { buildPprIndex, defaultYears } from "./build.js";
import { pprIndexStoreFromEnv } from "./indexStore.js";

const ctx = createContext();
const years = process.argv.slice(2).map(Number).filter((y) => y >= 2010);
const index = await buildPprIndex(ctx, pprIndexStoreFromEnv(), years.length ? years : defaultYears(ctx.now()));
console.log(`PPR index built: ${index.rows.length} sales for ${index.years.join(", ")}`);
