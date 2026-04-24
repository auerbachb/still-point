import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const outputDir = path.resolve("artifacts/e2e/perf");
const metricName = "firstResponseMs";
const metricValue = Number(process.env.E2E_WEB_FIRST_RESPONSE_MS ?? "0");
const thresholdMs = Number(process.env.E2E_WEB_FIRST_RESPONSE_THRESHOLD_MS ?? "1200");
const thresholdEnforced = process.env.E2E_WEB_PERF_ENFORCE === "true";

if (!Number.isFinite(metricValue) || metricValue <= 0) {
  throw new Error("E2E_WEB_FIRST_RESPONSE_MS must be set to a positive number.");
}

if (thresholdEnforced && (!Number.isFinite(thresholdMs) || thresholdMs <= 0)) {
  throw new Error(
    "E2E_WEB_FIRST_RESPONSE_THRESHOLD_MS must be a positive number when E2E_WEB_PERF_ENFORCE=true.",
  );
}

const payload = {
  platform: "web",
  metricName,
  metricValue,
  thresholdMs,
  thresholdEnforced,
  recordedAt: new Date().toISOString(),
};

await mkdir(outputDir, { recursive: true });
const outputPath = path.join(outputDir, "web-metric.json");
await writeFile(outputPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");

if (payload.thresholdEnforced && payload.metricValue > payload.thresholdMs) {
  throw new Error(
    `Web performance regression: ${payload.metricName}=${payload.metricValue}ms exceeds threshold ${payload.thresholdMs}ms.`,
  );
}

console.log(
  `Recorded web metric ${payload.metricName}=${payload.metricValue}ms (threshold=${payload.thresholdMs}ms, enforced=${payload.thresholdEnforced}).`,
);
