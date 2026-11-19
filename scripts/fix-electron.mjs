import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";

const require = createRequire(join(resolve("node_modules/electron"), "package.json"));
const electronDir = resolve("node_modules/electron");
const pkg = JSON.parse(readFileSync(join(electronDir, "package.json"), "utf8"));
const version = pkg.version;

const platform = process.platform;
const arch = process.arch;
const platformPath =
  platform === "darwin"
    ? "Electron.app/Contents/MacOS/Electron"
    : platform === "win32"
      ? "electron.exe"
      : "electron";

const { downloadArtifact } = require("@electron/get");
const checksums = require("./checksums.json");

const zipPath = await downloadArtifact({
  version,
  artifactName: "electron",
  checksums,
  platform,
  arch,
});

const distDir = join(electronDir, "dist");
const pathFile = join(electronDir, "path.txt");

rmSync(distDir, { recursive: true, force: true });
rmSync(pathFile, { force: true });
mkdirSync(distDir, { recursive: true });

if (platform === "win32") {
  execFileSync("powershell", [
    "-NoProfile",
    "-Command",
    `Expand-Archive -Force -Path '${zipPath}' -DestinationPath '${distDir}'`,
  ]);
} else {
  execFileSync("unzip", ["-qo", zipPath, "-d", distDir], { stdio: "inherit" });
}

writeFileSync(pathFile, platformPath, "utf8");

const binPath = join(distDir, platformPath);
if (!existsSync(binPath)) {
  throw new Error(`Expected Electron binary at ${binPath} after extraction.`);
}
console.log(`[fix-electron] Extracted Electron v${version} (${platform}-${arch}) -> ${binPath}`);
