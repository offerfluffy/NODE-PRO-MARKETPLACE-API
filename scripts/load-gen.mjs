import { createWriteStream } from 'node:fs';
import { request } from 'node:http';
import { URL } from 'node:url';

const targetUrl = new URL(process.env.LOAD_URL ?? 'http://127.0.0.1:28080/');
const outFile = process.env.LOAD_OUT_FILE;
const concurrency = Number(process.env.LOAD_CONCURRENCY ?? '16');
const timeoutMs = Number(process.env.LOAD_TIMEOUT_MS ?? '3000');

if (!outFile) {
  console.error('LOAD_OUT_FILE is required');
  process.exit(2);
}

const out = createWriteStream(outFile, { flags: 'w' });
let stopping = false;

function stop() {
  stopping = true;
}

process.on('SIGTERM', stop);
process.on('SIGINT', stop);

function sendOneRequest() {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (code) => {
      if (settled) return;
      settled = true;
      resolve(code);
    };

    const req = request(
      {
        protocol: targetUrl.protocol,
        hostname: targetUrl.hostname,
        port: targetUrl.port || 80,
        path: `${targetUrl.pathname}${targetUrl.search}`,
        method: 'GET',
        // Fresh TCP connection per request so kube-proxy balances across all ready pods.
        agent: false,
        headers: { Connection: 'close' },
        timeout: timeoutMs,
      },
      (res) => {
        const status = String(res.statusCode ?? 0).padStart(3, '0');
        res.resume();
        res.on('end', () => finish(status));
        res.on('error', () => finish('000'));
      },
    );

    req.on('timeout', () => {
      req.destroy();
      finish('000');
    });
    req.on('error', () => finish('000'));
    req.end();
  });
}

async function worker() {
  while (!stopping) {
    const code = await sendOneRequest();
    out.write(`${code}\n`);
  }
}

async function main() {
  const workers = Array.from({ length: concurrency }, () => worker());
  await Promise.all(workers);
  await new Promise((resolve, reject) => {
    out.end((err) => (err ? reject(err) : resolve()));
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
