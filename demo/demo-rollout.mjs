import { execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { get as httpGet } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const NAMESPACE = process.env.K8S_NAMESPACE ?? 'marketplace';
const DEPLOYMENT = process.env.K8S_DEPLOYMENT ?? 'marketplace-api';
const TARGET_URL = process.env.LOAD_URL ?? 'http://127.0.0.1:28080/';
const MIN_REQUESTS = 5000;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function fetchJson(url) {
  return new Promise((resolvePromise, reject) => {
    const req = httpGet(url, { agent: false, headers: { Connection: 'close' } }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        body += chunk;
      });
      res.on('end', () => {
        if (res.statusCode !== 200) {
          reject(new Error(`GET ${url} returned HTTP ${res.statusCode}`));
          return;
        }
        try {
          resolvePromise(JSON.parse(body));
        } catch (err) {
          reject(err);
        }
      });
    });
    req.on('error', reject);
  });
}

function runCommandAsync(cmd, args, env) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(cmd, args, { env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => {
      stdout += d.toString();
    });
    child.stderr.on('data', (d) => {
      stderr += d.toString();
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolvePromise({ stdout, stderr });
      } else {
        reject(new Error(`${cmd} ${args.join(' ')} exited with ${code}:\n${stderr || stdout}`));
      }
    });
  });
}

function allPodsSettled() {
  const raw = execFileSync(
    'kubectl',
    ['-n', NAMESPACE, 'get', 'pods', '-l', `app=${DEPLOYMENT}`, '-o', 'json'],
    { encoding: 'utf8' },
  );
  const items = JSON.parse(raw).items ?? [];
  if (items.length === 0) return false;
  return items.every((pod) => {
    if (pod.metadata?.deletionTimestamp) return false;
    const readyCond = (pod.status?.conditions ?? []).find((c) => c.type === 'Ready');
    return readyCond?.status === 'True';
  });
}

async function waitUntilPodsSettled(timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (allPodsSettled()) return;
    await sleep(500);
  }
  throw new Error('Timed out waiting for old pods to finish terminating');
}

function stopChild(child) {
  return new Promise((resolvePromise) => {
    if (child.exitCode !== null) {
      resolvePromise();
      return;
    }
    child.once('exit', () => resolvePromise());
    child.kill('SIGTERM');
  });
}

async function main() {
  await fetchJson(TARGET_URL);

  const workDir = mkdtempSync(join(tmpdir(), 'hw28-rollout-'));
  const codesFile = join(workDir, 'codes.txt');
  const newRev = `rollout-${Date.now()}`;

  const loadGen = spawn(process.execPath, [resolve('scripts/load-gen.mjs')], {
    env: {
      ...process.env,
      LOAD_URL: TARGET_URL,
      LOAD_OUT_FILE: codesFile,
      LOAD_CONCURRENCY: process.env.LOAD_CONCURRENCY ?? '16',
    },
    stdio: ['ignore', 'ignore', 'pipe'],
  });

  let loadGenErr = '';
  loadGen.stderr.on('data', (d) => {
    loadGenErr += d.toString();
  });

  try {
    await sleep(1000);

    const t0 = Date.now();
    await runCommandAsync('bash', ['scripts/with-secrets.sh', 'dev', 'bash', 'scripts/pulumi-up.sh'], {
      ...process.env,
      REV: newRev,
    });
    await runCommandAsync(
      'kubectl',
      ['-n', NAMESPACE, 'rollout', 'status', `deploy/${DEPLOYMENT}`, '--timeout=180s'],
      process.env,
    );
    await waitUntilPodsSettled();
    const rolloutSeconds = ((Date.now() - t0) / 1000).toFixed(2);

    await sleep(1000);
    await stopChild(loadGen);

    if (loadGenErr.trim()) {
      console.error(loadGenErr.trim());
    }

    const lines = readFileSync(codesFile, 'utf8')
      .split(/\r?\n/)
      .filter((line) => line.length > 0);

    const requests = lines.length;
    const ok = lines.filter((code) => code === '200').length;
    const failed = requests - ok;

    const afterInfo = await fetchJson(TARGET_URL);
    if (afterInfo.rev !== newRev) {
      throw new Error(`Expected rev=${newRev} after rollout, got rev=${afterInfo.rev}`);
    }

    console.log('profile=hardened');
    console.log(`requests=${requests}`);
    console.log(`ok=${ok}`);
    console.log(`failed=${failed}`);
    console.log(`rollout-seconds=${rolloutSeconds}`);

    if (failed !== 0 || requests < MIN_REQUESTS) {
      process.exit(1);
    }
  } finally {
    await stopChild(loadGen);
    rmSync(workDir, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
