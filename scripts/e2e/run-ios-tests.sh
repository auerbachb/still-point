#!/usr/bin/env bash
set -euo pipefail

LANE="${1:-smoke}"
MAX_RETRIES="${2:-1}"
ATTEMPT=1
UI_TESTS_DIR="${IOS_UI_TESTS_DIR:-ios/StillPointAppUITests}"
SECRETS_REQUIRED="${E2E_SECRETS_REQUIRED:-true}"
STATUS_FILE="artifacts/e2e/ios/${LANE}.status"
FINAL_STATUS="failed"

mkdir -p "artifacts/e2e/ios"

write_status_file() {
  printf '%s\n' "${FINAL_STATUS}" > "${STATUS_FILE}"
}

trap write_status_file EXIT

if ! [[ "${MAX_RETRIES}" =~ ^[0-9]+$ ]] || [[ "${MAX_RETRIES}" -lt 1 ]]; then
  echo "MAX_RETRIES must be a positive integer (>= 1). Got: '${MAX_RETRIES}'."
  exit 1
fi

if [[ "${E2E_ENV:-}" == "prod" || "${E2E_BASE_URL:-}" =~ still-point\.me ]]; then
  echo "Refusing to run iOS E2E lane against production."
  exit 1
fi

if [[ ! -d "${UI_TESTS_DIR}" ]]; then
  # Hard-fail: a missing test directory was previously silently treated as "skipped"
  # which let broken-on-Release builds (e.g. build 8 / issue #250) ship with green
  # CI. The contract is that the suite must be present and runnable.
  echo "::error::iOS E2E suite not present at expected path '${UI_TESTS_DIR}'."
  echo "::error::Set IOS_UI_TESTS_DIR to override, or restore the test bundle."
  FINAL_STATUS="failed"
  exit 1
fi

if [[ "${SECRETS_REQUIRED}" == "true" ]] && [[ -z "${E2E_TEST_USER_EMAIL:-}" || -z "${E2E_TEST_USER_PASSWORD:-}" ]]; then
  echo "Missing E2E_TEST_USER_EMAIL / E2E_TEST_USER_PASSWORD."
  exit 1
fi

if [[ "${E2E_TEST_USER_EMAIL:-}" =~ @still-point\.me$ ]]; then
  echo "Refusing to run with production-looking user credential."
  exit 1
fi

resolve_test_destination() {
  # Honor explicit caller override first.
  if [[ -n "${IOS_TEST_DESTINATION:-}" ]]; then
    echo "${IOS_TEST_DESTINATION}"
    return
  fi

  # Pick the first iPhone simulator that's actually installed on this host.
  # Prevents the "iPhone 16 doesn't exist on macos-26 runners" / "iPhone 17 will
  # eventually disappear too" infra-failure mode CodeAnt flagged. We grep simctl
  # output with a trailing " (" so "iPhone 17" doesn't accidentally match
  # "iPhone 17 Pro".
  local simctl_output
  simctl_output="$(xcrun simctl list devices available 2>/dev/null || true)"
  local preferred=(
    "iPhone 17 Pro"
    "iPhone 17"
    "iPhone 17 Pro Max"
    "iPhone 17e"
    "iPhone 16e"
    "iPhone 16 Pro"
    "iPhone 16"
    "iPhone 15 Pro"
    "iPhone 15"
    "iPhone Air"
  )
  local name
  for name in "${preferred[@]}"; do
    if grep -F "    ${name} (" <<<"${simctl_output}" >/dev/null 2>&1; then
      echo "platform=iOS Simulator,name=${name},OS=latest"
      return
    fi
  done

  # Last-resort fallback: keep the prior hardcoded default so we fail with a
  # clear xcodebuild error instead of an empty destination.
  echo "platform=iOS Simulator,name=iPhone 17,OS=latest"
}

TEST_DESTINATION="$(resolve_test_destination)"
echo "Using iOS test destination: ${TEST_DESTINATION}"
TEST_SCHEME="${IOS_TEST_SCHEME:-StillPoint}"
PROJECT_PATH="${IOS_TEST_PROJECT:-ios/StillPoint.xcodeproj}"
TEST_CONFIGURATION="${IOS_TEST_CONFIGURATION:-}"

resolve_test_target() {
  # The test target and class are both named StillPointAppUITests.
  # Smoke runs the full Begin -> Session -> Complete -> History golden path
  # (the test that would have caught issue #250 if the runner had actually
  # been executing tests). Critical runs the full UI test class.
  case "$1" in
    smoke)
      echo "StillPointAppUITests/StillPointAppUITests/testLaunchLoginCompleteSessionAndHistoryPersistence"
      ;;
    critical)
      echo "StillPointAppUITests/StillPointAppUITests/testHistoryAndSettingsNavigationSmoke"
      echo "StillPointAppUITests/StillPointAppUITests/testLaunchOfflineShowsUserVisibleMessage"
      echo "StillPointAppUITests/StillPointAppUITests/testPasswordResetEntryIsDiscoverable"
      echo "StillPointAppUITests/StillPointAppUITests/testPrimaryControlsVisibleAboveHomeIndicator"
      echo "StillPointAppUITests/StillPointAppUITests/testSessionsFailureShowsVisibleRetryMessage"
      echo "StillPointAppUITests/StillPointAppUITests/testTokenExpiryRoutesToReauthMessage"
      echo "StillPointAppUITests/StillPointAppUITests/testVoiceOverLabelsForTimerAndPrimaryButton"
      ;;
    *)
      echo "StillPointAppUITests/${1}"
      ;;
  esac
}

run_lane() {
  local lane_tag="$1"
  local test_target
  local result_bundle
  local attempt_marker
  test_target="$(resolve_test_target "${lane_tag}")"
  result_bundle="artifacts/e2e/ios/${lane_tag}-attempt-${ATTEMPT}.xcresult"
  # Start-of-attempt sentinel for is_retriable_failure(): its mtime is fixed
  # at attempt start, unlike the .log file (which `tee` keeps updating until
  # xcodebuild exits). See is_retriable_failure() below for the rationale.
  attempt_marker="artifacts/e2e/ios/${lane_tag}-attempt-${ATTEMPT}.start"
  : > "${attempt_marker}"

  local -a xcodebuild_args=(
    test
    -project "${PROJECT_PATH}"
    -scheme "${TEST_SCHEME}"
    -destination "${TEST_DESTINATION}"
    -resultBundlePath "${result_bundle}"
  )
  while IFS= read -r only_testing_target; do
    [[ -n "${only_testing_target}" ]] && xcodebuild_args+=(-only-testing:"${only_testing_target}")
  done <<< "${test_target}"
  if [[ "${lane_tag}" == "critical" ]]; then
    # The golden session path is covered by the smoke lane. Keep critical focused
    # on the remaining UI tests so the same long simulator flow is not duplicated.
    xcodebuild_args+=(
      -skip-testing:"StillPointAppUITests/StillPointAppUITests/testLaunchLoginCompleteSessionAndHistoryPersistence"
      -skip-testing:"StillPointAppUITests/StillPointAppUITests/testRotationDecisionSessionRemainsUsableInLandscape"
    )
  fi
  if [[ -n "${TEST_CONFIGURATION}" ]]; then
    xcodebuild_args+=(-configuration "${TEST_CONFIGURATION}")
  fi

  set +e
  xcodebuild "${xcodebuild_args[@]}" \
    | tee "artifacts/e2e/ios/${lane_tag}-attempt-${ATTEMPT}.log"
  local status=$?
  set -e
  return $status
}

# Returns 0 if the previous attempt's failure looks retriable (infra/transient
# or unknown — default), 1 if it carries a known XCTest assertion signature
# (real product/test bug — do not consume retry budget). Aligns with the
# "Non-retriable failures" column in docs/testing/e2e-policy.md Section 1.
is_retriable_failure() {
  local log="$1"
  # Optional 2nd arg: a sentinel file whose mtime marks attempt-start. Defaults
  # to `<log>.start` (`run_lane()` creates `<lane>-attempt-N.start` before
  # invoking xcodebuild, so deriving from `<lane>-attempt-N.log` recovers it).
  local attempt_marker="${2:-${log%.log}.start}"
  [[ -f "$log" ]] || return 0
  # If a simulator-side crash report for our app was written during this
  # attempt, treat as infra regardless of the test log's surface symptom.
  # macos-26 runners showed XPC faults (EXC_GUARD/XPC_EXIT_REASON_FAULT)
  # that surface as "did not appear" XCTAssertTrue timeouts but are actually
  # launchd/sim-level crashes. We compare against the attempt-start marker
  # rather than the log file because `tee` updates the log's mtime
  # continuously throughout the run; a crash from mid-run could end up
  # older than the log's final mtime and be missed.
  local diag_dir="${HOME}/Library/Logs/DiagnosticReports"
  if [[ -f "${attempt_marker}" ]] \
     && [[ -d "${diag_dir}" ]] \
     && find "${diag_dir}" -type f -name '*StillPoint*' -newer "${attempt_marker}" -print -quit 2>/dev/null | grep -q .; then
    return 0
  fi
  # Timeout-shaped XCTAssertTrue failures: messages like "X did not appear",
  # "X should be visible", "X did not exist" come from waitForExistence(timeout:)
  # checks. On macos-26, these are commonly UI timing flakes (sim animations,
  # mocked-API delays, focus-handoff timing) rather than real product bugs —
  # even when no .ips crash report is correlated with the attempt. Treat as
  # retriable; if the failure repeats on the second attempt, the lane still
  # surfaces red. Empirically observed flake messages this week:
  #   "Home did not appear after login" (PR #311)
  #   "Session screen did not appear after Begin tap" (PR #319 v1)
  #   "Password reset request confirmation should be visible" (PR #328 round 3)
  if grep -qiE 'XCTAssertTrue failed - .*(did not appear|never appear(ed)?|did not exist|does not exist|should be visible|should appear|should exist|not found|never became|did not become|did not show)' "$log"; then
    return 0
  fi
  # XCTAssert* failures (other than timeout-shaped XCTAssertTrue handled above):
  # e.g., "XCTAssertEqual failed - (<a>) is not equal to (<b>)".
  if grep -qE 'XCTAssert[A-Za-z]* failed' "$log"; then
    return 1
  fi
  # XCTest method-level error frames referencing a test selector starting
  # with "test...". Accept both Swift-style "Module.Class" and ObjC-style
  # plain "Class" forms. Examples:
  #   error: -[StillPointAppUITests.StillPointAppUITests testFoo] : ...
  #   error: -[StillPointAppUITests testFoo] : ...
  if grep -qE 'error: -\[((([A-Za-z_][A-Za-z0-9_]*\.)?[A-Za-z_][A-Za-z0-9_]*)[[:space:]]+test[A-Za-z0-9_]+)\][[:space:]]*:' "$log"; then
    return 1
  fi
  # Default: retriable (covers simulator XPC faults, sim boot timeouts,
  # xcodebuild infra errors, signal-killed processes with no test output).
  return 0
}

while [[ "$ATTEMPT" -le "$MAX_RETRIES" ]]; do
  echo "Running iOS ${LANE} lane attempt ${ATTEMPT}/${MAX_RETRIES}"
  if run_lane "${LANE}"; then
    echo "iOS ${LANE} lane passed."
    FINAL_STATUS="passed"
    exit 0
  fi

  attempt_log="artifacts/e2e/ios/${LANE}-attempt-${ATTEMPT}.log"
  attempt_marker="artifacts/e2e/ios/${LANE}-attempt-${ATTEMPT}.start"
  if ! is_retriable_failure "${attempt_log}" "${attempt_marker}"; then
    echo "iOS ${LANE} lane failed with non-retriable signature (XCTest assertion); skipping retry."
    FINAL_STATUS="failed"
    exit 1
  fi

  if [[ "$ATTEMPT" -ge "$MAX_RETRIES" ]]; then
    echo "iOS ${LANE} lane failed after ${MAX_RETRIES} attempt(s)."
    FINAL_STATUS="failed"
    exit 1
  fi

  echo "iOS ${LANE} lane failed with retriable/unknown signature; retrying..."
  ATTEMPT=$((ATTEMPT + 1))
done
