// Run Vitest from a working directory with an upper-case drive letter. When the shell reports
// `c:\...` (VS Code terminals do), Vitest loads itself twice and every suite fails with
// "Cannot read properties of undefined (reading 'config')".

import { spawnSync } from "node:child_process";
import path from "node:path";
import process from "node:process";

const cwd = process.cwd().replace(/^[a-z]:/, (drive) => drive.toUpperCase());
const bin = path.join(cwd, "node_modules", "vitest", "vitest.mjs");
const result = spawnSync(process.execPath, [bin, ...process.argv.slice(2)], {
  cwd,
  stdio: "inherit",
});
process.exit(result.status ?? 1);
