#!/usr/bin/env bash
set -euo pipefail

RUNS="${1:-3}"

for run in $(seq 1 "$RUNS"); do
  echo "[build:verify] clean build ${run}/${RUNS}"
  rm -rf .next
  npm run build
done

echo "[build:verify] ${RUNS}/${RUNS} builds succeeded"
