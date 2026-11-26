import { spawnSync } from 'node:child_process';

const IMAGE = process.env.IMAGE ?? 'marketplace-api:local';
const SEVERITY = process.env.SEVERITY ?? 'CRITICAL,HIGH';
const TRIVY_IMAGE = process.env.TRIVY_IMAGE ?? 'aquasec/trivy:0.74.0';
const TRIVY_CACHE_VOLUME = process.env.TRIVY_CACHE_VOLUME ?? 'hw28-trivy-cache';

function parseMaxAllowed(raw) {
  if (raw === undefined || raw.trim() === '') {
    return 0;
  }
  const value = Number(raw);
  if (!Number.isInteger(value)) {
    throw new Error(`SCAN_MAX must be an integer, got: "${raw}"`);
  }
  return value;
}

function runTrivyJson(image, severity) {
  const result = spawnSync(
    'docker',
    [
      'run',
      '--rm',
      '-v',
      '/var/run/docker.sock:/var/run/docker.sock',
      '-v',
      `${TRIVY_CACHE_VOLUME}:/root/.cache/`,
      TRIVY_IMAGE,
      'image',
      '--quiet',
      '--scanners',
      'vuln',
      '--severity',
      severity,
      '--ignore-unfixed',
      '--format',
      'json',
      image,
    ],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
  );

  if (result.error || result.status !== 0) {
    const details = result.error?.message || result.stderr || result.stdout;
    console.error(`Trivy failed (status=${result.status}): ${details}`);
    process.exit(2);
  }

  return JSON.parse(result.stdout);
}

function countVulnerabilities(report) {
  let total = 0;
  for (const target of report.Results ?? []) {
    total += (target.Vulnerabilities ?? []).length;
  }
  return total;
}

function main() {
  const maxAllowed = parseMaxAllowed(process.env.SCAN_MAX);
  const report = runTrivyJson(IMAGE, SEVERITY);
  const found = countVulnerabilities(report);
  const gate = found <= maxAllowed ? 'pass' : 'fail';

  console.log(`image=${IMAGE}`);
  console.log(`severity=${SEVERITY}`);
  console.log(`found=${found}`);
  console.log(`max-allowed=${maxAllowed}`);
  console.log(`gate=${gate}`);

  process.exit(gate === 'pass' ? 0 : 1);
}

main();
