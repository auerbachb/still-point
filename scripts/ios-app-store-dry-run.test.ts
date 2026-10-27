import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { gitRunner } from "./ci/ios-testflight-build-number.mjs";
import {
  checkWorkflowSecrets,
  classifyIssueChecklist,
  createReportContext,
  evaluateAsc,
  extractProjectVersion,
  extractRunbookPhases,
  listBuildTags,
  parseArgs,
  queryAsc,
  resolveIntendedBuild,
  runLocalChecks,
  writeMarkdown,
} from "./ios-app-store-dry-run.mjs";

const REPO_ROOT = process.cwd();
const DRY_RUN = path.join(REPO_ROOT, "scripts/ios-app-store-dry-run.mjs");

const projectYml = { marketingVersion: "1.0.3", buildNumber: "31" };

/** The issue #242 checklist items, in report order (38). */
const ISSUE_242_IDS = [
  "A1", "A2", "A3", "A4", "A5",
  "B1", "B2", "B3", "B4", "B5",
  "C1", "C2", "C3", "C4", "C5", "C6", "C7", "C8", "C9",
  "D1", "D2", "D3", "D4",
  "E1", "E2", "E3", "E4", "E5", "E6", "E7",
  "F1", "F2", "F3",
  "DOD1", "DOD2", "DOD3", "DOD4", "DOD5",
];

/** The report's human-owned gates, copied here so a change to them is a test change. */
const HUMAN_GATES = [
  { owner: "Account Holder/Admin", decision: "Confirm Apple Agreements, Tax, and Banking have no Action required items.", reason: "Not exposed by public ASC API." },
  { owner: "Product/App Store", decision: "Approve screenshots, app previews, age rating, reviewer notes, demo credentials, and release timing.", reason: "Compliance/copy/assets require human accountability." },
  { owner: "Release owner", decision: "Approve programmatic Submit for Review for the intended build.", reason: "Dry-run mode must not submit without explicit live approval." },
  { owner: "Product/App Store", decision: "Choose manual, automatic, or phased release after approval.", reason: "Business release strategy." },
];

/** The report's fallback paths for a tracking issue. */
const fallbackPathsFor = (trackingIssue: string) => [
  { when: "ASC credentials or APPSTORE_APP_ID are unavailable", action: "Use App Store Connect website to verify TestFlight build status, version page, attached build, metadata, screenshots, review notes, and demo credentials; paste evidence into the generated report." },
  { when: "API field is unsupported or returns a blocker", action: "Record the exact API error, open App Store Connect -> app -> Distribution/App Store -> target version, fix only that field, then rerun this dry run." },
  { when: "Submission is rejected", action: `Copy reviewer notes verbatim to ${trackingIssue}, create/link implementation issues, cut a replacement build (merging the fix cuts one; its ios-v<marketing>-build<N> tag carries the new number), attach it, and resubmit.` },
  { when: "Submission is approved", action: `Record final build and outcome in ${trackingIssue}, choose held/manual/automatic/phased release, and close tracking only when complete.` },
];
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

describe("queryAsc without App Store Connect access (#1132)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  test.each([
    ["no marketing version", { buildNumber: "31" }],
    ["no build number", { marketingVersion: "1.0.3" }],
  ])("has no intended build to look up with %s", async (_label, project) => {
    const get = vi.fn();

    expect(await queryAsc(project, get)).toEqual({ live: false, reason: "There is no intended build to look up; see A2." });
    expect(get).not.toHaveBeenCalled();
  });

  test("asks for the credentials when APPSTORE_APP_ID is unset", async () => {
    const { privateKey } = crypto.generateKeyPairSync("ec", { namedCurve: "P-256" });
    vi.stubEnv("APPSTORE_APP_ID", "");
    vi.stubEnv("APPSTORE_API_KEY_ID", "TESTKEYID");
    vi.stubEnv("APPSTORE_API_ISSUER_ID", "test-issuer");
    vi.stubEnv("APPSTORE_API_PRIVATE_KEY", privateKey.export({ type: "pkcs8", format: "pem" }).toString());
    const get = vi.fn();

    const asc = await queryAsc({ marketingVersion: "1.0.3", buildNumber: "31" }, get);

    expect(asc).toEqual({ live: false, reason: expect.stringMatching(/^Set APPSTORE_APP_ID, APPSTORE_API_KEY_ID/) });
    expect(get).not.toHaveBeenCalled();
  });
});

describe("parseArgs (#1132)", () => {
  test("reads every flag", () => {
    expect(
      parseArgs([
        "--require-live",
        "--output-dir", "out",
        "--intended-tag", "ios-v1.0.3-build9",
        "--release-owner", "Pat",
        "--tracking-issue", "#5",
        "--submission-url", "https://example.com/s",
      ]),
    ).toEqual({
      requireLive: true,
      outputDir: "out",
      intendedTag: "ios-v1.0.3-build9",
      releaseOwner: "Pat",
      trackingIssue: "#5",
      submissionUrl: "https://example.com/s",
    });
    expect(parseArgs([])).toEqual({});
  });

  test("refuses an unknown flag", () => {
    expect(() => parseArgs(["--submit"])).toThrow("Unknown argument: --submit");
  });

  test.each([[["--output-dir"]], [["--intended-tag", "--require-live"]]])("refuses a flag without a value: %j", (argv) => {
    expect(() => parseArgs(argv)).toThrow(`Missing value for ${argv[0]}`);
  });
});

describe("extractProjectVersion (#1132)", () => {
  test("reads the version, build, bundle ID, and encryption flag", () => {
    const yml = [
      '    MARKETING_VERSION: "1.0.3"',
      "    CURRENT_PROJECT_VERSION: 31",
      "    PRODUCT_BUNDLE_IDENTIFIER: me.still-point.app",
      "    ITSAppUsesNonExemptEncryption: false",
    ].join("\n");

    expect(extractProjectVersion(yml)).toEqual({
      marketingVersion: "1.0.3",
      buildNumber: "31",
      bundleId: "me.still-point.app",
      usesNonExemptEncryption: false,
    });
  });

  test("leaves what it can't find undefined", () => {
    expect(extractProjectVersion("name: StillPoint\n")).toEqual({
      marketingVersion: undefined,
      buildNumber: undefined,
      bundleId: undefined,
      usesNonExemptEncryption: false,
    });
  });
});

/** A report context whose log does not print. */
function quietContext() {
  const context = createReportContext();
  vi.spyOn(console, "log").mockImplementation(() => {});
  return context;
}

describe("createReportContext (#1132)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  test("keeps each run's checks and logs apart", () => {
    const first = quietContext();
    const second = quietContext();

    first.pass("A1", "ok", { n: 1 });
    first.warn("B2", "careful");
    first.fail("A5", "missing");
    first.log("hello");

    expect(first.checks).toEqual([
      { id: "A1", status: "pass", message: "ok", evidence: { n: 1 } },
      { id: "B2", status: "warning", message: "careful", evidence: {} },
      { id: "A5", status: "fail", message: "missing", evidence: {} },
    ]);
    expect(first.logs).toEqual([expect.stringMatching(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z hello$/)]);
    expect(second.checks).toEqual([]);
    expect(second.logs).toEqual([]);
  });
});

describe("runLocalChecks A3-A5 (#1132)", () => {
  const goodDocs = {
    readme: "See ios/RELEASING.md and docs/operations/ios-app-store-submission.md.",
    submissionRunbook: "ABCDEF".split("").map((phase) => `### Phase ${phase} \u2014 Step`).join("\n"),
    workflow: "on:\n  push:\n    tags:\n      - 'ios-v*-build*'\n",
    releaseWorkflow: "on:\n  push:\n    tags:\n      - 'ios-v*.*.*'\n",
    parity: [
      "- [x] Feature parity checklist between iOS and web is completed.",
      "- [X] All critical parity gaps are fixed or explicitly deferred with owner/date.",
    ].join("\n"),
    qa: [
      "- [x] Regression/QA pass for release candidate is completed.",
      "- [x] App Store metadata/versioning/release notes are finalized.",
    ].join("\n"),
  };
  const intended = { marketingVersion: "1.0.3", buildNumber: "31", intendedTag: "ios-v1.0.3-build31", source: "origin" };
  const project = { marketingVersion: "1.0.3", buildNumber: "31" };

  function statuses(docs: typeof goodDocs) {
    const context = createReportContext();
    runLocalChecks(context, { docs, intended, project });
    return Object.fromEntries(context.checks.map((check) => [check.id, check.status]));
  }

  test("passes A1-A5 on complete docs", () => {
    expect(statuses(goodDocs)).toEqual({ A1: "pass", A2: "pass", A3: "pass", A4: "pass", A5: "pass" });
  });

  test("A3 fails when the runbook is missing a phase", () => {
    expect(statuses({ ...goodDocs, submissionRunbook: "### Phase A \u2014 Step\n### Phase B \u2014 Step\n" }).A3).toBe("fail");
  });

  test.each([
    ["the TestFlight workflow has no build-tag trigger", { workflow: "on:\n  push:\n    tags:\n      - 'ios-v*'\n" }],
    ["the release workflow has no tag trigger", { releaseWorkflow: "on: workflow_dispatch\n" }],
  ])("A4 fails when %s", (_label, change) => {
    expect(statuses({ ...goodDocs, ...change }).A4).toBe("fail");
  });

  test.each([
    ["a parity item is unchecked", { parity: goodDocs.parity.replace("- [X]", "- [ ]") }],
    ["a QA item is unchecked", { qa: goodDocs.qa.replace("- [x] Regression", "- [ ] Regression") }],
    ["a parity item is indented, not a top-level checklist line", { parity: goodDocs.parity.replace("- [x]", "  - [x]") }],
  ])("A5 fails when %s", (_label, change) => {
    expect(statuses({ ...goodDocs, ...change }).A5).toBe("fail");
  });
});

describe("checkWorkflowSecrets B2 (#1132)", () => {
  const SECRETS = [
    "BUILD_CERTIFICATE_BASE64",
    "P12_PASSWORD",
    "BUILD_PROVISION_PROFILE_BASE64",
    "BUILD_PROVISION_PROFILE_EXTENSION_BASE64",
    "BUILD_PROVISION_PROFILE_WIDGET_BASE64",
    "APPSTORE_API_KEY_ID",
    "APPSTORE_API_ISSUER_ID",
    "APPSTORE_API_PRIVATE_KEY",
  ];
  const refs = (names: string[]) => names.map((name) => `\${{ secrets.${name} }}`).join("\n");
  // The TestFlight workflow holds the signing secrets, the release workflow the API key.
  const docs = { workflow: refs(SECRETS.slice(0, 5)), releaseWorkflow: refs(SECRETS.slice(5)) };
  const listed = (names: string[]) => () => ({ available: true, names });

  test("fails, naming them, when a workflow doesn't reference every secret", () => {
    const context = createReportContext();

    const secretStatus = checkWorkflowSecrets(
      context,
      { ...docs, releaseWorkflow: refs(["APPSTORE_API_KEY_ID"]) },
      listed(SECRETS),
    );

    expect(context.checks).toEqual([
      expect.objectContaining({
        id: "B2",
        status: "fail",
        evidence: {
          requiredWorkflowSecrets: SECRETS,
          workflowSecretRefs: SECRETS.slice(0, 6),
          missingWorkflowRefs: ["APPSTORE_API_ISSUER_ID", "APPSTORE_API_PRIVATE_KEY"],
        },
      }),
    ]);
    expect(secretStatus).toEqual({
      status: "fail",
      message: "Workflow(s) missing required secret references: APPSTORE_API_ISSUER_ID, APPSTORE_API_PRIVATE_KEY.",
    });
  });

  test("passes, with one message for the check and the checklist, when GitHub lists every secret", () => {
    const context = createReportContext();

    const secretStatus = checkWorkflowSecrets(context, docs, listed(SECRETS));

    expect(context.checks).toEqual([expect.objectContaining({ id: "B2", status: "pass" })]);
    expect(secretStatus).toEqual({ status: "pass", message: context.checks[0].message });
  });

  test("warns, naming them, when GitHub lacks a secret", () => {
    const context = createReportContext();

    const secretStatus = checkWorkflowSecrets(context, docs, listed(SECRETS.slice(1)));

    expect(context.checks[0]).toMatchObject({ status: "warning", evidence: { missingGithubSecrets: ["BUILD_CERTIFICATE_BASE64"] } });
    expect(secretStatus).toEqual({ status: "warning", message: "GitHub secret names missing: BUILD_CERTIFICATE_BASE64." });
  });

  test("warns when GitHub's secrets can't be listed", () => {
    const context = createReportContext();

    const secretStatus = checkWorkflowSecrets(context, docs, () => ({ available: false, reason: "gh: not logged in", names: [] }));

    expect(context.checks[0]).toMatchObject({ status: "warning", evidence: { reason: "gh: not logged in" } });
    expect(secretStatus).toEqual({
      status: "warning",
      message: "Workflows reference required secrets; GitHub secret list unavailable: gh: not logged in.",
    });
  });
});

describe("evaluateAsc (#1132)", () => {
  const project = { marketingVersion: "1.0.3", buildNumber: "31" };
  const offline = async () => ({ live: false, reason: "no credentials" });
  const live = (intendedBuild: object | null) => async () => ({ live: true, intendedBuild });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  async function run(query: () => Promise<unknown>, requireLive = false) {
    const context = quietContext();
    const asc = await evaluateAsc(context, { project, requireLive }, query);
    return { asc, checks: context.checks.map(({ id, status }) => [id, status]) };
  }

  test("records no check when the query is skipped without --require-live", async () => {
    expect(await run(offline)).toEqual({ asc: { live: false, reason: "no credentials" }, checks: [] });
  });

  test("a query that throws is a warning, and the run goes on offline", async () => {
    const result = await run(async () => {
      throw new Error("ASC 500");
    });

    expect(result).toEqual({ asc: { live: false, reason: "ASC 500" }, checks: [["ASC", "warning"]] });
  });

  test("a query that throws fails with --require-live", async () => {
    const result = await run(async () => {
      throw new Error("ASC 500");
    }, true);

    expect(result.checks).toEqual([["ASC", "warning"], ["ASC_REQUIRE_LIVE", "fail"]]);
  });

  test("a skipped query fails with --require-live", async () => {
    expect((await run(offline, true)).checks).toEqual([["ASC_REQUIRE_LIVE", "fail"]]);
  });

  test("fails a live intended build that is not VALID", async () => {
    expect((await run(live({ version: "31", processingState: "PROCESSING" }))).checks).toEqual([["ASC_BUILD_STATE", "fail"]]);
  });

  test("fails when the live query finds no intended build", async () => {
    expect((await run(live(null), true)).checks).toEqual([["ASC_BUILD_MISSING", "fail"]]);
  });

  test("passes a live VALID intended build", async () => {
    expect((await run(live({ version: "31", processingState: "VALID" }), true)).checks).toEqual([]);
  });
});

describe("classifyIssueChecklist (#1132)", () => {
  const project = { marketingVersion: "1.0.3", buildNumber: "31" };
  const secretStatus = { status: "warning", message: "GitHub secret names missing: P12_PASSWORD." };
  type Asc = { live: boolean; reason?: string; intendedBuild?: { processingState?: string } | null };
  type CheckRecord = { id: string; status: string; message: string; evidence: object };
  const classify = (asc: Asc, requireLive = false, checks: CheckRecord[] = []) =>
    classifyIssueChecklist({ checks, secretStatus, project, asc, trackingIssue: "#5", requireLive });
  const item = (list: { id: string }[], id: string) => list.find((entry) => entry.id === id);

  test.each([
    ["offline", { live: false, reason: "no credentials" }, false, "warning", "no credentials"],
    ["offline with --require-live", { live: false, reason: "no credentials" }, true, "fail", "no credentials"],
    ["live without the intended build", { live: true, intendedBuild: null }, false, "fail", "Intended TestFlight build was not found in App Store Connect."],
    ["live and VALID", { live: true, intendedBuild: { processingState: "VALID" } }, false, "pass", "ASC build query completed and the intended build is VALID."],
    ["live and still processing", { live: true, intendedBuild: { processingState: "PROCESSING" } }, false, "fail", "Intended TestFlight build is PROCESSING."],
  ])("B5 %s", (_label, asc, requireLive, status, message) => {
    expect(item(classify(asc, requireLive), "B5")).toMatchObject({ status, message, evidence: { version: "1.0.3", build: "31" } });
  });

  test("lists all 38 items, in order", () => {
    expect(classify({ live: false, reason: "x" }).map((entry: { id: string }) => entry.id)).toEqual(ISSUE_242_IDS);
  });

  test("a check covering an item wins over the table", () => {
    const checks = [{ id: "B2", status: "pass", message: "from the check", evidence: { a: 1 } }];

    expect(item(classify({ live: false, reason: "x" }, false, checks), "B2")).toMatchObject({
      status: "pass",
      message: "from the check",
      evidence: { a: 1 },
    });
  });

  test("B2 falls back to the secret status without a B2 check, and E1 names the tracking issue", () => {
    const list = classify({ live: false, reason: "x" });

    expect(item(list, "B2")).toMatchObject(secretStatus);
    expect(item(list, "E1")).toMatchObject({ message: expect.stringContaining("GitHub issue #5") });
  });
});

describe("writeMarkdown (#1132)", () => {
  test("escapes | in checklist messages so the table keeps its columns", () => {
    const report = {
      generatedAt: "2026-10-27T00:00:00.000Z",
      project: { marketingVersion: "1.0.3", buildNumber: "31", bundleId: "me.still-point.app" },
      intendedTag: "ios-v1.0.3-build31",
      intendedBuild: { source: "origin" },
      releaseOwner: "Pat",
      submissionUrl: "UNSET_SUBMISSION_URL",
      preflightSummary: {},
      humanGates: [],
      fallbackPaths: [],
      issue242Checklist: [{ id: "B2", status: "warning", text: "Secrets", message: "a | b || c" }],
      logs: [],
    };

    expect(writeMarkdown(report)).toContain("| B2 | warning | Secrets | a \\| b \\|\\| c |\n");
  });
});

// Dashes are escaped: \u2013 is an en dash, \u2014 an em dash.
describe("extractRunbookPhases (#910)", () => {
  test("finds phases A through F, in order, in the real submission runbook", () => {
    const runbook = fs.readFileSync(path.join(REPO_ROOT, "docs/operations/ios-app-store-submission.md"), "utf8");

    expect(extractRunbookPhases(runbook)).toEqual(["A", "B", "C", "D", "E", "F"]);
  });

  test.each([
    ["the runbook's h3 em-dash heading", "### Phase A \u2014 Preconditions before submission"],
    ["an h3 en-dash heading", "### Phase A \u2013 Preconditions before submission"],
    ["the h2 hyphen heading from before #644", "## Phase A - Preconditions before submission"],
  ])("accepts %s", (_shape, heading) => {
    expect(extractRunbookPhases(`Intro.\n\n${heading}\n\n| # | Check |\n`)).toEqual(["A"]);
  });

  test.each([
    ["the checklist's parent heading", "## Release checklist (Phases A\u2013F)"],
    ["an h4 heading", "#### Phase A \u2014 Preconditions before submission"],
    ["an h1 heading", "# Phase A \u2014 Preconditions before submission"],
    ["a phase named outside a heading", "Phase A \u2014 Preconditions before submission"],
    ["a letter after F", "### Phase G \u2014 After release"],
  ])("ignores %s", (_shape, line) => {
    expect(extractRunbookPhases(`${line}\n`)).toEqual([]);
  });

  test("keeps document order, so A3 catches phases out of order", () => {
    const runbook = ["### Phase B \u2014 Version", "## Phase A - Preconditions", "### Phase C \u2013 Review"].join("\n");

    expect(extractRunbookPhases(runbook)).toEqual(["B", "A", "C"]);
  });
});

// The real script, run the way `npm run ios:app-store:dry-run` runs it, against a
// throwaway origin (through GIT_DIR) so the intended build is known, and a stubbed
// gh. Its other checks read this checkout as usual; the tests read back only the
// intended build and B2.
describe("ios-app-store-dry-run.mjs intended build and B2 (#838, #937)", { timeout: 30_000 }, () => {
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

    /**
     * Runs the dry run and returns its exit status, summary.json, summary.md, and
     * automation.log. Every run asserts the exit-status contract: 1 when any check
     * failed, 0 otherwise. Which checks fail depends on this checkout's release
     * checklists (A5), so the tests compare the two instead of a fixed status.
     */
    const dryRun = (...args: string[]) => {
      const outputDir = fs.mkdtempSync(path.join(root, "out-"));
      const result = spawnSync(process.execPath, [DRY_RUN, "--output-dir", outputDir, ...args], {
        cwd: REPO_ROOT,
        env,
        encoding: "utf8",
      });
      const output = `${result.stdout}\n${result.stderr}`;
      for (const artifact of ["summary.json", "summary.md", "automation.log"]) {
        expect(fs.existsSync(path.join(outputDir, artifact)), `${artifact}\n${output}`).toBe(true);
      }
      const summary = JSON.parse(fs.readFileSync(path.join(outputDir, "summary.json"), "utf8"));
      const failed = (summary.checks as Check[]).some((check) => check.status === "fail");
      expect(result.status, output).toBe(failed ? 1 : 0);
      return {
        status: result.status,
        summary,
        markdown: fs.readFileSync(path.join(outputDir, "summary.md"), "utf8"),
        automationLog: fs.readFileSync(path.join(outputDir, "automation.log"), "utf8"),
      };
    };

    return { git, dryRun, bin };
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

    const { status, summary } = dryRun("--intended-tag", "ios-v1.0.3");

    expect(status).toBe(1);
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

  test("records the report shape and check order (#1132)", () => {
    const { dryRun } = setup();

    const { summary, automationLog } = dryRun();

    expect(Object.keys(summary)).toEqual([
      "generatedAt",
      "issue",
      "dryRunMode",
      "project",
      "intendedTag",
      "intendedBuild",
      "releaseOwner",
      "submissionUrl",
      "workflows",
      "asc",
      "checks",
      "humanGates",
      "fallbackPaths",
      "logs",
      "preflightSummary",
      "issue242Checklist",
    ]);
    expect((summary.checks as Check[]).map((check) => check.id)).toEqual([
      "A1", "A2", "A3", "A4", "A5", "B2", "C4", "C7", "D1", "D4", "E2", "F1", "F2", "DOD1", "DOD2",
    ]);
    expect((summary.issue242Checklist as ChecklistItem[]).map((item) => item.id)).toEqual(ISSUE_242_IDS);
    expect(summary.humanGates).toEqual(HUMAN_GATES);
    expect(summary.preflightSummary.unresolvedHumanGates).toEqual(HUMAN_GATES);
    expect(summary.fallbackPaths).toEqual(fallbackPathsFor("the tracking issue"));
    expect(summary.asc).toMatchObject({ live: false });
    expect(automationLog.trimEnd().split("\n")).toEqual(summary.logs);
    expect(summary.logs.map((entry: string) => entry.replace(/^\S+ /, ""))).toEqual([
      "Reading canonical iOS release docs and workflow.",
      "Listing ios-v*-build* tags for the intended build.",
      "Intended build: 1.0.3 (10), tag ios-v1.0.3-build10, from the highest build tag on origin.",
      "Checking App Store Connect live-query readiness.",
      expect.stringMatching(/^App Store Connect live queries skipped: Set APPSTORE_APP_ID/),
    ]);
  });

  test("--tracking-issue names the issue in the fallback paths", () => {
    const { dryRun } = setup();

    const { summary } = dryRun("--tracking-issue", "#999", "--release-owner", "Pat", "--submission-url", "https://example.com/s");

    expect(summary.fallbackPaths).toEqual(fallbackPathsFor("#999"));
    expect(summary).toMatchObject({ releaseOwner: "Pat", submissionUrl: "https://example.com/s" });
  });

  test("--require-live without App Store Connect credentials fails, with every artifact written", () => {
    const { dryRun } = setup();

    const { status, summary } = dryRun("--require-live");

    expect(status).toBe(1);
    expect((summary.checks as Check[]).at(-1)).toMatchObject({ id: "ASC_REQUIRE_LIVE", status: "fail" });
    const checklist = summary.issue242Checklist as (ChecklistItem & { status: string })[];
    for (const id of ["B1", "B5", "C1", "C2", "C3", "E3", "DOD3"]) {
      expect(checklist.find((item) => item.id === id)?.status, id).toBe("fail");
    }
  });

  /** The secrets B2 requires (#937), kept apart from the script's own list. */
  const B2_SECRETS = [
    "BUILD_CERTIFICATE_BASE64",
    "P12_PASSWORD",
    "BUILD_PROVISION_PROFILE_BASE64",
    "BUILD_PROVISION_PROFILE_EXTENSION_BASE64",
    "BUILD_PROVISION_PROFILE_WIDGET_BASE64",
    "APPSTORE_API_KEY_ID",
    "APPSTORE_API_ISSUER_ID",
    "APPSTORE_API_PRIVATE_KEY",
  ];
  const EXTENSION_PROFILES = ["BUILD_PROVISION_PROFILE_EXTENSION_BASE64", "BUILD_PROVISION_PROFILE_WIDGET_BASE64"];

  /** What gh reports, the names it lists (null: it fails), B2's status, and the names B2 finds missing. */
  type B2Case = [label: string, listed: string[] | null, status: string, missingGithubSecrets?: string[]];

  test.each<B2Case>([
    ["cannot list the repository's secrets", null, "warning"],
    ["lists every required name", B2_SECRETS, "pass"],
    [
      "lists all but the extension profiles",
      B2_SECRETS.filter((name) => !EXTENSION_PROFILES.includes(name)),
      "warning",
      EXTENSION_PROFILES,
    ],
  ])("B2 checks all eight secrets when gh %s", (_label, listed, status, missingGithubSecrets) => {
    const { dryRun, bin } = setup();
    if (listed) {
      const names = JSON.stringify(listed.map((name) => ({ name })));
      fs.writeFileSync(path.join(bin, "gh"), `#!/bin/sh\necho '${names}'\n`);
    }

    const { summary } = dryRun();

    expect(summary.workflows.requiredSecrets).toEqual(B2_SECRETS);
    const b2 = (summary.checks as Check[]).find((check) => check.id === "B2");
    expect(b2).toMatchObject({
      status,
      evidence: { requiredWorkflowSecrets: B2_SECRETS, ...(missingGithubSecrets ? { missingGithubSecrets } : {}) },
    });
    // The workflows reference every name, so a name GitHub lacks is a warning, never a failure.
    expect(b2?.evidence).not.toHaveProperty("missingWorkflowRefs");
    const item = (summary.issue242Checklist as ChecklistItem[]).find((entry) => entry.id === "B2");
    expect(item?.evidence).toMatchObject({ requiredWorkflowSecrets: B2_SECRETS });
  });
});
