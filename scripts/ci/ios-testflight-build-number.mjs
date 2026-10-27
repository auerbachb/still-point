#!/usr/bin/env node
/**
 * TestFlight build numbers for the iOS release workflows (issue #707).
 *
 * The `ios-v<marketing>-build<N>` tags on origin are the build-number source of
 * truth. Every TestFlight cut pushes one, and the next cut takes the highest N
 * + 1 across all marketing versions. Nothing commits a bump to `main`: the
 * reusable build (ios-testflight-build.yml) passes N to xcodebuild as
 * CURRENT_PROJECT_VERSION, so the value in ios/project.yml is only the default
 * for local builds.
 *
 * Usage (from the repo root, in a checkout of the commit being built):
 *   node scripts/ci/ios-testflight-build-number.mjs claim <sha>
 *     Auto path (ios-testflight-auto.yml). Takes N = 1 + the highest build tag
 *     on origin and pushes an annotated ios-v<MARKETING_VERSION>-build<N> tag
 *     on <sha>. The tag push is the lock: if another cut already took N, the
 *     push is rejected, and the claim re-reads the tags and tries again.
 *   node scripts/ci/ios-testflight-build-number.mjs from-tag <tag>
 *     Manual path (ios-testflight.yml). Checks a pushed tag against the scheme,
 *     ios/project.yml's MARKETING_VERSION and the build tags on origin, and
 *     returns its N.
 *
 * Both commands write `tag` and `build_number` to $GITHUB_OUTPUT when it is set,
 * and print them otherwise.
 */

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PROJECT_YML = "ios/project.yml";

/** `ios-v<marketing>-build<N>`: N is a positive integer with no leading zero. */
const BUILD_TAG_RE = /^ios-v(\d+(?:\.\d+){0,2})-build([1-9]\d*)$/;

/**
 * @param {string} name tag name, without `refs/tags/`
 * @returns {{ marketing: string, buildNumber: number } | null} null for any tag
 *   outside the scheme, including one whose N is too large to hold exactly
 */
export function parseBuildTag(name) {
  const match = BUILD_TAG_RE.exec(name);
  if (!match) return null;
  // Past Number.MAX_SAFE_INTEGER, Number() rounds, and N would no longer match the tag.
  const buildNumber = Number(match[2]);
  if (!Number.isSafeInteger(buildNumber)) return null;
  return { marketing: match[1], buildNumber };
}

/**
 * @param {string} marketing
 * @param {number} buildNumber
 */
export function buildTagName(marketing, buildNumber) {
  return `ios-v${marketing}-build${buildNumber}`;
}

/**
 * Parses `git ls-remote --tags` output into tag name → object id. Peeled
 * `^{}` lines (absent with `--refs`) are skipped.
 *
 * @param {string} output
 * @returns {Map<string, string>}
 */
export function parseLsRemoteTags(output) {
  const tags = new Map();
  for (const line of output.split("\n")) {
    const [objectId, ref] = line.trim().split(/\s+/);
    if (!objectId || !ref?.startsWith("refs/tags/") || ref.endsWith("^{}")) continue;
    tags.set(ref.slice("refs/tags/".length), objectId);
  }
  return tags;
}

/**
 * 1 + the highest N among `ios-v*-build<N>` tags. The counter is global, not
 * per marketing version, so a new marketing version continues the sequence.
 *
 * @param {Iterable<string>} tagNames
 */
export function nextBuildNumber(tagNames) {
  let highest = 0;
  for (const name of tagNames) {
    const parsed = parseBuildTag(name);
    if (parsed && parsed.buildNumber > highest) highest = parsed.buildNumber;
  }
  if (highest === 0) {
    throw new Error(
      "No ios-v<marketing>-build<N> tags on origin, so there is no build number to continue from. " +
        "Push a tag for the last uploaded build (for example ios-v1.0.3-build31) and re-run.",
    );
  }
  if (!Number.isSafeInteger(highest + 1)) {
    throw new Error(`Build number ${highest} is the largest this script can count from.`);
  }
  return highest + 1;
}

/**
 * The MARKETING_VERSION shared by every target in ios/project.yml.
 *
 * @param {string} projectYml file contents
 */
export function readMarketingVersion(projectYml) {
  const versions = [...projectYml.matchAll(/^[ \t]+MARKETING_VERSION:[ \t]*"?([^"#\s]+)"?/gm)].map(
    (match) => match[1],
  );
  const unique = [...new Set(versions)];
  if (unique.length === 0) {
    throw new Error(`No MARKETING_VERSION found in ${PROJECT_YML}.`);
  }
  if (unique.length > 1) {
    throw new Error(`Targets in ${PROJECT_YML} disagree on MARKETING_VERSION: ${unique.join(", ")}.`);
  }
  return unique[0];
}

/**
 * N from a manually pushed tag. The tag must follow the scheme, name the
 * marketing version the tagged commit builds, and carry an N above every other
 * build tag on origin. The counter spans marketing versions and only moves up,
 * so a number that a tag for another version holds is refused, and so is an
 * unused lower one. Skipping ahead is allowed, for example past a number that
 * an upload made outside these tags used.
 *
 * @param {string} tag
 * @param {string} marketing MARKETING_VERSION at the tagged commit
 * @param {Iterable<string>} remoteTagNames tags on origin; `tag` itself may be among them
 */
export function buildNumberFromTag(tag, marketing, remoteTagNames) {
  const parsed = parseBuildTag(tag);
  if (!parsed) {
    throw new Error(
      `Tag ${tag} does not follow ios-v<marketing>-build<N> (N a positive integer with no leading zero, at most ${Number.MAX_SAFE_INTEGER}).`,
    );
  }
  if (parsed.marketing !== marketing) {
    throw new Error(
      `Tag ${tag} names marketing version ${parsed.marketing}, but ${PROJECT_YML} at this commit has MARKETING_VERSION ${marketing}.`,
    );
  }
  const names = [...remoteTagNames];
  /** @type {{ name: string, buildNumber: number } | null} */
  let highest = null;
  for (const name of names) {
    const other = name === tag ? null : parseBuildTag(name);
    if (other && (!highest || other.buildNumber > highest.buildNumber)) {
      highest = { name, buildNumber: other.buildNumber };
    }
  }
  if (highest && highest.buildNumber >= parsed.buildNumber) {
    throw new Error(
      `Tag ${tag} needs a build number above ${highest.name}, the highest build tag on origin. ` +
        `Delete ${tag} and push ${buildTagName(marketing, nextBuildNumber(names))} instead.`,
    );
  }
  return parsed.buildNumber;
}

/**
 * @typedef {{ status: number | null, stdout: string, stderr: string }} GitResult
 * @typedef {(args: string[], options?: { allowFailure?: boolean }) => GitResult} Git
 */

/**
 * @param {string} [cwd]
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {Git}
 */
export function gitRunner(cwd, env = process.env) {
  return (args, { allowFailure = false } = {}) => {
    const result = spawnSync("git", args, { cwd, env, encoding: "utf8" });
    if (result.error) throw result.error;
    if (result.status !== 0 && !allowFailure) {
      throw new Error(`git ${args.join(" ")} failed (exit ${result.status}): ${result.stderr.trim()}`);
    }
    return { status: result.status, stdout: result.stdout, stderr: result.stderr };
  };
}

/** @param {number} ms */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Tags on `remote`. Listing is read-only, so a failed `ls-remote` (a network
 * blip, a GitHub 5xx) is retried with back-off instead of failing the cut.
 *
 * @param {Git} git
 * @param {string} remote
 * @param {{ attempts?: number, retryDelayMs?: number, log?: (message: string) => void }} [retry]
 */
async function listRemoteTags(git, remote, { attempts = 3, retryDelayMs = 2000, log = console.log } = {}) {
  const args = ["ls-remote", "--tags", "--refs", remote];
  for (let attempt = 1; attempt < attempts; attempt += 1) {
    const result = git(args, { allowFailure: true });
    if (result.status === 0) return parseLsRemoteTags(result.stdout);
    log(`Listing tags on ${remote} failed (exit ${result.status}), retrying: ${result.stderr.trim()}`);
    await sleep(retryDelayMs * attempt);
  }
  // The last try throws the git error.
  return parseLsRemoteTags(git(args).stdout);
}

/**
 * Claims the next build number by pushing its tag on `sha`. The push is
 * atomic on the remote, so two cuts can never get the same N.
 *
 * @param {object} options
 * @param {string} options.sha commit to tag
 * @param {string} options.marketing MARKETING_VERSION at `sha`
 * @param {Git} [options.git]
 * @param {string} [options.remote]
 * @param {number} [options.maxAttempts] tries for the claim, and for each tag listing within it
 * @param {number} [options.retryDelayMs] back-off after a failed tag listing, or after a push that
 *   failed without another cut's tag appearing
 * @param {(message: string) => void} [options.log]
 * @returns {Promise<{ tag: string, buildNumber: number, attempts: number }>}
 */
export async function claimBuildTag({
  sha,
  marketing,
  git = gitRunner(),
  remote = "origin",
  maxAttempts = 3,
  retryDelayMs = 2000,
  log = console.log,
}) {
  const retry = { attempts: maxAttempts, retryDelayMs, log };
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const buildNumber = nextBuildNumber((await listRemoteTags(git, remote, retry)).keys());
    const tag = buildTagName(marketing, buildNumber);

    // A local tag left by an earlier attempt would make `git tag` refuse.
    git(["tag", "-d", tag], { allowFailure: true });
    git(["tag", "-a", tag, "-m", `TestFlight build ${buildNumber} (auto cut)`, sha]);
    const localObject = git(["rev-parse", `refs/tags/${tag}`]).stdout.trim();

    const push = git(["push", remote, `refs/tags/${tag}`], { allowFailure: true });
    if (push.status === 0) return { tag, buildNumber, attempts: attempt };

    // The push failed: either another cut took N first, or the push itself
    // broke. A tag object identical to ours on the remote means it landed.
    const remoteObject = (await listRemoteTags(git, remote, retry)).get(tag);
    if (remoteObject === localObject) return { tag, buildNumber, attempts: attempt };

    git(["tag", "-d", tag], { allowFailure: true });
    if (remoteObject) {
      log(`${tag} was taken by another cut; trying the next build number.`);
    } else {
      log(`Pushing ${tag} failed: ${push.stderr.trim()}`);
      if (attempt < maxAttempts) await sleep(retryDelayMs * attempt);
    }
  }
  throw new Error(`Could not claim a TestFlight build number after ${maxAttempts} attempts.`);
}

/** @param {Record<string, string | number>} values */
function setOutputs(values) {
  const lines = Object.entries(values).map(([key, value]) => `${key}=${value}\n`);
  if (process.env.GITHUB_OUTPUT) {
    fs.appendFileSync(process.env.GITHUB_OUTPUT, lines.join(""));
  } else {
    process.stdout.write(lines.join(""));
  }
}

/** @param {string} markdown */
function appendSummary(markdown) {
  if (process.env.GITHUB_STEP_SUMMARY) {
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${markdown}\n`);
  }
}

/** @param {string[]} argv */
async function main(argv) {
  const [command, arg] = argv;
  if (!["claim", "from-tag"].includes(command ?? "") || !arg) {
    console.error("usage: ios-testflight-build-number.mjs claim <sha> | from-tag <tag>");
    process.exit(2);
  }
  const marketing = readMarketingVersion(fs.readFileSync(PROJECT_YML, "utf8"));

  if (command === "claim") {
    const { tag, buildNumber, attempts } = await claimBuildTag({ sha: arg, marketing });
    console.log(`Claimed build ${buildNumber}: pushed ${tag} on ${arg} (attempt ${attempts}).`);
    setOutputs({ tag, build_number: buildNumber });
    appendSummary(`TestFlight build **${buildNumber}**: pushed \`${tag}\` on \`${arg}\`.`);
    return;
  }

  const remoteTags = await listRemoteTags(gitRunner(), "origin");
  const buildNumber = buildNumberFromTag(arg, marketing, remoteTags.keys());
  console.log(`Tag ${arg} builds ${marketing} (${buildNumber}).`);
  setOutputs({ tag: arg, build_number: buildNumber });
}

const invokedDirectly =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  main(process.argv.slice(2)).catch((error) => {
    console.log(`::error::${error instanceof Error ? error.message : error}`);
    process.exit(1);
  });
}
