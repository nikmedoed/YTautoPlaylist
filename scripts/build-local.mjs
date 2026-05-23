// Local build script. Rebuilds committed JavaScript bundles in build/ from the source entrypoints.
import { buildLocal } from "./build-assets.mjs";

await buildLocal();

console.log("JavaScript bundles rebuilt in build/.");
