#!/usr/bin/env bash
set -euo pipefail

# CLI 0.5.3: SHA-256 verified against the official distribution, 2026-11-01 UTC.
# If the latest channel changes, fail closed until the replacement is reviewed.
readonly expected_sha256='089a301ea5cc93a7560c7f1106911547fdfd46fc5c0cef7079e2a62a22e971ce'
readonly binary="${RUNNER_TEMP:?}/blacksmith-budget-cli"
printf 'runner=ubuntu-latest\n' >> "${GITHUB_OUTPUT:?}"
if [[ -z "${BLACKSMITH_ORG_TOKEN:-}" ]]; then
  printf 'reason=authentication-unavailable\n' >> "$GITHUB_OUTPUT"
  exit 0
fi
curl --fail --silent --show-error --location --connect-timeout 10 --max-time 30 \
  https://clireleases.blacksmith.sh/cli/latest/linux/amd64/blacksmith --output "$binary"
printf '%s  %s\n' "$expected_sha256" "$binary" | sha256sum --check --status
chmod 700 "$binary"
export BLACKSMITH_BINARY="$binary" BLACKSMITH_DISABLE_AUTO_UPDATE=1
node scripts/blacksmith-usage.mjs
