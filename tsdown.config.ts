import { defineConfig } from "tsdown";

export default defineConfig({
  entry: "src/main.ts",
  outDir: "dist",
  platform: "node",
  format: "cjs",
  deps: {
    // alwaysBundle: ["@nodegui/nodegui"]
  },
  // exe: true,
  clean: true,
});
