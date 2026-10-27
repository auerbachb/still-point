#!/usr/bin/env node
/**
 * Pre-claim secret check for the App Store release lane (issue #937).
 *
 * ios-app-store-release.yml runs this in its release-secrets job, which
 * build-number needs. If a secret that fastlane-release needs is missing, the
 * run fails here, before build-number pushes its ios-v<marketing>-build<N>
 * tag. Left to fastlane-release, it would fail after the claim and leave the
 * tag behind.
 *
 * The workflow binds each secret to an environment variable of the same name.
 * GitHub expands a secret that doesn't exist to an empty string, so unset,
 * empty and whitespace-only all count as missing. The check prints the names
 * of missing variables, never a value.
 *
 * Keep REQUIRED_SECRETS in step with the secrets fastlane-release reads, minus
 * GID_SERVER_CLIENT_ID, which the Fastfile treats as optional.
 * scripts/ci/ios-app-store-release-secrets.test.ts compares the two.
 *
 * Usage (from the repo root): node scripts/ci/ios-app-store-release-secrets.mjs
 */

import process from "node:process";

/** Every secret fastlane-release can't run without, in the order the workflow binds them. */
const REQUIRED_SECRETS = [
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

// No import guard: the check runs whenever this file does, so it can't exit 0 without checking.
const missing = REQUIRED_SECRETS.filter((name) => !process.env[name]?.trim());

if (missing.length > 0) {
  for (const name of missing) {
    console.log(`::error::${name} is missing or empty.`);
  }
  console.log(
    `${missing.length} of the ${REQUIRED_SECRETS.length} secrets the App Store release needs ` +
      "are missing or empty, so build-number won't claim a build number. Add them under " +
      "Settings > Secrets and variables > Actions, then re-run the failed jobs.",
  );
  process.exitCode = 1;
} else {
  console.log(`All ${REQUIRED_SECRETS.length} secrets the App Store release needs are set.`);
}
