import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import { createWriteStream } from "node:fs";
import * as http from "node:http";
import * as https from "node:https";
import * as os from "node:os";
import * as path from "node:path";
import { pipeline } from "node:stream/promises";

const QODE_VERSION = "24.12.0-rc18";
const MAX_REDIRECTS = 5;

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

export async function ensureQodeAndRelaunch(): Promise<void> {
  if (isRunningWithQode() || process.env.NODEGUI_QODE_BOOTSTRAPPED === "1") {
    return;
  }

  const qodePath = await ensureQodeBinary();
  const env = { ...process.env, NODEGUI_QODE_BOOTSTRAPPED: "1" };
  const relaunchEntry = resolveRelaunchEntryFile();
  const args = [...process.execArgv, relaunchEntry, ...getForwardedUserArgs()];
  const relaunched = spawnSync(qodePath, args, { stdio: "inherit", env });

  process.exit(relaunched.status ?? 0);
}
