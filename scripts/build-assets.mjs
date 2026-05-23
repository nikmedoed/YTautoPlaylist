// Asset copy script for release builds. Moves manifest, HTML, CSS, icons, and generated bundles into the output folder.
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import esbuild from "esbuild";

export const rootDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

const chromeTarget = ["chrome114"];

const contentEntry = "src/content/index.js";

const scriptEntries = [
  { source: "src/background.js", target: "background.js" },
  { source: "src/popup/popup.js", target: "popup.js" },
  { source: "src/popup/lists.js", target: "lists.js" },
  { source: "src/settings/index.js", target: "settings.js" },
];

export async function buildLocal(options = {}) {
  const outDir = options.outDir || rootDir;
  const buildDir = path.join(outDir, "build");
  if (options.clean !== false) {
    await rm(buildDir, { recursive: true, force: true });
  }
  await mkdir(buildDir, { recursive: true });
  await Promise.all([
    buildModuleScripts(buildDir, options),
    buildContentScript(buildDir, options),
  ]);
}

export async function buildRelease(options = {}) {
  const outDir =
    options.outDir ||
    path.resolve(rootDir, process.env.RELEASE_DIR || "../YTautoPlaylist-release");
  await rm(outDir, { recursive: true, force: true });
  await copyReleaseStatic(outDir);
  await buildLocal({
    ...options,
    outDir,
    minify: true,
    sourcemap: false,
  });
  await writeReleaseManifest(outDir);
  return outDir;
}

async function buildModuleScripts(outDir, options) {
  await Promise.all(
    scriptEntries.map((entry) =>
      esbuild.build({
        entryPoints: [path.join(rootDir, entry.source)],
        bundle: true,
        format: "esm",
        target: chromeTarget,
        minify: Boolean(options.minify),
        sourcemap: Boolean(options.sourcemap),
        legalComments: "none",
        outfile: path.join(outDir, entry.target),
      }),
    ),
  );
}

async function buildContentScript(outDir, options) {
  await esbuild.build({
    entryPoints: [path.join(rootDir, contentEntry)],
    bundle: true,
    format: "iife",
    target: chromeTarget,
    minify: Boolean(options.minify),
    sourcemap: Boolean(options.sourcemap),
    legalComments: "none",
    outfile: path.join(outDir, "content.js"),
  });
}

async function copyReleaseStatic(outDir) {
  await Promise.all([
    copyFile("manifest.json", outDir),
    copyFile("icon/icon.png", outDir),
    copyFile("src/popup/popup.html", outDir),
    copyFile("src/popup/lists.html", outDir),
    copyFile("src/popup/full.html", outDir),
    copyFile("src/settings/settings.html", outDir),
    copyFile("src/settings/icons.svg", outDir),
    copyDirectory("src/popup/styles", outDir),
    copyDirectory("src/settings/styles", outDir),
  ]);
}

async function copyFile(relativePath, outDir) {
  const target = path.join(outDir, relativePath);
  await mkdir(path.dirname(target), { recursive: true });
  await cp(path.join(rootDir, relativePath), target);
}

async function copyDirectory(relativePath, outDir) {
  await cp(path.join(rootDir, relativePath), path.join(outDir, relativePath), {
    recursive: true,
  });
}

async function writeReleaseManifest(outDir) {
  const manifest = JSON.parse(
    await readFile(path.join(rootDir, "manifest.json"), "utf8"),
  );
  const packageJson = JSON.parse(
    await readFile(path.join(rootDir, "package.json"), "utf8"),
  );
  const rawReleaseName =
    process.env.RELEASE_VERSION || process.env.GITHUB_REF_NAME || packageJson.version;
  const releaseVersion = getManifestVersion(rawReleaseName);
  manifest.version = releaseVersion;
  if (rawReleaseName && rawReleaseName !== releaseVersion) {
    manifest.version_name = rawReleaseName;
  } else {
    delete manifest.version_name;
  }
  await writeFile(
    path.join(outDir, "manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8",
  );
  console.log(`Manifest version: ${releaseVersion}`);
  console.log(`Release folder: ${path.relative(rootDir, outDir)}`);
}

function getManifestVersion(raw) {
  const value = String(raw || "").trim();
  const match = value.match(/(\d+(?:\.\d+){0,3})/);
  if (!match) {
    throw new Error(
      `Cannot derive Chrome manifest version from "${value}". Use a tag like v1.2.3.`,
    );
  }
  const version = match[1];
  const parts = version.split(".").map((part) => Number.parseInt(part, 10));
  if (
    parts.length > 4 ||
    parts.some((part) => !Number.isInteger(part) || part < 0 || part > 65535)
  ) {
    throw new Error(`Invalid Chrome manifest version "${version}".`);
  }
  return version;
}
