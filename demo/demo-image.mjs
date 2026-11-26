import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { gunzipSync } from 'node:zlib';

const IMAGE = process.env.IMAGE ?? 'marketplace-api:local';
const DOCKERFILE_PATH = resolve('docker/Dockerfile');
const TOKEN_PATH = resolve('.npm_token');

function readToken(tokenPath) {
  let token;
  try {
    token = readFileSync(tokenPath, 'utf8').trim();
  } catch {
    throw new Error(
      `Missing ${tokenPath}. Create it first (e.g. printf 'dummy-npm-token' > .npm_token).`,
    );
  }
  if (!token) {
    throw new Error(`${tokenPath} is empty; refusing to scan for an empty secret.`);
  }
  return token;
}

function countStages(dockerfilePath) {
  const content = readFileSync(dockerfilePath, 'utf8');
  return content
    .split(/\r?\n/)
    .filter((line) => /^\s*FROM\s+/i.test(line)).length;
}

function checkShellInside(image) {
  const result = spawnSync(
    'docker',
    ['run', '--rm', '--entrypoint', 'sh', image, '-c', 'echo ok'],
    { encoding: 'utf8' },
  );
  return result.status === 0 ? 1 : 0;
}

function readRuntimeUid(image) {
  const raw = execFileSync(
    'docker',
    ['run', '--rm', image, '-e', 'process.stdout.write(String(process.getuid()))'],
    { encoding: 'utf8' },
  ).trim();
  if (!/^\d+$/.test(raw)) {
    throw new Error(`Expected numeric runtime UID, got: "${raw}"`);
  }
  return Number(raw);
}

function countStringOccurrences(haystack, needle) {
  let count = 0;
  let pos = 0;
  while ((pos = haystack.indexOf(needle, pos)) !== -1) {
    count += 1;
    pos += needle.length;
  }
  return count;
}

function countTokenInHistory(image, token) {
  const history = execFileSync(
    'docker',
    ['history', '--no-trunc', '--format', '{{.CreatedBy}}', image],
    { encoding: 'utf8' },
  );
  return countStringOccurrences(history, token);
}

function countTokenInConfig(image, token) {
  const inspectJson = execFileSync('docker', ['image', 'inspect', image], {
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024,
  });
  return countStringOccurrences(inspectJson, token);
}

function countBufferOccurrences(haystack, needle) {
  let count = 0;
  let pos = 0;
  while ((pos = haystack.indexOf(needle, pos)) !== -1) {
    count += 1;
    pos += needle.length;
  }
  return count;
}

function countTokenInLayers(image, token) {
  const workDir = mkdtempSync(join(tmpdir(), 'hw28-image-layers-'));
  const tarPath = join(workDir, 'image.tar');
  const needle = Buffer.from(token, 'utf8');

  try {
    execFileSync('docker', ['save', '-o', tarPath, image]);
    execFileSync('tar', ['-xf', tarPath, '-C', workDir]);

    const manifest = JSON.parse(readFileSync(join(workDir, 'manifest.json'), 'utf8'));
    const layers = manifest?.[0]?.Layers;
    if (!Array.isArray(layers) || layers.length === 0) {
      throw new Error('docker save manifest.json did not contain any Layers');
    }

    let totalMatches = 0;
    for (const relLayerPath of layers) {
      const layerBytes = readFileSync(join(workDir, relLayerPath));
      const isGzip = layerBytes.length >= 2 && layerBytes[0] === 0x1f && layerBytes[1] === 0x8b;
      const rawTar = isGzip ? gunzipSync(layerBytes) : layerBytes;
      totalMatches += countBufferOccurrences(rawTar, needle);
    }

    return totalMatches;
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
}

function main() {
  const token = readToken(TOKEN_PATH);
  const stages = countStages(DOCKERFILE_PATH);
  const shellInside = checkShellInside(IMAGE);
  const runtimeUid = readRuntimeUid(IMAGE);
  const tokenInHistory = countTokenInHistory(IMAGE, token);
  const tokenInConfig = countTokenInConfig(IMAGE, token);
  const tokenInLayers = countTokenInLayers(IMAGE, token);

  console.log(`stages=${stages}`);
  console.log(`shell-inside=${shellInside}`);
  console.log(`runtime-uid=${runtimeUid}`);
  console.log(`token-in-history=${tokenInHistory}`);
  console.log(`token-in-config=${tokenInConfig}`);
  console.log(`token-in-layers=${tokenInLayers}`);

  const ok =
    stages >= 2 &&
    shellInside === 0 &&
    runtimeUid !== 0 &&
    tokenInHistory === 0 &&
    tokenInConfig === 0 &&
    tokenInLayers === 0;

  if (!ok) {
    process.exit(1);
  }
}

main();
