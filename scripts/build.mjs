// Release build script. Produces a clean extension package with bundled JavaScript and copied runtime assets.
import path from "node:path";
import { buildRelease, rootDir } from "./build-assets.mjs";

const outDir = await buildRelease();

console.log(`Extension package ready at ${path.relative(rootDir, outDir)}`);
