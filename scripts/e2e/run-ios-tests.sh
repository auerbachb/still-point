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

TEST_DESTINATION="${IOS_TEST_DESTINATION:-platform=iOS Simulator,name=iPhone 16,OS=latest}"
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
      echo "StillPointAppUITests/StillPointAppUITests"
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
  test_target="$(resolve_test_target "${lane_tag}")"
  result_bundle="artifacts/e2e/ios/${lane_tag}-attempt-${ATTEMPT}.xcresult"

  local -a xcodebuild_args=(
    test
    -project "${PROJECT_PATH}"
    -scheme "${TEST_SCHEME}"
    -destination "${TEST_DESTINATION}"
    -resultBundlePath "${result_bundle}"
    -only-testing:"${test_target}"
  )
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

while [[ "$ATTEMPT" -le "$MAX_RETRIES" ]]; do
  echo "Running iOS ${LANE} lane attempt ${ATTEMPT}/${MAX_RETRIES}"
  if run_lane "${LANE}"; then
    echo "iOS ${LANE} lane passed."
    FINAL_STATUS="passed"
    exit 0
  fi

  if [[ "$ATTEMPT" -ge "$MAX_RETRIES" ]]; then
    echo "iOS ${LANE} lane failed after ${MAX_RETRIES} attempt(s)."
    FINAL_STATUS="failed"
    exit 1
  fi

  ATTEMPT=$((ATTEMPT + 1))
done
