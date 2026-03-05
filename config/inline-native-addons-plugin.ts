import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import * as path from "node:path";
import type { Plugin } from "rolldown";

const VIRTUAL_ID_PREFIX = "\0inline-native-addon:";

function stripQueryAndHash(id: string): string {
  const queryIndex = id.indexOf("?");
  const hashIndex = id.indexOf("#");

  const cutAt = [queryIndex, hashIndex]
    .filter((value) => value >= 0)
    .reduce((min, value) => Math.min(min, value), id.length);

  return id.slice(0, cutAt);
}

function toSafeName(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, "_");
}

export function inlineNativeAddonsPlugin(): Plugin {
  const virtualIdToFilePath = new Map<string, string>();

  return {
    name: "inline-native-addons",

    resolveId(source, importer) {
      const cleanedSource = stripQueryAndHash(source);
      if (!cleanedSource.endsWith(".node")) {
        return null;
      }

      const resolvedPath = path.isAbsolute(cleanedSource)
        ? cleanedSource
        : importer && !importer.startsWith("\0")
          ? path.resolve(path.dirname(importer), cleanedSource)
          : path.resolve(cleanedSource);

      const key = createHash("sha1").update(resolvedPath).digest("hex");
      const virtualId = `${VIRTUAL_ID_PREFIX}${key}`;
      virtualIdToFilePath.set(virtualId, resolvedPath);

      return virtualId;
    },

    load(id) {
      if (!id.startsWith(VIRTUAL_ID_PREFIX)) {
        return null;
      }

      const nativeAddonPath = virtualIdToFilePath.get(id);
      if (!nativeAddonPath) {
        throw new Error(`No native addon path registered for ${id}`);
      }

      const binary = readFileSync(nativeAddonPath);
      const base64Payload = binary.toString("base64");
      const contentHash = createHash("sha256").update(binary).digest("hex").slice(0, 16);
      const extension = path.extname(nativeAddonPath) || ".node";
      const fileStem = toSafeName(path.basename(nativeAddonPath, extension));
      const addonBaseName = path.basename(nativeAddonPath);
      const bundleDirName = `${fileStem}-${contentHash}`;

      return [
        'const fs = require("node:fs");',
        'const os = require("node:os");',
        'const path = require("node:path");',
        "",
        "function resolveMiniQtSourceDir() {",
        "  const candidates = [];",
        '  if (process.env.NODEGUI_MINIQT_PATH) candidates.push(process.env.NODEGUI_MINIQT_PATH);',
        '  candidates.push(path.join(process.cwd(), "node_modules", "@nodegui", "nodegui", "miniqt"));',
        "",
        "  try {",
        '    const pkg = require.resolve("@nodegui/nodegui/package.json");',
        '    candidates.push(path.join(path.dirname(pkg), "miniqt"));',
        "  } catch {}",
        "",
        "  for (const candidate of candidates) {",
        '    if (candidate && fs.existsSync(candidate)) return candidate;',
        "  }",
        "",
        "  return null;",
        "}",
        "",
        "function ensureInlineNativeAddon() {",
        '  const rootDir = path.join(os.tmpdir(), "rolldown-inline-native-addons", ' + JSON.stringify(bundleDirName) + ");",
        "  const addonDir = path.join(rootDir, \"build\", \"Release\");",
        `  const addonPath = path.join(addonDir, ${JSON.stringify(addonBaseName)});`,
        "  const miniqtDir = path.join(rootDir, \"miniqt\");",
        "",
        "  fs.mkdirSync(addonDir, { recursive: true });",
        "",
        "  if (!fs.existsSync(miniqtDir)) {",
        "    const miniqtSourceDir = resolveMiniQtSourceDir();",
        "    if (miniqtSourceDir) {",
        "      try {",
        '        fs.symlinkSync(miniqtSourceDir, miniqtDir, process.platform === "win32" ? "junction" : "dir");',
        "      } catch (error) {",
        '        if (error && error.code === "EEXIST") {',
        "          // Already prepared by a previous run.",
        "        } else {",
        "          fs.cpSync(miniqtSourceDir, miniqtDir, { recursive: true });",
        "        }",
        "      }",
        "    }",
        "  }",
        "",
        "  if (!fs.existsSync(addonPath)) {",
        `    const binary = Buffer.from(${JSON.stringify(base64Payload)}, "base64");`,
        "    fs.writeFileSync(addonPath, binary, { mode: 0o755 });",
        "    if (process.platform !== \"win32\") fs.chmodSync(addonPath, 0o755);",
        "  }",
        "",
        "  return addonPath;",
        "}",
        "",
        "const addon = require(ensureInlineNativeAddon());",
        "module.exports = addon;",
        "module.exports.default = addon;",
        ""
      ].join("\n");
    }
  };
}

export default inlineNativeAddonsPlugin;