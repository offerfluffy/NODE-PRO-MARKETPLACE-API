#!/usr/bin/env bash

set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

export PULUMI_BACKEND_URL="${PULUMI_BACKEND_URL:-file://$PWD/.pulumi}"
export PULUMI_SKIP_UPDATE_CHECK=true

if [[ -z "${PULUMI_CONFIG_PASSPHRASE:-}" ]]; then
  echo "Missing required vault secret environment variable: PULUMI_CONFIG_PASSPHRASE" >&2
  exit 1
fi

mkdir -p .pulumi
cd infra

if ! pulumi stack select dev >/dev/null 2>&1; then
  echo "[destroy] Pulumi stack 'dev' does not exist"
  exit 0
fi

exec pulumi destroy --yes --non-interactive "$@"
