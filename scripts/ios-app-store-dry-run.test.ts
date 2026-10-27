import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { gitRunner } from "./ci/ios-testflight-build-number.mjs";
import { listBuildTags, queryAsc, resolveIntendedBuild } from "./ios-app-store-dry-run.mjs";

const REPO_ROOT = process.cwd();
const DRY_RUN = path.join(REPO_ROOT, "scripts/ios-app-store-dry-run.mjs");

const projectYml = { marketingVersion: "1.0.3", buildNumber: "31" };
const onOrigin = (...names: string[]) => ({ names, source: "origin" });

describe("resolveIntendedBuild (#838)", () => {
  test("defaults to the highest build tag, compared numerically", () => {
    expect(
      resolveIntendedBuild({
        buildTags: onOrigin("ios-v1.0.3-build9", "ios-v1.0.3-build10", "ios-v1.0.3-build8"),
        projectYml,
      }),
    ).toEqual({ marketingVersion: "1.0.3", buildNumber: "10", intendedTag: "ios-v1.0.3-build10", source: "origin" });
  });

  test("ignores App Store and malformed tags", () => {
    const intended = resolveIntendedBuild({
      buildTags: onOrigin("ios-v1.0.3", "ios-v1.0.3-build031", "ios-v1.0.3-build70-rc1", "ios-v1.0.3-build7"),
      projectYml,
    });
    expect(intended.intendedTag).toBe("ios-v1.0.3-build7");
  });

  test("an explicit build tag names the build, even one below the highest", () => {
    expect(
      resolveIntendedBuild({ intendedTag: "ios-v1.0.3-build29", buildTags: onOrigin("ios-v1.0.3-build31"), projectYml }),
    ).toEqual({ marketingVersion: "1.0.3", buildNumber: "29", intendedTag: "ios-v1.0.3-build29", source: "intended-tag" });
  });

  test.each(["ios-v1.0.3", "ios-v1.0.3-build031", "1.0.3 (32)"])(
    "--intended-tag %s is refused, not kept as a label",
    (intendedTag) => {
      const intended = resolveIntendedBuild({ intendedTag, buildTags: null, projectYml });
      expect(intended.problem).toMatch(/is not a build tag\. Pass ios-v<marketing>-build<N>/);
      expect(intended.buildNumber).toBeUndefined();
      expect(intended.marketingVersion).toBeUndefined();
    },
  );

  test("falls back to ios/project.yml, with a warning, when no build tag exists", () => {
    const intended = resolveIntendedBuild({ buildTags: onOrigin("ios-v1.0.3"), projectYml });
    expect(intended).toMatchObject({
      marketingVersion: "1.0.3",
      buildNumber: "31",
      intendedTag: "ios-v1.0.3-build31",
      source: "project.yml",
    });
    expect(intended.warning).toMatch(/^No ios-v<marketing>-build<N> tags were found on origin, so .* --intended-tag/);
  });

  test("falls back to ios/project.yml, with a warning, when tags can't be listed", () => {
    const intended = resolveIntendedBuild({ buildTags: null, projectYml });
    expect(intended.source).toBe("project.yml");
    expect(intended.warning).toMatch(/^Tags could not be listed, so the intended build falls back/);
  });

  test("warns that this clone's tags can be behind origin's", () => {
    const intended = resolveIntendedBuild({ buildTags: { names: ["ios-v1.0.3-build30"], source: "local" }, projectYml });
    expect(intended).toMatchObject({ buildNumber: "30", intendedTag: "ios-v1.0.3-build30", source: "local" });
    expect(intended.warning).toBe(
      "Origin's tags could not be listed, so the intended build comes from this clone's tags, which can be " +
        "behind origin. Run git fetch --tags, or pass --intended-tag.",
    );
  });

  test("warns when the intended build is for another marketing version", () => {
    const intended = resolveIntendedBuild({
      buildTags: onOrigin("ios-v1.0.3-build40"),
      projectYml: { marketingVersion: "1.0.4", buildNumber: "31" },
    });
    expect(intended).toMatchObject({ marketingVersion: "1.0.3", buildNumber: "40", source: "origin" });
    expect(intended.warning).toBe(
      "The intended build ios-v1.0.3-build40 is for marketing version 1.0.3, but ios/project.yml has MARKETING_VERSION 1.0.4.",
    );
  });
});

describe("listBuildTags (#838)", () => {
  type Reply = { status: number | null; stdout?: string; stderr?: string };
  /** A git that answers ls-remote and tag --list with canned replies and records each call. */
  function cannedGit(replies: { lsRemote: Reply; tagList?: Reply }) {
    const calls: string[] = [];
    const git = (args: string[]) => {
      calls.push(args.join(" "));
      const reply = args[0] === "ls-remote" ? replies.lsRemote : replies.tagList;
      if (!reply) throw new Error(`unexpected git ${args.join(" ")}`);
      return { stdout: "", stderr: "", ...reply };
    };
    return { git, calls };
  }

  test("lists origin's tags first", () => {
    const { git, calls } = cannedGit({
      lsRemote: { status: 0, stdout: "aaa\trefs/tags/ios-v1.0.3-build31\nbbb\trefs/tags/ios-v1.0.3\n" },
    });
    expect(listBuildTags(git, () => {})).toEqual({ names: ["ios-v1.0.3-build31", "ios-v1.0.3"], source: "origin" });
    expect(calls).toEqual(["ls-remote --tags --refs origin"]);
  });

  test("uses this clone's tags when origin can't be listed", () => {
    const messages: string[] = [];
    const { git, calls } = cannedGit({
      lsRemote: { status: 128, stderr: "fatal: unable to access remote" },
      tagList: { status: 0, stdout: "ios-v1.0.3-build30\nios-v1.0.3-build31\n" },
    });
    expect(listBuildTags(git, (message) => messages.push(message))).toEqual({
      names: ["ios-v1.0.3-build30", "ios-v1.0.3-build31"],
      source: "local",
    });
    expect(calls).toEqual(["ls-remote --tags --refs origin", "tag --list ios-v*-build*"]);
    expect(messages).toEqual([
      "Listing tags on origin failed (exit 128: fatal: unable to access remote); using this clone's tags.",
    ]);
  });

  test("returns null when neither can be listed, or git is missing", () => {
    const { git } = cannedGit({ lsRemote: { status: 128 }, tagList: { status: 128 } });
    expect(listBuildTags(git, () => {})).toBeNull();
    const missingGit = () => {
      throw new Error("spawnSync git ENOENT");
    };
    expect(listBuildTags(missingGit, () => {})).toBeNull();
  });
});

describe("queryAsc (#838)", () => {
  // Twelve VALID 1.0.3 builds, 31 down to 20, newest upload first.
  const uploads = Array.from({ length: 12 }, (_, i) => ({
    id: `build-${31 - i}`,
    attributes: { version: String(31 - i), processingState: "VALID" },
  }));

  /** An App Store Connect holding `uploads` that honors filter[version] and limit. */
  async function fakeAsc(pathname: string) {
    const url = new URL(pathname, "https://api.appstoreconnect.apple.com");
    if (url.pathname === "/v1/appStoreVersions") return { data: [] };
    const version = url.searchParams.get("filter[version]");
    const matching = version === null ? uploads : uploads.filter((build) => build.attributes.version === version);
    return { data: matching.slice(0, Number(url.searchParams.get("limit"))) };
  }

  beforeEach(() => {
    const { privateKey } = crypto.generateKeyPairSync("ec", { namedCurve: "P-256" });
    vi.stubEnv("APPSTORE_APP_ID", "1234567890");
    vi.stubEnv("APPSTORE_API_KEY_ID", "TESTKEYID");
    vi.stubEnv("APPSTORE_API_ISSUER_ID", "test-issuer");
    vi.stubEnv("APPSTORE_API_PRIVATE_KEY", privateKey.export({ type: "pkcs8", format: "pem" }).toString());
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  test("finds an --intended-tag build older than the ten newest builds", async () => {
    expect(uploads.slice(0, 10).map((build) => build.attributes.version)).not.toContain("21");

    const asc = await queryAsc({ marketingVersion: "1.0.3", buildNumber: "21" }, fakeAsc);

    expect(asc).toMatchObject({ live: true, intendedBuild: { id: "build-21", version: "21", processingState: "VALID" } });
  });

  test("still reports a build App Store Connect doesn't have as missing", async () => {
    const asc = await queryAsc({ marketingVersion: "1.0.3", buildNumber: "40" }, fakeAsc);

    expect(asc).toMatchObject({ live: true, intendedBuild: null });
  });
});

// The real script, run the way `npm run ios:app-store:dry-run` runs it, against a
// throwaway origin (through GIT_DIR) so the intended build is known. Its other
// checks read this checkout as usual; the test only reads the intended build back.
describe("ios-app-store-dry-run.mjs intended build (#838)", { timeout: 30_000 }, () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop();
      if (dir) fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  function setup() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "still-point-dry-run-"));
    tempDirs.push(root);
    const emptyConfig = path.join(root, "gitconfig");
    fs.writeFileSync(emptyConfig, "");
    // Keep the developer's git config (signing, hooks, default branch) out of the test.
    const gitEnv = {
      ...process.env,
      GIT_CONFIG_GLOBAL: emptyConfig,
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_AUTHOR_NAME: "test",
      GIT_AUTHOR_EMAIL: "test@example.com",
      GIT_COMMITTER_NAME: "test",
      GIT_COMMITTER_EMAIL: "test@example.com",
    };
    const origin = path.join(root, "origin.git");
    const clone = path.join(root, "clone");
    gitRunner(root, gitEnv)(["init", "-q", "--bare", "--initial-branch=main", origin]);
    gitRunner(root, gitEnv)(["clone", "-q", origin, clone]);
    const git = gitRunner(clone, gitEnv);
    git(["commit", "-q", "--allow-empty", "-m", "ios change"]);
    for (const tag of ["ios-v1.0.3-build9", "ios-v1.0.3-build10", "ios-v1.0.3", "ios-v1.0.3-build010"]) {
      git(["tag", tag]);
    }
    git(["push", "-q", "origin", "HEAD:main", "--tags"]);

    // `gh secret list` must not reach GitHub from a unit test.
    const bin = path.join(root, "bin");
    fs.mkdirSync(bin);
    fs.writeFileSync(path.join(bin, "gh"), "#!/bin/sh\necho 'gh is stubbed in this test' >&2\nexit 1\n", { mode: 0o755 });

    const env: NodeJS.ProcessEnv = { ...gitEnv, GIT_DIR: path.join(clone, ".git"), PATH: `${bin}${path.delimiter}${process.env.PATH}` };
    for (const key of ["APPSTORE_APP_ID", "APPSTORE_API_KEY_ID", "APPSTORE_API_ISSUER_ID", "APPSTORE_API_PRIVATE_KEY"]) {
      delete env[key];
    }

    /** Runs the dry run and returns its summary.json and summary.md. */
    const dryRun = (...args: string[]) => {
      const outputDir = fs.mkdtempSync(path.join(root, "out-"));
      const result = spawnSync(process.execPath, [DRY_RUN, "--output-dir", outputDir, ...args], {
        cwd: REPO_ROOT,
        env,
        encoding: "utf8",
      });
      const summaryPath = path.join(outputDir, "summary.json");
      expect(fs.existsSync(summaryPath), `${result.stdout}\n${result.stderr}`).toBe(true);
      return {
        summary: JSON.parse(fs.readFileSync(summaryPath, "utf8")),
        markdown: fs.readFileSync(path.join(outputDir, "summary.md"), "utf8"),
      };
    };

    return { git, dryRun };
  }

  type Check = { id: string; status: string; evidence?: Record<string, unknown> };
  type ChecklistItem = { id: string; evidence?: Record<string, unknown> };

  test("names the highest build tag on origin by default, everywhere it reports the build", () => {
    const { dryRun } = setup();

    const { summary, markdown } = dryRun();

    expect(summary.fatalError).toBeUndefined();
    expect(summary.intendedTag).toBe("ios-v1.0.3-build10");
    expect(summary.project).toMatchObject({ marketingVersion: "1.0.3", buildNumber: "10" });
    expect(summary.intendedBuild.source).toBe("origin");
    expect(summary.preflightSummary).toMatchObject({ intendedTag: "ios-v1.0.3-build10", version: "1.0.3", build: "10" });
    const a2 = (summary.checks as Check[]).find((check) => check.id === "A2");
    expect(a2).toMatchObject({ status: "pass", evidence: { buildNumber: "10", intendedTag: "ios-v1.0.3-build10" } });
    const b5 = (summary.issue242Checklist as ChecklistItem[]).find((item) => item.id === "B5");
    expect(b5?.evidence).toEqual({ version: "1.0.3", build: "10" });
    expect(markdown).toContain("- Version/build: 1.0.3 (10)\n- Intended tag: ios-v1.0.3-build10 (from the highest build tag on origin)");
  });

  test("--intended-tag picks another build", () => {
    const { dryRun } = setup();

    const { summary } = dryRun("--intended-tag", "ios-v1.0.3-build9");

    expect(summary.intendedTag).toBe("ios-v1.0.3-build9");
    expect(summary.project).toMatchObject({ marketingVersion: "1.0.3", buildNumber: "9" });
    expect(summary.intendedBuild.source).toBe("intended-tag");
  });

  test("an --intended-tag that is not a build tag fails A2", () => {
    const { dryRun } = setup();

    const { summary } = dryRun("--intended-tag", "ios-v1.0.3");

    expect((summary.checks as Check[]).find((check) => check.id === "A2")?.status).toBe("fail");
    expect(summary.asc).toMatchObject({ live: false, reason: "There is no intended build to look up; see A2." });
  });

  test("falls back to this clone's tags when origin can't be listed", () => {
    const { git, dryRun } = setup();
    git(["remote", "set-url", "origin", path.join(os.tmpdir(), "still-point-no-such-origin.git")]);

    const { summary } = dryRun();

    expect(summary.intendedTag).toBe("ios-v1.0.3-build10");
    expect(summary.intendedBuild.source).toBe("local");
    expect((summary.checks as Check[]).find((check) => check.id === "INTENDED_BUILD")?.status).toBe("warning");
  });
});
