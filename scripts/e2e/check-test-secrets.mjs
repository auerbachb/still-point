import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const exampleEnvPath = resolve(process.cwd(), ".env.example");

if (!existsSync(exampleEnvPath)) {
  throw new Error(".env.example is required for E2E secret policy checks.");
}

const content = readFileSync(exampleEnvPath, "utf8");
const normalized = content
  .split("\n")
  .map((line) => line.trim())
  .filter((line) => line.length > 0 && !line.startsWith("#"))
  .join("\n");
const forbiddenPatterns = [
  {
    key: "E2E_TEST_USER_PASSWORD",
    pattern: /^E2E_TEST_USER_PASSWORD\s*=\s*(?!\s*$)(?!\s*(your-|changeme|example|placeholder))/im,
  },
  {
    key: "E2E_TEST_USER_EMAIL",
    pattern: /^E2E_TEST_USER_EMAIL\s*=\s*(?!\s*$)(?!\s*test\+<run-id>@stillpoint\.local)/im,
  },
];

const violations = forbiddenPatterns
  .filter((rule) => rule.pattern.test(normalized))
  .map((rule) => `- ${rule.key} must not contain live credentials in .env.example`);

if (violations.length > 0) {
  console.error("E2E secrets policy check failed:");
  console.error(violations.join("\n"));
  process.exit(1);
}

console.log("E2E secrets policy check passed.");
