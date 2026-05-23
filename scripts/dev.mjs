// Development watcher. Rebuilds JavaScript bundles when source files change during extension development.
import { watch } from "node:fs";
import path from "node:path";
import { buildLocal, rootDir } from "./build-assets.mjs";

let building = false;
let pending = false;
let debounceTimer = null;

await rebuild();

const watchedPaths = [
  path.join(rootDir, "src"),
];

for (const target of watchedPaths) {
  watch(target, { recursive: true }, scheduleRebuild);
}

console.log("Watching src/ for build/ rebuilds.");

function scheduleRebuild() {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    if (building) {
      pending = true;
      return;
    }
    void rebuild();
  }, 120);
}

async function rebuild() {
  building = true;
  try {
    await buildLocal({ clean: false, sourcemap: true });
    console.log(`[${new Date().toLocaleTimeString()}] rebuilt build/ bundles`);
  } catch (err) {
    console.error(err);
  } finally {
    building = false;
    if (pending) {
      pending = false;
      void rebuild();
    }
  }
}
