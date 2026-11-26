#!/usr/bin/env bash

set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

CLUSTER_NAME="${KIND_CLUSTER_NAME:-marketplace}"
IMAGE="${IMAGE:-marketplace-api:local}"

if ! kind get clusters | grep -qx "$CLUSTER_NAME"; then
  kind create cluster --name "$CLUSTER_NAME" --config k8s/kind-config.yaml
else
  echo "[cluster:up] kind cluster '$CLUSTER_NAME' already exists"
fi

kubectl config use-context "kind-${CLUSTER_NAME}" >/dev/null
kubectl wait --for=condition=Ready node --all --timeout=120s

echo "[cluster:up] loading image '$IMAGE' into kind cluster '$CLUSTER_NAME'"
kind load docker-image "$IMAGE" --name "$CLUSTER_NAME"

kubectl get nodes -o wide
