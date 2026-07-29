import { defineConfig } from "tsdown";

const ext = () => ({ js: ".js", dts: ".d.ts" });

export default defineConfig([
  {
    entry: { "cli/index": "src/cli/index.ts" },
    format: "esm",
    target: "node22",
    clean: true,
    dts: false,
    sourcemap: false,
    outExtensions: ext,
    banner: { js: "#!/usr/bin/env node" },
  },
  {
    entry: { index: "src/index.ts" },
    format: "esm",
    target: "node22",
    // The sources are on GitHub; a map would double the published size.
    dts: { sourcemap: false },
    sourcemap: false,
    outExtensions: ext,
  },
]);
