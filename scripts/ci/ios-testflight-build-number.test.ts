import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import {
  buildNumberFromTag,
  buildTagName,
  claimBuildTag,
  gitRunner,
  nextBuildNumber,
  parseBuildTag,
  parseLsRemoteTags,
  readMarketingVersion,
} from "./ios-testflight-build-number.mjs";

const REPO_ROOT = process.cwd();

describe("parseBuildTag (#707)", () => {
  test("reads marketing version and build number", () => {
    expect(parseBuildTag("ios-v1.0.3-build31")).toEqual({ marketing: "1.0.3", buildNumber: 31 });
    expect(parseBuildTag("ios-v2.1-build7")).toEqual({ marketing: "2.1", buildNumber: 7 });
  });

  test.each([
    "ios-v1.0.3", // App Store release tag
    "ios-v1.0.3-build31^{}",
    "ios-v1.0.3-build031",
    "ios-v1.0.3-build0",
    "ios-v1.0.3-build",
    "ios-v1.0.3-build31-rc1",
    "ios-vfoo-build3",
    "v1.0.3-build31",
    "ios-v1.0.3-build9007199254740992", // Number.MAX_SAFE_INTEGER + 1 would round
    "ios-v1.0.3-build99999999999999999999",
  ])("rejects %s", (name) => {
    expect(parseBuildTag(name)).toBeNull();
  });

  test("reads N exactly up to Number.MAX_SAFE_INTEGER", () => {
    expect(parseBuildTag("ios-v1.0.3-build9007199254740991")).toEqual({
      marketing: "1.0.3",
      buildNumber: Number.MAX_SAFE_INTEGER,
    });
  });

  test("buildTagName is the inverse", () => {
    expect(buildTagName("1.0.3", 32)).toBe("ios-v1.0.3-build32");
    expect(parseBuildTag(buildTagName("1.0.4", 40))).toEqual({ marketing: "1.0.4", buildNumber: 40 });
  });
});

describe("parseLsRemoteTags (#707)", () => {
  test("maps tag names to object ids and skips peeled lines", () => {
    const output = [
      "aaa111\trefs/tags/ios-v1.0.3-build30",
      "bbb222\trefs/tags/ios-v1.0.3-build30^{}",
      "ccc333\trefs/tags/ios-v1.0.3",
      "ddd444\trefs/heads/main",
      "",
    ].join("\n");
    expect([...parseLsRemoteTags(output)]).toEqual([
      ["ios-v1.0.3-build30", "aaa111"],
      ["ios-v1.0.3", "ccc333"],
    ]);
  });
});

describe("nextBuildNumber (#707)", () => {
  test("compares build numbers numerically", () => {
    expect(nextBuildNumber(["ios-v1.0.3-build9", "ios-v1.0.3-build100", "ios-v1.0.3-build10"])).toBe(101);
  });

  test("continues one counter across marketing versions", () => {
    expect(nextBuildNumber(["ios-v1.0.3-build31", "ios-v1.0.4-build5"])).toBe(32);
    expect(nextBuildNumber(["ios-v1.0.3-build31", "ios-v1.0.4-build32"])).toBe(33);
  });

  test("ignores App Store and unrelated tags", () => {
    expect(nextBuildNumber(["ios-v1.0.3", "ios-v1.0.3-build31", "v9.9.9-build999", "release-500"])).toBe(32);
  });

  test("refuses to guess when no build tag exists", () => {
    expect(() => nextBuildNumber(["ios-v1.0.3"])).toThrow(/No ios-v<marketing>-build<N> tags/);
  });

  test("keeps advancing past a tag too large to read exactly", () => {
    expect(nextBuildNumber(["ios-v1.0.3-build31", "ios-v1.0.3-build9007199254740993"])).toBe(32);
  });

  test("refuses a next number it cannot hold exactly", () => {
    expect(() => nextBuildNumber(["ios-v1.0.3-build9007199254740991"])).toThrow(/largest/);
  });
});

describe("readMarketingVersion (#707)", () => {
  test("reads the version every target shares", () => {
    const yml = [
      "targets:",
      "  StillPoint:",
      "    settings:",
      "      base:",
      '        MARKETING_VERSION: "1.0.3"',
      "        CURRENT_PROJECT_VERSION: 31",
      "  StillPointWidget:",
      "    settings:",
      "      base:",
      "        MARKETING_VERSION: 1.0.3",
    ].join("\n");
    expect(readMarketingVersion(yml)).toBe("1.0.3");
  });

  test("ignores the Info.plist $(MARKETING_VERSION) reference", () => {
    const yml = ['        CFBundleShortVersionString: $(MARKETING_VERSION)', '        MARKETING_VERSION: "1.0.3"'].join("\n");
    expect(readMarketingVersion(yml)).toBe("1.0.3");
  });

  test("fails when targets disagree or the key is missing", () => {
    expect(() => readMarketingVersion('    MARKETING_VERSION: "1.0.3"\n    MARKETING_VERSION: "1.0.4"\n')).toThrow(
      /disagree/,
    );
    expect(() => readMarketingVersion("    CURRENT_PROJECT_VERSION: 31\n")).toThrow(/No MARKETING_VERSION/);
  });

  test("reads the real ios/project.yml", () => {
    const yml = fs.readFileSync(path.join(REPO_ROOT, "ios/project.yml"), "utf8");
    expect(readMarketingVersion(yml)).toMatch(/^\d+\.\d+\.\d+$/);
  });
});

describe("buildNumberFromTag (#707)", () => {
  // What origin holds once the manual tag is pushed: the tag itself is among them.
  const onOrigin = ["ios-v1.0.3", "ios-v1.0.3-build39", "ios-v1.0.3-build40", "ios-v1.0.3-build41"];

  test("returns N for a tag that matches the commit's marketing version", () => {
    expect(buildNumberFromTag("ios-v1.0.3-build41", "1.0.3", onOrigin)).toBe(41);
  });

  test("rejects a tag outside the scheme", () => {
    expect(() => buildNumberFromTag("ios-v1.0.3-buildX", "1.0.3", onOrigin)).toThrow(/does not follow/);
  });

  test("rejects an N too large to read exactly instead of rounding it", () => {
    expect(() => buildNumberFromTag("ios-v1.0.3-build9007199254740993", "1.0.3", onOrigin)).toThrow(
      /does not follow/,
    );
  });

  test("rejects a tag that names another marketing version", () => {
    expect(() => buildNumberFromTag("ios-v1.0.4-build41", "1.0.3", onOrigin)).toThrow(/MARKETING_VERSION 1\.0\.3/);
  });

  test("rejects an N a tag for another marketing version already holds", () => {
    const tags = [...onOrigin, "ios-v1.0.4-build40"];
    expect(() => buildNumberFromTag("ios-v1.0.4-build40", "1.0.4", tags)).toThrow(
      /Build number 40 is already taken by ios-v1\.0\.3-build40\. Delete ios-v1\.0\.4-build40 and push ios-v1\.0\.4-build42 instead\./,
    );
  });
});

// Real git against a bare "origin", so the tag push is the same atomic
// create-or-reject a cut gets from GitHub. Each test spawns a few dozen git
// processes, so allow for a busy machine.
describe("claimBuildTag (#707)", { timeout: 30_000 }, () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop();
      if (dir) fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  function setup() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "still-point-testflight-"));
    tempDirs.push(root);
    const emptyConfig = path.join(root, "gitconfig");
    fs.writeFileSync(emptyConfig, "");
    // Keep the developer's git config (signing, hooks, default branch) out of the test.
    const env = {
      ...process.env,
      GIT_CONFIG_GLOBAL: emptyConfig,
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_AUTHOR_NAME: "test",
      GIT_AUTHOR_EMAIL: "test@example.com",
      GIT_COMMITTER_NAME: "test",
      GIT_COMMITTER_EMAIL: "test@example.com",
    };
    const origin = path.join(root, "origin.git");
    const work = path.join(root, "work");
    const other = path.join(root, "other");
    gitRunner(root, env)(["init", "-q", "--bare", "--initial-branch=main", origin]);
    gitRunner(root, env)(["clone", "-q", origin, work]);
    const git = gitRunner(work, env);

    const commit = (message: string) => {
      git(["commit", "-q", "--allow-empty", "-m", message]);
      git(["push", "-q", "origin", "HEAD:main"]);
      return git(["rev-parse", "HEAD"]).stdout.trim();
    };
    const first = commit("build 31");
    git(["tag", "-a", "ios-v1.0.3-build31", "-m", "manual cut", first]);
    git(["tag", "ios-v1.0.3", first]);
    git(["push", "-q", "origin", "--tags"]);

    gitRunner(root, env)(["clone", "-q", origin, other]);
    const otherGit = gitRunner(other, env);
    /** Another cut (or a human) taking `tag` on origin first; returns its tag object. */
    const takeOnOrigin = (tag: string) => {
      otherGit(["fetch", "-q", "origin"]);
      otherGit(["tag", "-a", tag, "-m", "someone else", "origin/main"]);
      otherGit(["push", "-q", "origin", `refs/tags/${tag}`]);
      return otherGit(["rev-parse", `refs/tags/${tag}`]).stdout.trim();
    };
    const remoteTags = () => parseLsRemoteTags(git(["ls-remote", "--tags", "--refs", "origin"]).stdout);
    /** The commit an annotated tag on origin points at. */
    const peeledOnOrigin = (tag: string) => {
      const line = git(["ls-remote", "--tags", "origin"])
        .stdout.split("\n")
        .find((entry) => entry.endsWith(`\trefs/tags/${tag}^{}`));
      return line?.split("\t")[0];
    };

    return { git, commit, takeOnOrigin, remoteTags, peeledOnOrigin };
  }

  const quiet = { log: () => {}, retryDelayMs: 0 };

  /** A git call that cannot reach origin; it throws, as gitRunner does, unless allowFailure is set. */
  const unreachable = (args: string[], options?: { allowFailure?: boolean }) => {
    const stderr = "fatal: unable to access remote";
    if (!options?.allowFailure) throw new Error(`git ${args.join(" ")} failed (exit 128): ${stderr}`);
    return { status: 128, stdout: "", stderr };
  };

  test("pushes an annotated tag for 1 + the highest build", async () => {
    const { git, commit, peeledOnOrigin } = setup();
    const sha = commit("ios change");

    const result = await claimBuildTag({ sha, marketing: "1.0.3", git, ...quiet });

    expect(result).toEqual({ tag: "ios-v1.0.3-build32", buildNumber: 32, attempts: 1 });
    expect(peeledOnOrigin("ios-v1.0.3-build32")).toBe(sha);
    expect(git(["cat-file", "-t", "refs/tags/ios-v1.0.3-build32"]).stdout.trim()).toBe("tag");
  });

  test("consecutive cuts take consecutive numbers", async () => {
    const { git, commit, remoteTags } = setup();

    const a = await claimBuildTag({ sha: commit("first ios merge"), marketing: "1.0.3", git, ...quiet });
    const b = await claimBuildTag({ sha: commit("second ios merge"), marketing: "1.0.3", git, ...quiet });

    expect([a.buildNumber, b.buildNumber]).toEqual([32, 33]);
    const builds = [...remoteTags().keys()].filter((name) => parseBuildTag(name)).sort();
    expect(builds).toEqual(["ios-v1.0.3-build31", "ios-v1.0.3-build32", "ios-v1.0.3-build33"]);
  });

  test("a cut that loses the race for N takes N + 1 instead", async () => {
    const { git, commit, takeOnOrigin, remoteTags, peeledOnOrigin } = setup();
    const sha = commit("ios change");
    let theirTag: string | undefined;
    const racingGit: typeof git = (args, options) => {
      if (args[0] === "push" && theirTag === undefined) {
        theirTag = takeOnOrigin("ios-v1.0.3-build32");
      }
      return git(args, options);
    };

    const result = await claimBuildTag({ sha, marketing: "1.0.3", git: racingGit, ...quiet });

    expect(result).toEqual({ tag: "ios-v1.0.3-build33", buildNumber: 33, attempts: 2 });
    expect(peeledOnOrigin("ios-v1.0.3-build33")).toBe(sha);
    // The winner's tag is untouched.
    expect(remoteTags().get("ios-v1.0.3-build32")).toBe(theirTag);
  });

  test("retries the same N after a push error that left nothing on origin", async () => {
    const { git, commit } = setup();
    const sha = commit("ios change");
    let failed = false;
    const flakyGit: typeof git = (args, options) => {
      if (args[0] === "push" && !failed) {
        failed = true;
        return { status: 128, stdout: "", stderr: "fatal: unable to access remote" };
      }
      return git(args, options);
    };

    const result = await claimBuildTag({ sha, marketing: "1.0.3", git: flakyGit, ...quiet });

    expect(result).toEqual({ tag: "ios-v1.0.3-build32", buildNumber: 32, attempts: 2 });
  });

  test("a push that reports failure after landing is not claimed twice", async () => {
    const { git, commit, remoteTags } = setup();
    const sha = commit("ios change");
    const lossyGit: typeof git = (args, options) => {
      const result = git(args, options);
      return args[0] === "push" ? { status: 1, stdout: "", stderr: "connection reset" } : result;
    };

    const result = await claimBuildTag({ sha, marketing: "1.0.3", git: lossyGit, ...quiet });

    expect(result).toEqual({ tag: "ios-v1.0.3-build32", buildNumber: 32, attempts: 1 });
    expect(remoteTags().has("ios-v1.0.3-build33")).toBe(false);
  });

  test("a tag listing that fails after a lost push reply is retried, not fatal", async () => {
    const { git, commit, remoteTags } = setup();
    const sha = commit("ios change");
    let pushed = false;
    let listingFailed = false;
    const flakyGit: typeof git = (args, options) => {
      if (args[0] === "push") {
        pushed = true;
        git(args, options);
        return { status: 1, stdout: "", stderr: "connection reset" };
      }
      if (args[0] === "ls-remote" && pushed && !listingFailed) {
        listingFailed = true;
        return unreachable(args, options);
      }
      return git(args, options);
    };

    const result = await claimBuildTag({ sha, marketing: "1.0.3", git: flakyGit, ...quiet });

    expect(result).toEqual({ tag: "ios-v1.0.3-build32", buildNumber: 32, attempts: 1 });
    expect(remoteTags().has("ios-v1.0.3-build33")).toBe(false);
  });

  test("gives up when origin's tags cannot be listed", async () => {
    const { git, commit } = setup();
    const sha = commit("ios change");
    let listings = 0;
    const offlineGit: typeof git = (args, options) => {
      if (args[0] !== "ls-remote") return git(args, options);
      listings += 1;
      return unreachable(args, options);
    };

    await expect(
      claimBuildTag({ sha, marketing: "1.0.3", git: offlineGit, maxAttempts: 2, ...quiet }),
    ).rejects.toThrow(/ls-remote --tags --refs origin failed \(exit 128\)/);
    expect(listings).toBe(2);
  });

  test("gives up after maxAttempts", async () => {
    const { git, commit } = setup();
    const sha = commit("ios change");
    const brokenGit: typeof git = (args, options) =>
      args[0] === "push" ? { status: 128, stdout: "", stderr: "fatal: unable to access remote" } : git(args, options);

    await expect(claimBuildTag({ sha, marketing: "1.0.3", git: brokenGit, maxAttempts: 2, ...quiet })).rejects.toThrow(
      /after 2 attempts/,
    );
  });
});

/**
 * The auto workflow's `on.push.paths` list, read from the YAML itself so the
 * cases below test the filter that actually ships.
 */
function autoWorkflowPaths(): string[] {
  const lines = fs.readFileSync(path.join(REPO_ROOT, ".github/workflows/ios-testflight-auto.yml"), "utf8").split("\n");
  const push = lines.findIndex((line) => /^ {2}push:\s*$/.test(line));
  const start = lines.findIndex((line, index) => index > push && /^ {4}paths:\s*$/.test(line));
  expect(push).toBeGreaterThan(-1);
  expect(start).toBeGreaterThan(push);
  const patterns: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (/^\s*(#.*)?$/.test(line)) continue;
    const item = /^ {6}- '([^']+)'\s*$/.exec(line);
    if (!item) break;
    patterns.push(item[1]);
  }
  return patterns;
}

/**
 * GitHub's documented `paths` semantics for the syntax the workflow uses:
 * `**` matches across `/`, `*` does not, `!` excludes, and the last pattern
 * that matches a file decides it. The workflow runs when any file is included.
 */
function pathFilterRuns(patterns: string[], files: string[]): boolean {
  const compiled = patterns.map((pattern) => {
    const negated = pattern.startsWith("!");
    const glob = negated ? pattern.slice(1) : pattern;
    // `?`, `+`, `[` and `]` mean something else to GitHub than to this helper.
    expect(glob).not.toMatch(/[?+[\]]/);
    const source = glob
      .split("**/")
      .map((part) =>
        part
          .split("**")
          .map((piece) =>
            piece
              .split("*")
              .map((literal) => literal.replace(/[.^$|(){}\\/]/g, "\\$&"))
              .join("[^/]*"),
          )
          .join(".*"),
      )
      .join("(?:.*/)?");
    return { negated, regex: new RegExp(`^${source}$`) };
  });
  return files.some((file) => {
    let included = false;
    for (const { negated, regex } of compiled) {
      if (regex.test(file)) included = !negated;
    }
    return included;
  });
}

describe("auto TestFlight paths filter (#707)", () => {
  const patterns = autoWorkflowPaths();

  test("reads the workflow's filter", () => {
    expect(patterns[0]).toBe("ios/**");
    expect(patterns.length).toBeGreaterThan(1);
  });

  test.each([
    ["app source", ["ios/StillPointApp/Views/SessionView.swift"]],
    ["app Info.plist", ["ios/StillPointApp/Info.plist"]],
    ["app entitlements", ["ios/StillPointApp/StillPoint.entitlements"]],
    ["bundled audio", ["ios/StillPointApp/Resources/Audio/bell.mp3"]],
    ["bundled Markdown resource", ["ios/StillPointApp/Resources/licenses.md"]],
    ["monitor extension", ["ios/StillPointMonitor/StillPointMonitorExtension.swift"]],
    ["widget extension", ["ios/StillPointWidget/HabitWidget.swift"]],
    ["app-blocking shared code", ["ios/AppBlockingShared/AppBlockingShared.swift"]],
    ["shared package source", ["ios/StillPointShared/Sources/StillPointShared/WidgetData.swift"]],
    ["shared package manifest", ["ios/StillPointShared/Package.swift"]],
    ["project.yml", ["ios/project.yml"]],
    ["TestFlight export options", ["ios/ExportOptions.plist"]],
    ["iOS change mixed with web and docs", ["src/app/page.tsx", "ios/StillPointApp/StillPointApp.swift", "README.md"]],
  ])("cuts a build for %s", (_label, files) => {
    expect(pathFilterRuns(patterns, files)).toBe(true);
  });

  test.each([
    ["web-only", ["src/app/page.tsx", "package.json", "drizzle/0042_x.sql"]],
    ["repo docs", ["README.md", "docs/operations/ios-app-store-submission.md"]],
    ["iOS docs and checklists", ["ios/RELEASING.md", "ios/QA_CHECKLIST.md", "ios/docs/app-store-metadata.md"]],
    ["a README inside an app folder", ["ios/StillPointApp/Views/README.md"]],
    ["UI tests", ["ios/StillPointAppUITests/SmokeTests.swift", "ios/StillPointAppUITests/README.md"]],
    ["shared package tests", ["ios/StillPointShared/Tests/StillPointSharedTests/WidgetDataTests.swift"]],
    ["App Store metadata", ["ios/fastlane/metadata/en-US/release_notes.txt", "ios/fastlane/Fastfile"]],
    ["Fastlane tooling", ["ios/Gemfile", "ios/Gemfile.lock", "ios/ExportOptionsFastlane.plist"]],
    ["screenshots", ["ios/screenshots/selected/en-US/iPhone 17 Pro Max-01-home.png"]],
    ["committed Xcode project", ["ios/StillPoint.xcodeproj/project.pbxproj"]],
    [
      "this change itself (workflows, scripts, docs)",
      [
        ".github/workflows/ios-testflight-auto.yml",
        "scripts/ci/ios-testflight-build-number.mjs",
        "ios/RELEASING.md",
        "docs/testing/e2e-strategy.md",
      ],
    ],
  ])("does not cut a build for %s", (_label, files) => {
    expect(pathFilterRuns(patterns, files)).toBe(false);
  });
});
