#!/usr/bin/env bash
set -euo pipefail

RUNS="${1:-3}"

if ! [[ "$RUNS" =~ ^[1-9][0-9]*$ ]]; then
  echo "[build:verify] RUNS must be a positive integer, got: ${RUNS}" >&2
  exit 1
fi

for run in $(seq 1 "$RUNS"); do
  echo "[build:verify] clean build ${run}/${RUNS}"
  rm -rf .next
  npm run build
done

echo "[build:verify] ${RUNS}/${RUNS} builds succeeded"
