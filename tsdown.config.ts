import { defineConfig } from "tsdown";
import { inlineNativeAddonsPlugin } from "./config/inline-native-addons-plugin.ts";

export default defineConfig({
  entry: "src/main.ts",
  outDir: "dist",
  platform: "node",
  format: "cjs",
  deps: {
    alwaysBundle: ["@nodegui/nodegui"]
  },
  plugins: [inlineNativeAddonsPlugin()],
  exe: true,
  clean: true,
});
