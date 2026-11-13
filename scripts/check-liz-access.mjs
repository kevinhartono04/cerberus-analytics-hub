import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = fileURLToPath(new URL("..", import.meta.url));
const tests = [
  "tests/liz-service-api.test.ts",
  "tests/liz-sense-reporting.test.ts",
  "tests/ludios-sense-api.test.ts",
];
// Vitest otherwise allows one named test file to disappear while others pass.
for (const file of [...tests, "lib/service-auth.ts", "lib/ludios-sense-auth.ts"]) {
  if (!existsSync(path.join(root, file))) {
    console.error(`Liz release check failed: required file is missing: ${file}`);
    process.exit(1);
  }
}
if (process.env.VERCEL_ENV === "production" && !/^[a-f0-9]{64}$/i.test(process.env.CEREBRAL_LIZ_TOKEN_SHA256 ?? "")) {
  console.error("Liz release check failed: production CEREBRAL_LIZ_TOKEN_SHA256 is missing or malformed.");
  process.exit(1);
}

const result = spawnSync(process.execPath, [path.join(root, "node_modules/vitest/vitest.mjs"), "run", ...tests], {
  cwd: root,
  stdio: "inherit",
  env: { ...process.env, NODE_ENV: "test" },
});
if (result.error) console.error("Liz release check could not run:", result.error.message);
process.exit(result.status ?? 1);
