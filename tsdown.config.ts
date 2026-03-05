import { defineConfig } from "tsdown";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { inlineNativeAddonsPlugin } from "./config/inline-native-addons-plugin.ts";

const SEA_RELAUNCH_KEY = "node-sea-nodegui:relaunch-main";
const SEA_ASSET_PREFIX = "node-sea-nodegui:asset:";

function collectAssetEntries(assetsDir: string): Record<string, string> {
  const entries: Record<string, string> = {};
  if (!fs.existsSync(assetsDir)) {
    return entries;
  }

  const visit = (currentDir: string): void => {
    for (const dirent of fs.readdirSync(currentDir, { withFileTypes: true })) {
      const absolutePath = path.join(currentDir, dirent.name);

      if (dirent.isDirectory()) {
        visit(absolutePath);
        continue;
      }

      if (!dirent.isFile()) {
        continue;
      }

      const relativePath = path.relative(configDir, absolutePath).split(path.sep).join("/");
      const key = `${SEA_ASSET_PREFIX}${relativePath}`;
      entries[key] = absolutePath;
    }
  };

  visit(assetsDir);

  return entries;
}

const configDir = path.dirname(fileURLToPath(import.meta.url));
const assetsDir = path.join(configDir, "assets");
const seaAssets = {
  [SEA_RELAUNCH_KEY]: path.join(configDir, "dist", "main.cjs"),
  ...collectAssetEntries(assetsDir),
};

export default defineConfig({
  entry: "src/main.ts",
  outDir: "dist",
  platform: "node",
  format: "cjs",
  deps: {
    alwaysBundle: ["@nodegui/nodegui"]
  },
  plugins: [inlineNativeAddonsPlugin()],
  exe: {
    seaConfig: {
      assets: seaAssets
    }
  },
  clean: true,
});
