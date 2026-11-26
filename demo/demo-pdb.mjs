import { execFileSync, spawnSync } from 'node:child_process';

const NAMESPACE = process.env.K8S_NAMESPACE ?? 'marketplace';
const DEPLOYMENT = process.env.K8S_DEPLOYMENT ?? 'marketplace-api';
const PDB_NAME = process.env.K8S_PDB ?? 'marketplace-api-pdb';

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function getPdb() {
  const raw = execFileSync(
    'kubectl',
    ['-n', NAMESPACE, 'get', 'pdb', PDB_NAME, '-o', 'json'],
    { encoding: 'utf8' },
  );
  return JSON.parse(raw);
}

function listReadyPods() {
  const raw = execFileSync(
    'kubectl',
    ['-n', NAMESPACE, 'get', 'pods', '-l', `app=${DEPLOYMENT}`, '-o', 'json'],
    { encoding: 'utf8' },
  );
  const items = JSON.parse(raw).items ?? [];
  return items
    .filter((pod) => {
      if (pod.metadata?.deletionTimestamp) return false;
      const ready = (pod.status?.conditions ?? []).find((c) => c.type === 'Ready');
      return ready?.status === 'True';
    })
    .map((pod) => pod.metadata.name);
}

async function waitForHealthyBudget(timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const pdb = getPdb();
    const healthy = pdb.status?.currentHealthy ?? 0;
    const expected = pdb.status?.expectedPods ?? 0;
    const allowed = pdb.status?.disruptionsAllowed ?? 0;
    if (healthy >= expected && expected >= 2 && allowed >= 1) {
      return pdb;
    }
    await sleep(500);
  }
  throw new Error('Timed out waiting for PDB disruptionsAllowed >= 1 and all pods healthy');
}

function evictPod(podName) {
  const payload = JSON.stringify({
    apiVersion: 'policy/v1',
    kind: 'Eviction',
    metadata: {
      name: podName,
      namespace: NAMESPACE,
    },
  });

  // Note: do NOT pass `-o json` with `--raw` (mutually exclusive in kubectl >= 1.33).
  const result = spawnSync(
    'kubectl',
    [
      'create',
      '-v=6',
      '--raw',
      `/api/v1/namespaces/${NAMESPACE}/pods/${podName}/eviction`,
      '-f',
      '-',
    ],
    { input: payload, encoding: 'utf8' },
  );

  const statusMatch = (result.stderr || '').match(/Response Status:\s+(\d{3})\b/);
  if (statusMatch) {
    return Number(statusMatch[1]);
  }

  if (result.status === 0 && result.stdout) {
    const parsed = JSON.parse(result.stdout);
    if (typeof parsed.code === 'number') {
      return parsed.code;
    }
    return 201;
  }

  if (/TooManyRequests/i.test(result.stderr || '')) {
    return 429;
  }

  throw new Error(
    `Unexpected eviction response for ${podName} (exit=${result.status}): ${result.stderr || result.stdout}`,
  );
}

async function main() {
  const pdb = await waitForHealthyBudget();
  const healthy = pdb.status?.currentHealthy ?? 0;
  const minAvailable = pdb.spec?.minAvailable ?? 0;

  const pods = listReadyPods();
  if (pods.length < 2) {
    throw new Error(`Expected at least 2 ready pods for PDB eviction demo, found ${pods.length}`);
  }

  const evict1 = evictPod(pods[0]);
  const evict2 = evictPod(pods[1]);

  // Restore healthy 3/3 state so repeat runs and subsequent demos start clean.
  await waitForHealthyBudget();

  console.log(`healthy=${healthy}`);
  console.log(`minAvailable=${minAvailable}`);
  console.log(`evict-1=${evict1}`);
  console.log(`evict-2=${evict2}`);

  if (evict1 !== 201 || evict2 !== 429) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
