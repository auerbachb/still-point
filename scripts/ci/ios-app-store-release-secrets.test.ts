import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";

const REPO_ROOT = process.cwd();
const CHECK = path.join(REPO_ROOT, "scripts/ci/ios-app-store-release-secrets.mjs");
const WORKFLOW = path.join(REPO_ROOT, ".github/workflows/ios-app-store-release.yml");

/**
 * The secrets fastlane-release can't run without (#937), in the order the check
 * reports them. This copy is kept apart from the script's own list: a name that
 * either list lacks fails a case below.
 */
const REQUIRED = [
  "BUILD_CERTIFICATE_BASE64",
  "P12_PASSWORD",
  "BUILD_PROVISION_PROFILE_BASE64",
  "BUILD_PROVISION_PROFILE_EXTENSION_BASE64",
  "BUILD_PROVISION_PROFILE_WIDGET_BASE64",
  "APPSTORE_API_KEY_ID",
  "APPSTORE_API_ISSUER_ID",
  "APPSTORE_API_PRIVATE_KEY",
  "GID_CLIENT_ID",
  "GID_REVERSED_CLIENT_ID",
];

/** fastlane-release also reads this one, but the Fastfile builds without it. */
const OPTIONAL = ["GID_SERVER_CLIENT_ID"];

/** Every fake value, and every line of one, carries this, so printing any of them shows. */
const FAKE = "not-a-real-secret";

/** A fake value for each required secret; the private key's spans lines, as a real .p8 does. */
function allSet(): Record<string, string> {
  const vars = Object.fromEntries(REQUIRED.map((name) => [name, `${FAKE}-${name.toLowerCase()}`]));
  vars.APPSTORE_API_PRIVATE_KEY = [`${FAKE} key line 1`, `${FAKE} key line 2`, `${FAKE} key line 3`].join("\n");
  return vars;
}

/**
 * Runs the check with exactly `vars` among the release secrets, whatever the
 * developer's own environment holds, and returns the names it reported.
 */
function runCheck(vars: Record<string, string>) {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const name of [...REQUIRED, ...OPTIONAL]) delete env[name];
  const result = spawnSync(process.execPath, [CHECK], { env: { ...env, ...vars }, encoding: "utf8" });
  expect(result.error).toBeUndefined();
  expect(result.signal).toBeNull();
  // Names only, never a value.
  expect(result.stdout).not.toContain(FAKE);
  expect(result.stderr).not.toContain(FAKE);
  const reported = result.stdout
    .split("\n")
    .map((line) => /^::error::([A-Z0-9_]+) is missing or empty\.$/.exec(line)?.[1])
    .filter((name) => name !== undefined);
  return { status: result.status, stdout: result.stdout, stderr: result.stderr, reported };
}

describe("ios-app-store-release-secrets.mjs (#937)", { timeout: 30_000 }, () => {
  test("passes when every required secret is set, without the optional one", () => {
    const run = runCheck(allSet());

    expect(run.status, run.stdout + run.stderr).toBe(0);
    expect(run.reported).toEqual([]);
    expect(run.stdout).toBe(`All ${REQUIRED.length} secrets the App Store release needs are set.\n`);
  });

  describe.each([
    ["unset", null],
    ["empty", ""],
    ["only whitespace", " \t\n "],
  ])("a secret that is %s", (_label, value) => {
    test.each(REQUIRED)("fails the check and is the one reported: %s", (name) => {
      const vars = allSet();
      if (value === null) delete vars[name];
      else vars[name] = value;

      const run = runCheck(vars);

      expect(run.status).toBe(1);
      expect(run.reported).toEqual([name]);
      expect(run.stdout).toContain(`1 of the ${REQUIRED.length} secrets the App Store release needs are missing or empty`);
    });
  });

  test("reports every missing secret, in order", () => {
    const run = runCheck({});

    expect(run.status).toBe(1);
    expect(run.reported).toEqual(REQUIRED);
  });
});

/**
 * The workflow's jobs by id, each as the lines of its block. Reads the YAML as
 * text, the way the workflow is written: two-space indents, one job per key.
 */
function workflowJobs(yaml: string): Map<string, string[]> {
  const lines = yaml.split("\n");
  const start = lines.indexOf("jobs:");
  expect(start).toBeGreaterThan(-1);
  const jobs = new Map<string, string[]>();
  let current: string[] | undefined;
  for (const line of lines.slice(start + 1)) {
    if (/^[^\s#]/.test(line)) break;
    const id = /^ {2}([\w-]+):\s*$/.exec(line);
    if (id) {
      current = [];
      jobs.set(id[1], current);
    } else {
      current?.push(line);
    }
  }
  return jobs;
}

/** A job's steps, each as the lines of its block. */
function jobSteps(job: string[]): string[][] {
  const start = job.findIndex((line) => /^ {4}steps:\s*$/.test(line));
  expect(start).toBeGreaterThan(-1);
  const steps: string[][] = [];
  for (const line of job.slice(start + 1)) {
    if (/^ {0,4}[^\s#]/.test(line)) break;
    if (/^ {6}- /.test(line)) steps.push([line]);
    else steps.at(-1)?.push(line);
  }
  return steps;
}

/**
 * The entries under `key:` at `indent` spaces, for a flat mapping such as
 * `permissions:` or `env:`. Undefined when the key is absent. A value written
 * on the key's own line, such as `permissions: {}`, comes back under "".
 */
function mapping(lines: string[], key: string, indent: number): Map<string, string> | undefined {
  const parse = (line: string) => /^( *)([\w-]+):\s*(.*?)\s*$/.exec(line);
  const start = lines.findIndex((line) => {
    const entry = parse(line);
    return entry !== null && entry[1].length === indent && entry[2] === key;
  });
  if (start === -1) return undefined;
  const inline = parse(lines[start])?.[3] ?? "";
  if (inline !== "" && !inline.startsWith("#")) return new Map([["", inline]]);
  const entries = new Map<string, string>();
  for (const line of lines.slice(start + 1)) {
    if (/^\s*(#.*)?$/.test(line)) continue;
    const entry = parse(line);
    if (!entry || entry[1].length <= indent) break;
    if (entry[1].length === indent + 2) entries.set(entry[2], entry[3]);
  }
  return entries;
}

/** Every secret a block of the workflow reads through a `${{ secrets.NAME }}` expression. */
function secretsRead(lines: string[]): Set<string> {
  return new Set([...lines.join("\n").matchAll(/\$\{\{\s*secrets\.(\w+)\s*\}\}/g)].map((match) => match[1]));
}

describe("ios-app-store-release.yml checks secrets before the claim (#937)", () => {
  const yaml = fs.readFileSync(WORKFLOW, "utf8");
  const jobs = workflowJobs(yaml);
  const job = (id: string) => {
    const lines = jobs.get(id);
    expect(lines, `job ${id}`).toBeDefined();
    return lines ?? [];
  };
  const needs = (id: string) => {
    const value = mapping(job(id), "needs", 4)?.get("") ?? "";
    return value.startsWith("[") ? value.slice(1, -1).split(",").map((need) => need.trim()) : [value];
  };

  test("release-secrets binds exactly the required secrets, by name, to the check step", () => {
    const steps = jobSteps(job("release-secrets"));
    const check = steps.find((step) => step.some((line) => /^ {8}run: node scripts\/ci\/ios-app-store-release-secrets\.mjs$/.test(line)));
    expect(check).toBeDefined();

    expect([...(mapping(check ?? [], "env", 8) ?? [])]).toEqual(REQUIRED.map((name) => [name, `\${{ secrets.${name} }}`]));
    // Bound at step level only, so the job's other steps never see a value.
    expect(mapping(job("release-secrets"), "env", 4)).toBeUndefined();
    expect([...secretsRead(job("release-secrets"))]).toEqual(REQUIRED);
  });

  test("release-secrets always runs and always counts", () => {
    for (const line of job("release-secrets")) {
      expect(line).not.toMatch(/^\s*(?:- )?(?:if|continue-on-error):/);
    }
  });

  test("build-number waits for the check and the smoke gate, and still claims the tag", () => {
    expect(needs("build-number").sort()).toEqual(["pre-flight-tests", "release-secrets"]);
    expect(job("build-number").some((line) => /^ {8}id: claim$/.test(line))).toBe(true);
  });

  test("build-number is the only job that can write, and it gets no secrets", () => {
    expect([...(mapping(yaml.split("\n"), "permissions", 0) ?? [])]).toEqual([["contents", "read"]]);
    expect([...(mapping(job("release-secrets"), "permissions", 4) ?? [])]).toEqual([["contents", "read"]]);
    for (const [id, lines] of jobs) {
      const permissions = mapping(lines, "permissions", 4);
      if (id === "build-number") {
        expect([...(permissions ?? [])]).toEqual([["contents", "write"]]);
      } else {
        expect([...(permissions?.values() ?? [])].every((access) => access === "read" || access === "none"), id).toBe(
          true,
        );
      }
    }
    expect([...secretsRead(job("build-number"))]).toEqual([]);
  });

  test("the smoke gate, which runs npm ci, gets no secrets", () => {
    expect([...secretsRead(job("pre-flight-tests"))]).toEqual([]);
  });

  test("the check covers every secret fastlane-release reads but the optional one", () => {
    expect([...secretsRead(job("fastlane-release"))].sort()).toEqual([...REQUIRED, ...OPTIONAL].sort());
  });
});
