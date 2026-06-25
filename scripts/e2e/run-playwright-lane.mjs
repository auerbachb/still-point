import { mkdir, open, utimes } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { spawn } from "node:child_process";
import path from "node:path";
import { classifyWebFailure } from "./classify-web-failure.mjs";

function parseNonNegativeInt(raw, fallback) {
  const parsed = Number.parseInt(raw ?? "", 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return fallback;
  }
  return parsed;
}

const lane = process.argv[2] ?? "smoke";
const tag = process.argv[3] ?? "@smoke";
// `maxRetries` is the number of ADDITIONAL attempts after the first, matching
// the "Max retries" column in docs/testing/e2e-policy.md (smoke=1, critical=2).
// Total attempts = maxRetries + 1.
const maxRetries = parseNonNegativeInt(process.argv[4], 1);
const repeatEach = parseNonNegativeInt(process.env.E2E_REPEAT_EACH, 1);
const workers = parseNonNegativeInt(process.env.E2E_WORKERS, 1);

const artifactsRoot = path.resolve(process.cwd(), "artifacts", "e2e", "web", lane);
await mkdir(artifactsRoot, { recursive: true });

// Playwright keeps its own per-test retries OFF: this runner owns retries at the
// whole-lane level so a single non-retriable failure fails the lane fast,
// consulting the classifier between attempts (CR plan for #335).
const baseArgs = [
  "playwright",
  "test",
  "--grep",
  tag,
  "--retries",
  "0",
  "--workers",
  String(workers),
  "--repeat-each",
  String(repeatEach),
];

if (process.env.PW_OUTPUT_DIR) {
  baseArgs.push("--output", process.env.PW_OUTPUT_DIR);
}

/**
 * Create a start-of-attempt sentinel whose mtime is fixed at attempt start.
 * The classifier compares crash dumps against this, NOT against the tee'd log
 * (whose mtime keeps advancing until the browser exits).
 */
async function createAttemptMarker(markerPath) {
  const handle = await open(markerPath, "w");
  await handle.close();
  const now = new Date();
  await utimes(markerPath, now, now);
}

function runAttempt(logPath) {
  return new Promise((resolve, reject) => {
    const logStream = createWriteStream(logPath, { flags: "w" });
    const child = spawn("npx", baseArgs, {
      stdio: ["inherit", "pipe", "pipe"],
      env: {
        ...process.env,
        E2E_ARTIFACTS_DIR: artifactsRoot,
        E2E_LANE: lane,
      },
    });

    const tee = (source, sink) => {
      child[source].on("data", (chunk) => {
        sink.write(chunk);
        logStream.write(chunk);
      });
    };
    tee("stdout", process.stdout);
    tee("stderr", process.stderr);

    child.on("error", (error) => {
      logStream.end();
      reject(error);
    });
    child.on("exit", (code) => {
      logStream.end(() => resolve(code ?? 1));
    });
  });
}

let exitCode = 1;
for (let attempt = 1; attempt <= maxRetries + 1; attempt += 1) {
  const logPath = path.join(artifactsRoot, `attempt-${attempt}.log`);
  const markerPath = path.join(artifactsRoot, `attempt-${attempt}.start`);
  await createAttemptMarker(markerPath);

  console.log(`Running web ${lane} lane attempt ${attempt}/${maxRetries + 1} (tag ${tag})`);
  exitCode = await runAttempt(logPath);

  if (exitCode === 0) {
    console.log(`Web ${lane} lane passed on attempt ${attempt}.`);
    process.exit(0);
  }

  const { retriable, reason } = await classifyWebFailure({
    logPath,
    attemptMarker: markerPath,
  });

  if (!retriable) {
    console.error(
      `Web ${lane} lane failed with non-retriable signature; skipping retry. Classifier: ${reason}`,
    );
    process.exit(exitCode || 1);
  }

  if (attempt >= maxRetries + 1) {
    console.error(
      `Web ${lane} lane failed after ${maxRetries + 1} attempt(s). Last classifier verdict: ${reason}`,
    );
    process.exit(exitCode || 1);
  }

  console.warn(`Web ${lane} lane failed with retriable signature; retrying. Classifier: ${reason}`);
}

process.exit(exitCode || 1);
