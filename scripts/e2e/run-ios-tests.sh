#!/usr/bin/env bash
set -euo pipefail

LANE="${1:-smoke}"
MAX_RETRIES="${2:-1}"
ATTEMPT=1
UI_TESTS_DIR="${IOS_UI_TESTS_DIR:-ios/StillPointUITests}"
SECRETS_REQUIRED="${E2E_SECRETS_REQUIRED:-true}"

if ! [[ "${MAX_RETRIES}" =~ ^[0-9]+$ ]] || [[ "${MAX_RETRIES}" -lt 1 ]]; then
  echo "MAX_RETRIES must be a positive integer (>= 1). Got: '${MAX_RETRIES}'."
  exit 1
fi

if [[ "${E2E_ENV:-}" == "prod" || "${E2E_BASE_URL:-}" =~ still-point\.me ]]; then
  echo "Refusing to run iOS E2E lane against production."
  exit 1
fi

mkdir -p "artifacts/e2e/ios"

if [[ ! -d "${UI_TESTS_DIR}" ]]; then
  echo "iOS E2E suite not present (${UI_TESTS_DIR}); skipping ${LANE} lane."
  echo "skipped" > "artifacts/e2e/ios/${LANE}.status"
  exit 0
fi

if [[ "${SECRETS_REQUIRED}" == "true" ]] && [[ -z "${E2E_TEST_USER_EMAIL:-}" || -z "${E2E_TEST_USER_PASSWORD:-}" ]]; then
  echo "Missing E2E_TEST_USER_EMAIL / E2E_TEST_USER_PASSWORD."
  exit 1
fi

if [[ "${E2E_TEST_USER_EMAIL:-}" =~ @still-point\.me$ ]]; then
  echo "Refusing to run with production-looking user credential."
  exit 1
fi

TEST_PLAN="${IOS_TEST_PLAN:-StillPointE2E}"
TEST_DESTINATION="${IOS_TEST_DESTINATION:-platform=iOS Simulator,name=iPhone 16,OS=latest}"
TEST_SCHEME="${IOS_TEST_SCHEME:-StillPoint}"
PROJECT_PATH="${IOS_TEST_PROJECT:-ios/StillPoint.xcodeproj}"

resolve_test_target() {
  case "$1" in
    smoke)
      echo "StillPointUITests/SmokeTests"
      ;;
    critical)
      echo "StillPointUITests/CriticalPathTests"
      ;;
    *)
      echo "StillPointUITests/${1}"
      ;;
  esac
}

run_lane() {
  local lane_tag="$1"
  local test_target
  local result_bundle
  test_target="$(resolve_test_target "${lane_tag}")"
  result_bundle="artifacts/e2e/ios/${lane_tag}-attempt-${ATTEMPT}.xcresult"

  set +e
  xcodebuild test \
    -project "${PROJECT_PATH}" \
    -scheme "${TEST_SCHEME}" \
    -testPlan "${TEST_PLAN}" \
    -destination "${TEST_DESTINATION}" \
    -resultBundlePath "${result_bundle}" \
    -only-testing:"${test_target}" \
    | tee "artifacts/e2e/ios/${lane_tag}-attempt-${ATTEMPT}.log"
  local status=$?
  set -e
  return $status
}

while [[ "$ATTEMPT" -le "$MAX_RETRIES" ]]; do
  echo "Running iOS ${LANE} lane attempt ${ATTEMPT}/${MAX_RETRIES}"
  if run_lane "${LANE}"; then
    echo "iOS ${LANE} lane passed."
    exit 0
  fi

  if [[ "$ATTEMPT" -ge "$MAX_RETRIES" ]]; then
    echo "iOS ${LANE} lane failed after ${MAX_RETRIES} attempt(s)."
    exit 1
  fi

  ATTEMPT=$((ATTEMPT + 1))
done
