import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const projectRoot = path.resolve(__dirname, "..");
const distRoot = path.join(projectRoot, "dist");
const outDir = path.join(distRoot, "extension");

const COPY_ENTRIES = [
  { source: "manifest.json" },
  { source: "icon" },
  { source: "src" },
];

const EXTRA_FILES = [
  {
    target: "config.js",
    contents: `export const DEV_MODE = false;\n`,
  },
];

async function removeDir(target) {
  await fs.rm(target, { recursive: true, force: true });
}

async function ensureDir(target) {
  await fs.mkdir(target, { recursive: true });
}

async function copyEntry(entry) {
  const from = path.join(projectRoot, entry.source);
  const to = path.join(outDir, entry.target ?? entry.source);
  const stats = await fs.stat(from);
  if (stats.isDirectory()) {
    await copyDirectory(from, to);
    return;
  }
  await ensureDir(path.dirname(to));
  await fs.copyFile(from, to);
}

async function copyDirectory(from, to) {
  await ensureDir(to);
  const entries = await fs.readdir(from, { withFileTypes: true });
  for (const entry of entries) {
    if (shouldSkip(entry.name)) continue;
    const sourceChild = path.join(from, entry.name);
    const targetChild = path.join(to, entry.name);
    if (entry.isDirectory()) {
      await copyDirectory(sourceChild, targetChild);
    } else if (entry.isFile()) {
      await ensureDir(path.dirname(targetChild));
      await fs.copyFile(sourceChild, targetChild);
    }
  }
}

function shouldSkip(name) {
  return (
    name === ".DS_Store" ||
    name === "Thumbs.db" ||
    name === ".gitkeep" ||
    name.endsWith(".map")
  );
}

async function writeExtraFiles() {
  for (const file of EXTRA_FILES) {
    const target = path.join(outDir, file.target);
    await ensureDir(path.dirname(target));
    await fs.writeFile(target, file.contents, "utf8");
  }
}

async function build() {
  await removeDir(outDir);
  await ensureDir(outDir);
  for (const entry of COPY_ENTRIES) {
    await copyEntry(entry);
  }
  await writeExtraFiles();
  console.log(`Extension bundle ready at ${path.relative(projectRoot, outDir)}`);
}

build().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
