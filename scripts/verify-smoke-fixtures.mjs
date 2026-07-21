#!/usr/bin/env node
// Verifies the production-smoke fixture manifest (execution plan Slice 5.1): signatures,
// decodability, EXIF expectations, absence of private/GPS/device-identifying metadata, and
// checksums. Slice 5 has not been implemented yet, so this fails loudly rather than reporting
// a false pass -- `verify:acceptance` is expected to fail here until that slice lands.

import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const manifestPath = path.join(repoRoot, "fixtures", "production-smoke", "manifest.json");

if (!existsSync(manifestPath)) {
  console.error(
    "verify:smoke-fixtures: no fixture manifest at fixtures/production-smoke/manifest.json.\n" +
      "This is expected until execution-plan Slice 5.1 (Production-smoke fixtures) is implemented.",
  );
  process.exit(1);
}

console.error("verify:smoke-fixtures: manifest verification is not implemented yet (Slice 5.1).");
process.exit(1);
