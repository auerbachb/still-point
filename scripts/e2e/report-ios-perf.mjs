#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";

const artifactDir = path.resolve(process.cwd(), "artifacts/e2e/ios");
const outputPath = path.join(artifactDir, "perf-summary.json");

function parseDurationToSeconds(rawValue) {
  if (!rawValue) {
    return null;
  }

  const value = String(rawValue).trim().toLowerCase();
  const minutesMatch = value.match(/^(\d+(?:\.\d+)?)m$/);
  if (minutesMatch) {
    return Number.parseFloat(minutesMatch[1]) * 60;
  }

  const secondsMatch = value.match(/^(\d+(?:\.\d+)?)s$/);
  if (secondsMatch) {
    return Number.parseFloat(secondsMatch[1]);
  }

  const numeric = Number.parseFloat(value);
  return Number.isFinite(numeric) ? numeric : null;
}

async function main() {
  await fs.mkdir(artifactDir, { recursive: true });

  const uiBootSeconds =
    parseDurationToSeconds(process.env.IOS_E2E_APP_BOOT_SECONDS) ??
    parseDurationToSeconds(process.env.IOS_E2E_APP_BOOT_TIME) ??
    0;
  const thresholdSeconds =
    parseDurationToSeconds(process.env.IOS_E2E_BOOT_THRESHOLD_SECONDS) ??
    parseDurationToSeconds(process.env.IOS_E2E_BOOT_THRESHOLD) ??
    null;

  const perfSummary = {
    platform: "ios",
    capturedAt: new Date().toISOString(),
    metric: "app_boot_seconds",
    value: Number(uiBootSeconds.toFixed(3)),
    threshold: thresholdSeconds === null ? null : Number(thresholdSeconds.toFixed(3)),
    status:
      thresholdSeconds !== null && uiBootSeconds > thresholdSeconds
        ? "above-threshold"
        : "ok",
    notes:
      "Capture iOS_E2E_APP_BOOT_SECONDS from xcodebuild/UI-test harness if available. The metric is always reported; threshold failures are optional.",
  };

  await fs.writeFile(outputPath, `${JSON.stringify(perfSummary, null, 2)}\n`, "utf8");

  console.log(
    `iOS perf metric recorded (${perfSummary.metric}=${perfSummary.value}s) -> ${path.relative(
      process.cwd(),
      outputPath,
    )}`,
  );

  if (perfSummary.status === "above-threshold" && process.env.IOS_E2E_FAIL_ON_PERF === "true") {
    throw new Error(
      `iOS perf metric ${perfSummary.metric}=${perfSummary.value}s exceeded threshold=${perfSummary.threshold}s.`,
    );
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
