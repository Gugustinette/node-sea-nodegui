import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import { createWriteStream } from "node:fs";
import * as http from "node:http";
import * as https from "node:https";
import * as os from "node:os";
import * as path from "node:path";
import { pipeline } from "node:stream/promises";

const QODE_VERSION = "24.12.0-rc18";
const MAX_REDIRECTS = 5;
const SEA_RELAUNCH_ASSET_KEY = "node-sea-nodegui:relaunch-main";
const SEA_ASSET_PREFIX = "node-sea-nodegui:asset:";
const EXTRACTED_ASSETS_ENV = "NODEGUI_EXTRACTED_ASSETS";

function isRunningWithQode(): boolean {
  const execName = path.basename(process.execPath).toLowerCase();
  return execName === "qode" || execName === "qode.exe" || Boolean((process.versions as Record<string, string>).qode);
}

function qodeExecutableName(): string {
  return process.platform === "win32" ? "qode.exe" : "qode";
}

function qodeDownloadLink(): string {
  const tag = `v${QODE_VERSION}-qode`;
  const archive = `${tag}-${process.platform}-${process.arch}.tar.gz`;
  return process.env.QODE_MIRROR || `https://github.com/nodegui/qodejs/releases/download/${tag}/${archive}`;
}

function qodeInstallDir(): string {
  // Keep Qode in the user cache so dist/ can run from any location.
  return path.join(os.homedir(), ".cache", "node-sea-nodegui", "qode", QODE_VERSION);
}

function qodeBinaryPath(): string {
  return path.join(qodeInstallDir(), qodeExecutableName());
}

function extractRelaunchEntryFromSeaAsset(): string | undefined {
  const getBuiltinModule = (process as { getBuiltinModule?: (id: string) => unknown }).getBuiltinModule;
  if (typeof getBuiltinModule !== "function") {
    return undefined;
  }

  try {
    const sea = getBuiltinModule("node:sea") as {
      isSea?: () => boolean;
      getAsset?: (key: string, encoding: BufferEncoding) => string;
    };
    if (!sea?.isSea?.() || typeof sea.getAsset !== "function") {
      return undefined;
    }

    const source = sea.getAsset(SEA_RELAUNCH_ASSET_KEY, "utf8");
    if (!source) {
      return undefined;
    }

    const hash = createHash("sha256").update(source).digest("hex").slice(0, 16);
    const outDir = path.join(qodeInstallDir(), "relaunch");
    const outPath = path.join(outDir, `main-${hash}.cjs`);
    fs.mkdirSync(outDir, { recursive: true });
    if (!fs.existsSync(outPath)) {
      fs.writeFileSync(outPath, source, "utf8");
    }

    return outPath;
  } catch {
    return undefined;
  }
}

function normalizeAssetRelativePath(assetRelativePath: string): string {
  return assetRelativePath.replaceAll("\\", "/").replace(/^\/+/, "");
}

function getSeaModule():
  | {
      isSea?: () => boolean;
      getAsset?: (key: string, encoding?: BufferEncoding) => string | ArrayBuffer;
    }
  | undefined {
  const getBuiltinModule = (process as { getBuiltinModule?: (id: string) => unknown }).getBuiltinModule;
  if (typeof getBuiltinModule !== "function") {
    return undefined;
  }

  try {
    return getBuiltinModule("node:sea") as {
      isSea?: () => boolean;
      getAsset?: (key: string, encoding?: BufferEncoding) => string | ArrayBuffer;
    };
  } catch {
    return undefined;
  }
}

function extractBinarySeaAsset(assetRelativePath: string): string | undefined {
  const normalizedRelativePath = normalizeAssetRelativePath(assetRelativePath);
  const sea = getSeaModule();
  if (!sea?.isSea?.() || typeof sea.getAsset !== "function") {
    return undefined;
  }

  const assetKey = `${SEA_ASSET_PREFIX}${normalizedRelativePath}`;

  try {
    const assetData = sea.getAsset(assetKey);
    if (!assetData) {
      return undefined;
    }

    const assetBuffer =
      typeof assetData === "string" ? Buffer.from(assetData, "utf8") : Buffer.from(assetData as ArrayBuffer);

    const hash = createHash("sha256").update(assetBuffer).digest("hex").slice(0, 16);
    const ext = path.extname(normalizedRelativePath);
    const baseName = path.basename(normalizedRelativePath, ext).replace(/[^a-zA-Z0-9._-]/g, "_") || "asset";
    const outDir = path.join(qodeInstallDir(), "assets");
    const outPath = path.join(outDir, `${baseName}-${hash}${ext}`);

    fs.mkdirSync(outDir, { recursive: true });
    if (!fs.existsSync(outPath)) {
      fs.writeFileSync(outPath, assetBuffer);
    }

    return outPath;
  } catch {
    return undefined;
  }
}

function parseExtractedAssetMapFromEnv(): Record<string, string> {
  const raw = process.env[EXTRACTED_ASSETS_ENV];
  if (!raw) {
    return {};
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") {
      return {};
    }

    return Object.fromEntries(
      Object.entries(parsed as Record<string, unknown>).filter((entry): entry is [string, string] => {
        return typeof entry[0] === "string" && typeof entry[1] === "string";
      })
    );
  } catch {
    return {};
  }
}

function resolveAssetFromFileSystem(assetRelativePath: string): string | undefined {
  const normalizedRelativePath = normalizeAssetRelativePath(assetRelativePath);
  const distCandidate = path.resolve(__dirname, "..", normalizedRelativePath);
  if (fs.existsSync(distCandidate)) {
    return distCandidate;
  }

  const cwdCandidate = path.resolve(process.cwd(), normalizedRelativePath);
  if (fs.existsSync(cwdCandidate)) {
    return cwdCandidate;
  }

  return undefined;
}

function buildExtractedAssetMap(requiredAssetPaths: readonly string[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (const assetPath of requiredAssetPaths) {
    const normalized = normalizeAssetRelativePath(assetPath);
    const extracted = extractBinarySeaAsset(normalized);
    if (extracted) {
      result[normalized] = extracted;
    }
  }

  return result;
}

export function resolveBundledAssetPath(assetRelativePath: string): string {
  const normalizedRelativePath = normalizeAssetRelativePath(assetRelativePath);

  const extractedMap = parseExtractedAssetMapFromEnv();
  const forwardedPath = extractedMap[normalizedRelativePath];
  if (forwardedPath && fs.existsSync(forwardedPath)) {
    return forwardedPath;
  }

  const fileSystemPath = resolveAssetFromFileSystem(normalizedRelativePath);
  if (fileSystemPath) {
    return fileSystemPath;
  }

  const extractedFromSea = extractBinarySeaAsset(normalizedRelativePath);
  if (extractedFromSea) {
    return extractedFromSea;
  }

  return path.resolve(__dirname, "..", normalizedRelativePath);
}

function requestWithRedirects(url: string, redirectsLeft: number = MAX_REDIRECTS): Promise<http.IncomingMessage> {
  return new Promise((resolve, reject) => {
    const client = url.startsWith("https:") ? https : http;
    const req = client.get(url, (res) => {
      const status = res.statusCode ?? 0;

      if (status >= 300 && status < 400 && res.headers.location) {
        res.resume();
        if (redirectsLeft <= 0) {
          reject(new Error(`Too many redirects while downloading Qode from ${url}`));
          return;
        }

        const redirectedUrl = new URL(res.headers.location, url).toString();
        resolve(requestWithRedirects(redirectedUrl, redirectsLeft - 1));
        return;
      }

      if (status < 200 || status >= 300) {
        res.resume();
        reject(new Error(`Failed to download Qode archive: HTTP ${status} from ${url}`));
        return;
      }

      resolve(res);
    });

    req.on("error", reject);
  });
}

async function downloadFile(url: string, outputPath: string): Promise<void> {
  await fs.promises.mkdir(path.dirname(outputPath), { recursive: true });
  if (fs.existsSync(outputPath)) {
    return;
  }

  const response = await requestWithRedirects(url);
  await pipeline(response, createWriteStream(outputPath));
}

async function extractTarGz(archivePath: string, outputDir: string): Promise<void> {
  await fs.promises.mkdir(outputDir, { recursive: true });

  const result = spawnSync("tar", ["-xzf", archivePath, "-C", outputDir], { stdio: "inherit" });
  if (result.status !== 0) {
    throw new Error(`tar extraction failed with exit code ${result.status ?? "unknown"}`);
  }
}

async function ensureQodeBinary(): Promise<string> {
  const binaryPath = qodeBinaryPath();
  if (fs.existsSync(binaryPath)) {
    return binaryPath;
  }

  const archivePath = path.join(qodeInstallDir(), path.basename(qodeDownloadLink()));
  console.log(`Downloading Qode to ${archivePath} ...`);
  await downloadFile(qodeDownloadLink(), archivePath);
  console.log(`Extracting Qode to ${qodeInstallDir()} ...`);
  await extractTarGz(archivePath, qodeInstallDir());
  fs.chmodSync(binaryPath, 0o775);
  return binaryPath;
}

function resolveRelaunchEntryFile(): string {
  const explicitEntry = process.env.NODEGUI_RELAUNCH_ENTRY;
  if (explicitEntry) {
    return explicitEntry;
  }

  const scriptLikeExt = new Set([".js", ".cjs", ".mjs"]);
  if (scriptLikeExt.has(path.extname(__filename)) && fs.existsSync(__filename)) {
    return __filename;
  }

  const seaEmbeddedEntry = extractRelaunchEntryFromSeaAsset();
  if (seaEmbeddedEntry) {
    return seaEmbeddedEntry;
  }

  const candidateFromExec = `${process.execPath}.cjs`;
  if (fs.existsSync(candidateFromExec)) {
    return candidateFromExec;
  }

  const candidateMainCjs = path.join(path.dirname(process.execPath), "main.cjs");
  if (fs.existsSync(candidateMainCjs)) {
    return candidateMainCjs;
  }

  return __filename;
}

function getForwardedUserArgs(): string[] {
  // In script mode argv[1] is the script path. In SEA/exe mode there is no script argument.
  if (process.argv[1] === __filename) {
    return process.argv.slice(2);
  }

  return process.argv.slice(1);
}

export async function ensureQodeAndRelaunch(requiredAssetPaths: readonly string[] = []): Promise<void> {
  if (isRunningWithQode() || process.env.NODEGUI_QODE_BOOTSTRAPPED === "1") {
    return;
  }

  const qodePath = await ensureQodeBinary();
  const extractedAssets = buildExtractedAssetMap(requiredAssetPaths);
  const env = { ...process.env, NODEGUI_QODE_BOOTSTRAPPED: "1" };
  if (Object.keys(extractedAssets).length > 0) {
    env[EXTRACTED_ASSETS_ENV] = JSON.stringify(extractedAssets);
  }

  const relaunchEntry = resolveRelaunchEntryFile();
  const args = [...process.execArgv, relaunchEntry, ...getForwardedUserArgs()];
  const relaunched = spawnSync(qodePath, args, { stdio: "inherit", env });

  process.exit(relaunched.status ?? 0);
}
