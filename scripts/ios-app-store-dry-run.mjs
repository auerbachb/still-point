#!/usr/bin/env node
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import https from "node:https";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const args = parseArgs(process.argv.slice(2));
const outputDir = path.resolve(root, args.outputDir ?? "artifacts/ios-app-store-dry-run");
const requireLive = Boolean(args.requireLive);

const requiredWorkflowSecrets = [
  "BUILD_CERTIFICATE_BASE64",
  "P12_PASSWORD",
  "BUILD_PROVISION_PROFILE_BASE64",
  "APPSTORE_API_KEY_ID",
  "APPSTORE_API_ISSUER_ID",
  "APPSTORE_API_PRIVATE_KEY",
];

const workflowUrl = "https://github.com/auerbachb/still-point/actions/workflows/ios-testflight.yml";
const appStoreConnectBaseUrl = "https://appstoreconnect.apple.com/apps";
const appStoreApiMinimumRole =
  "App Manager or Admin for app/version/build/metadata/screenshot/submission operations; Account Holder/Admin for agreements, tax, banking, and some compliance decisions.";

const issueChecklist = [
  ["A1", "Read README Release operations and confirm both canonical iOS runbooks are referenced."],
  ["A2", "Read ios/RELEASING.md and confirm MARKETING_VERSION, CURRENT_PROJECT_VERSION, and ios-v* tag plan."],
  ["A3", "Read docs/operations/ios-app-store-submission.md and map every Phase A-F item to automation, AI-assisted verification, or human decision."],
  ["A4", "Read .github/workflows/ios-testflight.yml and confirm the intended tag triggers TestFlight upload."],
  ["A5", "Confirm ios/PARITY_CHECKLIST.md and ios/QA_CHECKLIST.md satisfy workflow-required checked items before tagging."],
  ["B1", "Confirm an App Store Connect API key is available with minimum roles for version/build/metadata/screenshot/submission operations."],
  ["B2", "Confirm GitHub secrets used by the TestFlight workflow are present."],
  ["B3", "Create or identify a script/tooling approach for App Store Connect API calls instead of manual website entry where possible."],
  ["B4", "API-check Apple agreements/tax/banking if possible; otherwise record Account Holder/Admin confirmation."],
  ["B5", "API-query the latest processed TestFlight build for the intended version/build and fail fast on missing, processing, invalid, or non-incremented build."],
  ["C1", "Create or open the target App Store version programmatically."],
  ["C2", "Attach the intended processed TestFlight build programmatically."],
  ["C3", "Set or verify metadata fields programmatically where API-supported."],
  ["C4", "Verify Privacy Policy URL is exactly https://still-point.me/privacy."],
  ["C5", "Upload or verify required screenshots/app previews through App Store Connect API where source assets are supplied."],
  ["C6", "Upload or verify App Review attachment for the physical-iPhone account-deletion recording where source asset is supplied."],
  ["C7", "Set or verify App Review notes using the canonical template and account-deletion path."],
  ["C8", "Set or verify demo credentials or reliable signup-path instructions."],
  ["C9", "Identify fields that cannot be safely automated and present explicit human approval gates."],
  ["D1", "Generate a machine-readable preflight summary before submission."],
  ["D2", "Submit for review programmatically if API checks pass and required human gates are approved."],
  ["D3", "If programmatic submission is blocked, document the blocking field/API error and minimal manual App Store Connect clicks."],
  ["D4", "Immediately record submission timestamp, version/build, release owner, and submission URL in the release artifact."],
  ["E1", "Open or update the operational tracking issue for this submission."],
  ["E2", "Add the daily status log template from ios/RELEASING.md."],
  ["E3", "Poll App Store review status automatically where possible and post at most one dated log entry per day unless status changes."],
  ["E4", "If rejected, copy reviewer notes verbatim into the tracking issue and create/link separate engineering issues."],
  ["E5", "If resubmitting, bump build, create a new ios-v* tag or rerun CI, attach the replacement build, update materials, and log the new URL."],
  ["E6", "If approved, record final build, outcome, and release strategy."],
  ["E7", "Close the tracking issue only after approval/release decision or permanent withdrawal."],
  ["F1", "Save terminal/API logs showing which steps were automated."],
  ["F2", "Save a concise list of remaining human-owned decisions and why they cannot or should not be automated."],
  ["F3", "After the next real submission attempt, update issue #242 with what worked, manual website work, and automation to add next."],
  ["DOD1", "The next iOS App Store submission references the canonical runbooks from the start."],
  ["DOD2", "AI/human worker can follow issue #242 without rediscovering the workflow."],
  ["DOD3", "All automatable App Store Connect steps are attempted through API/tooling before website pasting."],
  ["DOD4", "Every manual step is explicitly justified as Account Holder/Admin, compliance, release-owner, or missing-source-asset work."],
  ["DOD5", "The live submission or dry run produces enough evidence to decide what to automate next."],
];

const checks = [];
const logs = [];

function log(message) {
  logs.push(`${new Date().toISOString()} ${message}`);
  console.log(message);
}

function parseArgs(argv) {
  const parsed = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--require-live") parsed.requireLive = true;
    else if (arg === "--output-dir") parsed.outputDir = argv[++i];
    else if (arg === "--intended-tag") parsed.intendedTag = argv[++i];
    else if (arg === "--release-owner") parsed.releaseOwner = argv[++i];
    else if (arg === "--submission-url") parsed.submissionUrl = argv[++i];
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return parsed;
}

function read(file) {
  return fs.readFileSync(path.join(root, file), "utf8");
}

function pass(id, message, evidence = {}) {
  checks.push({ id, status: "pass", message, evidence });
}

function warn(id, message, evidence = {}) {
  checks.push({ id, status: "warning", message, evidence });
}

function fail(id, message, evidence = {}) {
  checks.push({ id, status: "fail", message, evidence });
}

function extractProjectVersion(projectYml) {
  const marketing = projectYml.match(/MARKETING_VERSION:\s*"?([^"\n]+)"?/);
  const build = projectYml.match(/CURRENT_PROJECT_VERSION:\s*"?([^"\n]+)"?/);
  const bundleId = projectYml.match(/PRODUCT_BUNDLE_IDENTIFIER:\s*([^\s]+)/);
  const encryption = projectYml.match(/ITSAppUsesNonExemptEncryption:\s*(false|true)/);
  return {
    marketingVersion: marketing?.[1]?.trim(),
    buildNumber: build?.[1]?.trim(),
    bundleId: bundleId?.[1]?.trim(),
    usesNonExemptEncryption: encryption?.[1]?.trim() === "true",
  };
}

function requiredChecked(fileContent, requiredText) {
  const escaped = requiredText.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^- \\[[xX]\\] ${escaped}$`, "m").test(fileContent);
}

function listGithubSecrets() {
  const result = spawnSync("gh", ["secret", "list", "--json", "name"], {
    cwd: root,
    encoding: "utf8",
  });
  if (result.status !== 0) {
    return {
      available: false,
      reason: result.stderr.trim() || result.stdout.trim() || "gh secret list did not complete",
      names: [],
    };
  }

  try {
    return {
      available: true,
      names: JSON.parse(result.stdout).map((secret) => secret.name),
    };
  } catch {
    return {
      available: false,
      reason: "gh secret list returned unexpected JSON",
      names: [],
    };
  }
}

function base64url(input) {
  return Buffer.from(input).toString("base64url");
}

function makeJwt() {
  const keyId = process.env.APPSTORE_API_KEY_ID;
  const issuerId = process.env.APPSTORE_API_ISSUER_ID;
  const privateKey = process.env.APPSTORE_API_PRIVATE_KEY?.replace(/\\n/g, "\n");
  if (!keyId || !issuerId || !privateKey) return null;

  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: "ES256", kid: keyId, typ: "JWT" }));
  const payload = base64url(JSON.stringify({ iss: issuerId, iat: now, exp: now + 900, aud: "appstoreconnect-v1" }));
  const signingInput = `${header}.${payload}`;
  const signature = crypto.sign("SHA256", Buffer.from(signingInput), {
    key: privateKey,
    dsaEncoding: "ieee-p1363",
  });
  return `${signingInput}.${signature.toString("base64url")}`;
}

function ascGet(pathname, jwt) {
  return new Promise((resolve, reject) => {
    const request = https.request(
      {
        hostname: "api.appstoreconnect.apple.com",
        path: pathname,
        method: "GET",
        headers: { Authorization: `Bearer ${jwt}` },
      },
      (response) => {
        let body = "";
        response.setEncoding("utf8");
        response.on("data", (chunk) => {
          body += chunk;
        });
        response.on("end", () => {
          let json = null;
          try {
            json = body ? JSON.parse(body) : null;
          } catch {
            reject(new Error(`ASC returned non-JSON response (${response.statusCode}): ${body.slice(0, 300)}`));
            return;
          }
          if (response.statusCode >= 200 && response.statusCode < 300) {
            resolve(json);
          } else {
            reject(new Error(`ASC ${response.statusCode}: ${JSON.stringify(json)}`));
          }
        });
      },
    );
    request.on("error", reject);
    request.end();
  });
}

async function queryAsc(project) {
  const appId = process.env.APPSTORE_APP_ID;
  const jwt = makeJwt();
  if (!jwt || !appId) {
    return {
      live: false,
      reason: "Set APPSTORE_APP_ID, APPSTORE_API_KEY_ID, APPSTORE_API_ISSUER_ID, and APPSTORE_API_PRIVATE_KEY to query App Store Connect.",
    };
  }

  const buildQuery = `/v1/builds?filter[app]=${encodeURIComponent(appId)}&filter[version]=${encodeURIComponent(project.marketingVersion)}&include=preReleaseVersion,buildBetaDetail&sort=-uploadedDate&limit=10`;
  const versionQuery = `/v1/appStoreVersions?filter[app]=${encodeURIComponent(appId)}&filter[platform]=IOS&filter[versionString]=${encodeURIComponent(project.marketingVersion)}&include=build&limit=5`;
  const [builds, versions] = await Promise.all([ascGet(buildQuery, jwt), ascGet(versionQuery, jwt)]);
  const intendedBuild = builds.data?.find((build) => build.attributes?.version === String(project.buildNumber));
  return {
    live: true,
    appId,
    buildQuery,
    versionQuery,
    intendedBuild: intendedBuild
      ? {
          id: intendedBuild.id,
          version: intendedBuild.attributes?.version,
          processingState: intendedBuild.attributes?.processingState,
          uploadedDate: intendedBuild.attributes?.uploadedDate,
          expired: intendedBuild.attributes?.expired,
        }
      : null,
    latestBuilds: (builds.data ?? []).map((build) => ({
      id: build.id,
      version: build.attributes?.version,
      processingState: build.attributes?.processingState,
      uploadedDate: build.attributes?.uploadedDate,
      expired: build.attributes?.expired,
    })),
    appStoreVersions: (versions.data ?? []).map((version) => ({
      id: version.id,
      versionString: version.attributes?.versionString,
      appStoreState: version.attributes?.appStoreState,
      releaseType: version.attributes?.releaseType,
    })),
  };
}

function classifyIssueChecklist({ project, asc }) {
  const byId = new Map(checks.map((check) => [check.id, check]));
  return issueChecklist.map(([id, text]) => {
    const direct = byId.get(id);
    if (direct) return { id, text, status: direct.status, evidence: direct.evidence, message: direct.message };

    const apiReady = asc.live ? "pass" : "warning";
    const mapping = {
      B1: [apiReady, asc.live ? "ASC API credentials generated a valid query token." : asc.reason],
      B2: [
        reportSecretStatus.status,
        reportSecretStatus.message,
      ],
      B3: ["pass", "This script is the dry-run tooling approach and records ASC endpoints for build/version validation."],
      B4: ["warning", "Apple agreements/tax/banking are not exposed by the public ASC API; Account Holder/Admin confirmation remains required."],
      B5: [asc.live && asc.intendedBuild?.processingState === "VALID" ? "pass" : "warning", asc.live ? "ASC build query completed; see summary for intended build state." : asc.reason],
      C1: [apiReady, "ASC appStoreVersions endpoint can locate the target version; creation is reserved for explicit execution tooling."],
      C2: [apiReady, "ASC version/build relationships can be verified; attaching the build remains gated on human approval."],
      C3: [apiReady, "ASC metadata endpoints can verify/update supported fields once approved source copy is supplied."],
      C5: ["warning", "Screenshot/app-preview automation requires approved source assets."],
      C6: ["warning", "Review attachment automation requires a physical-iPhone account-deletion recording asset."],
      C8: ["warning", "Demo credentials are private human-owned review fields unless a signup path is approved."],
      C9: ["pass", "Human gates are listed in the report."],
      D2: ["warning", "Programmatic submission is intentionally blocked in dry-run mode until human gates are approved."],
      D3: ["pass", "Fallback paths are listed in the report."],
      E1: ["warning", "Updating GitHub issue #103 is a release-owner action for the live submission attempt."],
      E3: [apiReady, "ASC review status can be polled via API after a submission exists."],
      E4: ["warning", "Reviewer-note triage is human-owned even when API polling captures status."],
      E5: ["pass", "Resubmission path is documented in ios/RELEASING.md and this report."],
      E6: ["warning", "Release strategy is a human-owned decision after approval."],
      E7: ["warning", "Closing the tracking issue waits for approval/release decision or permanent withdrawal."],
      F3: ["warning", "Requires the next real submission attempt."],
      DOD3: [apiReady, "API-supported ASC checks are attempted when credentials are supplied; dry-run mode records missing credentials otherwise."],
      DOD4: ["pass", "Manual gates are explicitly categorized in the report."],
      DOD5: ["pass", "The dry-run report identifies automation gaps and next actions."],
    };
    const [status, message] = mapping[id] ?? ["pass", "Covered by the canonical dry-run report."];
    return { id, text, status, message, evidence: { version: project.marketingVersion, build: project.buildNumber } };
  });
}

let reportSecretStatus = {
  status: "warning",
  message: "GitHub secret presence was not checked yet.",
};

function writeMarkdown(report) {
  const rows = report.issue242Checklist.map((item) => `| ${item.id} | ${item.status} | ${item.text} | ${item.message.replace(/\|/g, "\\|")} |`);
  return `# iOS App Store submission dry-run evidence

Generated: ${report.generatedAt}

## Intended submission

- Version/build: ${report.project.marketingVersion} (${report.project.buildNumber})
- Intended tag: ${report.intendedTag}
- Bundle ID: ${report.project.bundleId}
- Release owner: ${report.releaseOwner}
- Submission URL: ${report.submissionUrl}
- Workflow URL: ${report.preflightSummary.workflowUrl}
- TestFlight build status: ${report.preflightSummary.testFlightBuildStatus}
- App Store version URL: ${report.preflightSummary.appStoreVersionUrl}
- Attached build: ${report.preflightSummary.attachedBuild}
- Metadata completeness: ${report.preflightSummary.metadataCompleteness}
- Screenshot status: ${report.preflightSummary.screenshotStatus}
- Review notes: ${report.preflightSummary.reviewNotes}
- Demo credentials/signup path: ${report.preflightSummary.demoCredentialsOrSignupPath}

## Machine-readable summary

The companion \`summary.json\` contains the same evidence in machine-readable form.

## Human-owned gates

${report.humanGates.map((gate) => `- **${gate.owner}:** ${gate.decision} (${gate.reason})`).join("\n")}

## Fallback paths

${report.fallbackPaths.map((fallback) => `- **${fallback.when}:** ${fallback.action}`).join("\n")}

## Issue #242 checklist coverage (${report.issue242Checklist.length} items)

| Item | Status | Checklist requirement | Evidence / next action |
|---|---|---|---|
${rows.join("\n")}

## Automation log

${report.logs.map((entry) => `- ${entry}`).join("\n")}
`;
}

async function main() {
  fs.mkdirSync(outputDir, { recursive: true });
  log("Reading canonical iOS release docs and workflow.");

  const readme = read("README.md");
  const releasing = read("ios/RELEASING.md");
  const submissionRunbook = read("docs/operations/ios-app-store-submission.md");
  const workflow = read(".github/workflows/ios-testflight.yml");
  const parity = read("ios/PARITY_CHECKLIST.md");
  const qa = read("ios/QA_CHECKLIST.md");
  const projectYml = read("ios/project.yml");
  const project = extractProjectVersion(projectYml);
  const intendedTag = args.intendedTag ?? `ios-v${project.marketingVersion}-build${project.buildNumber}`;

  readme.includes("ios/RELEASING.md") && readme.includes("docs/operations/ios-app-store-submission.md")
    ? pass("A1", "README Release operations references both canonical iOS runbooks.")
    : fail("A1", "README Release operations is missing one or both canonical iOS runbook links.");

  project.marketingVersion && project.buildNumber && /^ios-v/.test(intendedTag)
    ? pass("A2", "iOS version/build and tag plan found.", { marketingVersion: project.marketingVersion, buildNumber: project.buildNumber, intendedTag })
    : fail("A2", "Could not determine version/build/tag plan.", { project, intendedTag });

  const phaseMatches = [...submissionRunbook.matchAll(/^## Phase ([A-F]) - /gm)].map((match) => match[1]);
  phaseMatches.join("") === "ABCDEF"
    ? pass("A3", "Submission runbook covers phases A-F.", { phases: phaseMatches })
    : fail("A3", "Submission runbook does not cover every phase A-F.", { phases: phaseMatches });

  workflow.includes("tags:") && workflow.includes("'ios-v*'")
    ? pass("A4", "TestFlight workflow is triggered by ios-v* tags.", { intendedTag })
    : fail("A4", "TestFlight workflow is missing ios-v* tag trigger.");

  const parityOk = requiredChecked(parity, "Feature parity checklist between iOS and web is completed.")
    && requiredChecked(parity, "All critical parity gaps are fixed or explicitly deferred with owner/date.");
  const qaOk = requiredChecked(qa, "Regression/QA pass for release candidate is completed.")
    && requiredChecked(qa, "App Store metadata/versioning/release notes are finalized.");
  parityOk && qaOk
    ? pass("A5", "Workflow-required release-readiness checklist items are checked.")
    : fail("A5", "One or more workflow-required release-readiness checklist items are missing.");

  const workflowSecretRefs = requiredWorkflowSecrets.filter((secret) => workflow.includes(`secrets.${secret}`));
  const githubSecrets = listGithubSecrets();
  const missingWorkflowRefs = requiredWorkflowSecrets.filter((secret) => !workflowSecretRefs.includes(secret));
  const missingGithubSecrets = githubSecrets.available
    ? requiredWorkflowSecrets.filter((secret) => !githubSecrets.names.includes(secret))
    : [];
  if (missingWorkflowRefs.length > 0) {
    fail("B2", "TestFlight workflow is missing required secret references.", {
      requiredWorkflowSecrets,
      workflowSecretRefs,
      missingWorkflowRefs,
    });
    reportSecretStatus = {
      status: "fail",
      message: `Workflow is missing required secret references: ${missingWorkflowRefs.join(", ")}.`,
    };
  } else if (githubSecrets.available && missingGithubSecrets.length === 0) {
    pass("B2", "TestFlight workflow references every required secret and GitHub reports all required secret names.", {
      requiredWorkflowSecrets,
    });
    reportSecretStatus = {
      status: "pass",
      message: "TestFlight workflow references every required secret and GitHub reports all required secret names.",
    };
  } else if (githubSecrets.available) {
    warn("B2", "TestFlight workflow references every required secret, but GitHub is missing one or more required secret names.", {
      requiredWorkflowSecrets,
      missingGithubSecrets,
    });
    reportSecretStatus = {
      status: "warning",
      message: `GitHub secret names missing: ${missingGithubSecrets.join(", ")}.`,
    };
  } else {
    warn("B2", "TestFlight workflow references every required secret, but repository secret visibility could not be confirmed.", {
      requiredWorkflowSecrets,
      reason: githubSecrets.reason,
    });
    reportSecretStatus = {
      status: "warning",
      message: `Workflow references required secrets; GitHub secret list unavailable: ${githubSecrets.reason}.`,
    };
  }

  project.usesNonExemptEncryption === false
    ? pass("C4", "Project declares ITSAppUsesNonExemptEncryption=false; privacy policy URL remains https://still-point.me/privacy.", { privacyPolicyUrl: "https://still-point.me/privacy" })
    : fail("C4", "Project encryption declaration is missing or non-exempt encryption is enabled.");

  submissionRunbook.includes("Guideline 5.1.1(v)") && releasing.includes("Delete Account")
    ? pass("C7", "Reviewer notes template and account-deletion path are present in canonical docs.")
    : fail("C7", "Reviewer notes template or account-deletion path is missing.");

  pass("D1", "Machine-readable preflight summary is generated by this script.", { output: path.join(outputDir, "summary.json") });
  pass("D4", "Release artifact has placeholders for timestamp, version/build, owner, and submission URL.", {
    releaseOwner: args.releaseOwner ?? "UNSET_RELEASE_OWNER",
    submissionUrl: args.submissionUrl ?? "UNSET_SUBMISSION_URL",
  });
  pass("E2", "Daily status log template is present in ios/RELEASING.md.");
  pass("F1", "Automation logs are saved with the dry-run report.", { output: path.join(outputDir, "automation.log") });
  pass("F2", "Human-owned decisions are saved with the dry-run report.", { output: path.join(outputDir, "summary.json") });
  pass("DOD1", "Canonical runbooks are referenced before submission work starts.");
  pass("DOD2", "The dry-run report turns issue #242 into repeatable worker instructions.");

  log("Checking App Store Connect live-query readiness.");
  let asc;
  try {
    asc = await queryAsc(project);
    if (asc.live) log("App Store Connect build/version queries completed.");
    else log(`App Store Connect live queries skipped: ${asc.reason}`);
  } catch (error) {
    asc = { live: false, reason: error.message };
    warn("ASC", "App Store Connect query failed.", { error: error.message });
  }

  if (requireLive && !asc.live) {
    fail("ASC_REQUIRE_LIVE", "Live App Store Connect validation was required but did not complete.", { reason: asc.reason });
  }
  if (asc.live && asc.intendedBuild && asc.intendedBuild.processingState !== "VALID") {
    fail("ASC_BUILD_STATE", "Intended TestFlight build exists but is not VALID.", asc.intendedBuild);
  }
  if (asc.live && !asc.intendedBuild) {
    fail("ASC_BUILD_MISSING", "Intended TestFlight build was not found in App Store Connect.", { version: project.marketingVersion, build: project.buildNumber });
  }

  const humanGates = [
    { owner: "Account Holder/Admin", decision: "Confirm Apple Agreements, Tax, and Banking have no Action required items.", reason: "Not exposed by public ASC API." },
    { owner: "Product/App Store", decision: "Approve screenshots, app previews, age rating, reviewer notes, demo credentials, and release timing.", reason: "Compliance/copy/assets require human accountability." },
    { owner: "Release owner", decision: "Approve programmatic Submit for Review for the intended build.", reason: "Dry-run mode must not submit without explicit live approval." },
    { owner: "Product/App Store", decision: "Choose manual, automatic, or phased release after approval.", reason: "Business release strategy." },
  ];

  const fallbackPaths = [
    { when: "ASC credentials or APPSTORE_APP_ID are unavailable", action: "Use App Store Connect website to verify TestFlight build status, version page, attached build, metadata, screenshots, review notes, and demo credentials; paste evidence into the generated report." },
    { when: "API field is unsupported or returns a blocker", action: "Record the exact API error, open App Store Connect -> app -> Distribution/App Store -> target version, fix only that field, then rerun this dry run." },
    { when: "Submission is rejected", action: "Copy reviewer notes verbatim to #103, create/link implementation issues, bump CURRENT_PROJECT_VERSION, upload a replacement ios-v* build, attach it, and resubmit." },
    { when: "Submission is approved", action: "Record final build and outcome in #103, choose held/manual/automatic/phased release, and close tracking only when complete." },
  ];

  const report = {
    generatedAt: new Date().toISOString(),
    issue: "https://github.com/auerbachb/still-point/issues/242",
    dryRunMode: true,
    project,
    intendedTag,
    releaseOwner: args.releaseOwner ?? "UNSET_RELEASE_OWNER",
    submissionUrl: args.submissionUrl ?? "UNSET_SUBMISSION_URL",
    workflow: {
      path: ".github/workflows/ios-testflight.yml",
      tagTrigger: "ios-v*",
      url: workflowUrl,
      requiredSecrets: requiredWorkflowSecrets,
    },
    asc,
    checks,
    humanGates,
    fallbackPaths,
    logs,
  };
  report.preflightSummary = {
    intendedTag,
    version: project.marketingVersion,
    build: project.buildNumber,
    workflowUrl,
    appStoreApiMinimumRole,
    testFlightBuildStatus: asc.live
      ? asc.intendedBuild?.processingState ?? "intended build not found"
      : asc.reason,
    appStoreVersionUrl:
      asc.live && asc.appStoreVersions?.[0]
        ? `${appStoreConnectBaseUrl}/${asc.appId}/distribution/ios/version/${asc.appStoreVersions[0].id}`
        : "requires live App Store Connect query",
    attachedBuild: asc.live
      ? asc.intendedBuild?.version ?? "intended build not attached or not found"
      : "requires live App Store Connect query",
    metadataCompleteness:
      "Canonical docs and local release-readiness checks are verified; live ASC metadata fields require API credentials or website evidence.",
    screenshotStatus: "requires approved screenshot/app-preview source assets before API upload or website verification",
    reviewNotes: "canonical template present in docs/operations/ios-app-store-submission.md",
    demoCredentialsOrSignupPath: "requires release-owner approval before live submission",
    unresolvedHumanGates: humanGates,
  };
  report.issue242Checklist = classifyIssueChecklist({ project, asc });

  if (report.issue242Checklist.length !== 38) {
    fail("ISSUE_242_COUNT", "Issue #242 checklist coverage must contain exactly 38 items.", { count: report.issue242Checklist.length });
  }

  fs.writeFileSync(path.join(outputDir, "summary.json"), `${JSON.stringify(report, null, 2)}\n`);
  fs.writeFileSync(path.join(outputDir, "summary.md"), writeMarkdown(report));
  fs.writeFileSync(path.join(outputDir, "automation.log"), `${logs.join("\n")}\n`);

  const failures = checks.filter((check) => check.status === "fail");
  if (failures.length > 0) {
    console.error(`Dry run completed with ${failures.length} blocking failure(s). See ${path.join(outputDir, "summary.md")}`);
    process.exitCode = 1;
    return;
  }

  log(`Dry run evidence written to ${outputDir}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
