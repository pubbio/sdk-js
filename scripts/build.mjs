import { rm } from "node:fs/promises";
import { build } from "tsup";

await rm(new URL("../dist", import.meta.url), { recursive: true, force: true });
const common = { outDir: "dist", target: "es2022", sourcemap: true, splitting: false };
await build({ ...common, entry: ["src/index.ts"], platform: "browser", format: ["esm", "cjs"], dts: true });
await build({ ...common, entry: ["src/server.ts"], platform: "node", format: ["esm", "cjs"], dts: true });
await build({ ...common, entry: { "pubb.min": "src/index.ts" }, platform: "browser", format: ["iife"], globalName: "Pubb", minify: true });
