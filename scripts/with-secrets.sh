#!/usr/bin/env bash

set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

ENV_NAME="${1:-}"

if [[ -z "$ENV_NAME" ]]; then
  echo "Usage: scripts/with-secrets.sh <environment> <command> [arguments...]" >&2
  exit 2
fi

shift

if [[ "$#" -eq 0 ]]; then
  echo "Usage: scripts/with-secrets.sh <environment> <command> [arguments...]" >&2
  exit 2
fi

if [[ "${SKIP_VAULT:-0}" == "1" ]]; then
  echo "[vault] SKIP_VAULT=1 — using the current environment" >&2
  exec "$@"
fi

if ! command -v infisical >/dev/null 2>&1; then
  echo "Please either run infisical init to connect to a project, or set SKIP_VAULT=1." >&2
  exit 1
fi

exec infisical run --env="$ENV_NAME" -- "$@"