#!/usr/bin/env bash
set -euo pipefail

if [ -z "${SARIF_ID:-}" ]; then
  echo "::error::CodeQL did not return a SARIF upload ID."
  exit 1
fi

if ! status="$(gh api "repos/${GITHUB_REPOSITORY:?}/code-scanning/sarifs/$SARIF_ID" --jq '.processing_status')"; then
  echo "::error::Unable to retrieve CodeQL ingestion status."
  exit 1
fi

case "$status" in
  complete)
    echo "CodeQL ingestion confirmed complete."
    ;;
  pending|failed)
    echo "::error::CodeQL ingestion status: $status."
    exit 1
    ;;
  *)
    echo "::error::CodeQL ingestion returned an unknown processing status."
    exit 1
    ;;
esac
