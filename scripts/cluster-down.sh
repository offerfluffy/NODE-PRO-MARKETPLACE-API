#!/usr/bin/env bash

set -euo pipefail

CLUSTER_NAME="${KIND_CLUSTER_NAME:-marketplace}"

if kind get clusters | grep -qx "$CLUSTER_NAME"; then
  kind delete cluster --name "$CLUSTER_NAME"
else
  echo "[cluster:down] kind cluster '$CLUSTER_NAME' does not exist"
fi
