import { mkdir } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";

function parsePositiveInt(raw, fallback) {
  const parsed = Number.parseInt(raw ?? "", 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return fallback;
  }
  return parsed;
}

const lane = process.argv[2] ?? "smoke";
const tag = process.argv[3] ?? "@smoke";
const maxRetries = parsePositiveInt(process.argv[4], 1);
const repeatEach = parsePositiveInt(process.env.E2E_REPEAT_EACH, 1);
const workers = parsePositiveInt(process.env.E2E_WORKERS, 1);

const artifactsRoot = path.resolve(process.cwd(), "artifacts", "e2e", "web", lane);
await mkdir(artifactsRoot, { recursive: true });

const args = [
  "playwright",
  "test",
  "--grep",
  tag,
  "--retries",
  String(maxRetries),
  "--workers",
  String(workers),
  "--repeat-each",
  String(repeatEach),
  "--reporter",
  "line",
];

if (process.env.PW_OUTPUT_DIR) {
  args.push("--output", process.env.PW_OUTPUT_DIR);
}

const child = spawn("npx", args, {
  stdio: "inherit",
  env: {
    ...process.env,
    E2E_ARTIFACTS_DIR: artifactsRoot,
    E2E_LANE: lane,
  },
});

child.on("exit", (code) => {
  process.exit(code ?? 1);
});
