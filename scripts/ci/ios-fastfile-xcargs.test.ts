import { spawnSync } from "node:child_process";
import path from "node:path";
import { describe, expect, test } from "vitest";

const REPO_ROOT = process.cwd();
const HARNESS = path.join(REPO_ROOT, "ios/fastlane/test/fastfile_harness.rb");

/** Environment the Fastfile reads; each test sets only what it names. */
const FASTFILE_ENV = [
  "IOS_BUILD_NUMBER",
  "GID_CLIENT_ID",
  "GID_REVERSED_CLIENT_ID",
  "GID_SERVER_CLIENT_ID",
  "GYM_OUTPUT_DIRECTORY",
  "GYM_NO_CLEAN",
];

type HarnessResult = {
  value?: string | null;
  user_error?: string;
  gym?: Record<string, unknown>;
};

/**
 * Loads the real Fastfile through ios/fastlane/test/fastfile_harness.rb, with the
 * Fastfile's variables removed from the inherited environment so a developer's
 * own GID_* or IOS_BUILD_NUMBER never leak into a case.
 */
function runHarness(args: string[], vars: Record<string, string> = {}): HarnessResult {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const key of FASTFILE_ENV) delete env[key];
  const result = spawnSync("ruby", [HARNESS, ...args], { env: { ...env, ...vars }, encoding: "utf8" });
  if (result.error) {
    throw new Error(
      `Could not run ruby (${result.error.message}). These Fastfile tests need Ruby on PATH; ` +
        "CI installs it with ruby/setup-ruby in unit-tests.yml.",
    );
  }
  expect(result.status, result.stderr).toBe(0);
  return JSON.parse(result.stdout.trim()) as HarnessResult;
}

const buildXcargs = (vars: Record<string, string> = {}) => runHarness(["helper", "build_xcargs"], vars);

const google = { GID_CLIENT_ID: "client.apps.googleusercontent.com", GID_REVERSED_CLIENT_ID: "com.googleusercontent.apps.client" };

describe("Fastfile build number for gym (#838)", { timeout: 20_000 }, () => {
  test("passes nothing when nothing is set, so a local build keeps project.yml's default", () => {
    expect(buildXcargs()).toEqual({ value: null });
  });

  test("passes IOS_BUILD_NUMBER as CURRENT_PROJECT_VERSION", () => {
    expect(buildXcargs({ IOS_BUILD_NUMBER: "32" })).toEqual({ value: "CURRENT_PROJECT_VERSION=32" });
  });

  test("keeps the Google Sign-In settings unchanged without a build number", () => {
    expect(buildXcargs(google)).toEqual({
      value: "GID_CLIENT_ID=client.apps.googleusercontent.com GID_REVERSED_CLIENT_ID=com.googleusercontent.apps.client",
    });
  });

  test("adds the build number after the Google Sign-In settings", () => {
    expect(buildXcargs({ ...google, GID_SERVER_CLIENT_ID: "server", IOS_BUILD_NUMBER: "1043" })).toEqual({
      value:
        "GID_CLIENT_ID=client.apps.googleusercontent.com GID_REVERSED_CLIENT_ID=com.googleusercontent.apps.client " +
        "GID_SERVER_CLIENT_ID=server CURRENT_PROJECT_VERSION=1043",
    });
  });

  test.each(["", "0", "031", "-1", "3.2", "1e3", "32a", " 32", "32 ", "32\n", "32;echo"])(
    "refuses IOS_BUILD_NUMBER=%j instead of falling back to project.yml",
    (value) => {
      expect(buildXcargs({ IOS_BUILD_NUMBER: value }).user_error).toMatch(
        /^IOS_BUILD_NUMBER must be a positive integer with no leading zero/,
      );
    },
  );

  test("a partial Google Sign-In configuration still fails with a valid build number", () => {
    expect(buildXcargs({ GID_CLIENT_ID: "client", IOS_BUILD_NUMBER: "32" }).user_error).toMatch(
      /^Partial Google Sign-In configuration: missing GID_REVERSED_CLIENT_ID/,
    );
  });

  test("a shell splits the combined xcargs into one build setting per word", () => {
    const { value } = buildXcargs({
      GID_CLIENT_ID: "client id",
      GID_REVERSED_CLIENT_ID: "com.client'reversed",
      IOS_BUILD_NUMBER: "32",
    });
    // gym hands xcargs to xcodebuild through a shell command line.
    const words = spawnSync("/bin/sh", ["-c", `printf '%s\\n' ${value}`], { encoding: "utf8" });
    expect(words.status, words.stderr).toBe(0);
    expect(words.stdout.trimEnd().split("\n")).toEqual([
      "GID_CLIENT_ID=client id",
      "GID_REVERSED_CLIENT_ID=com.client'reversed",
      "CURRENT_PROJECT_VERSION=32",
    ]);
  });

  test("the build lane hands the combined xcargs to gym", () => {
    expect(runHarness(["lane", "build"], { ...google, IOS_BUILD_NUMBER: "32" }).gym).toMatchObject({
      scheme: "StillPoint",
      configuration: "Release",
      xcargs:
        "GID_CLIENT_ID=client.apps.googleusercontent.com GID_REVERSED_CLIENT_ID=com.googleusercontent.apps.client " +
        "CURRENT_PROJECT_VERSION=32",
    });
    expect(runHarness(["lane", "build"]).gym?.xcargs).toBeNull();
  });
});
