import { spawn, type ChildProcess } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { decodeJwt } from 'jose';
import { Redis } from 'ioredis';
import dataSource from '../src/modules/database/data-source.js';
import { Order } from '../src/modules/database/entities/order.entity.js';
import { RefreshToken } from '../src/modules/database/entities/refreshToken.entity.js';
import { User } from '../src/modules/database/entities/user.entity.js';
import { seedDatabase } from '../src/modules/database/seed/seed-database.js';

const PORT = 21_241;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const DEMO_EMAIL = 'customer.one@example.com';
const DEMO_PASSWORD = 'demo-password';
const DEMO_ORDER_KEY = 'seed-order-001';
const START_TIMEOUT_MS = 30_000;
const STOP_TIMEOUT_MS = 5_000;

type DemoStatuses = {
  login: number;
  noToken: number;
  withToken: number;
  refresh: number;
  logout: number;
  afterLogout: number;
  refreshAfterLogout: number;
};

type DemoContext = {
  userId: string;
  orderId: string;
};

type ScenarioResult = {
  statuses: DemoStatuses;
  denylistKey: string;
};

async function main(): Promise<void> {
  let app: ChildProcess | undefined;
  let demo: DemoContext | undefined;
  let denylistKey: string | undefined;

  try {
    await dataSource.initialize();
    await dataSource.runMigrations();
    await seedDatabase(dataSource);

    demo = await findDemoContext();
    await clearDemoSessions(demo.userId);

    app = startApplication();
    await waitUntilReady(app);

    const result = await runScenario(demo.orderId);
    denylistKey = result.denylistKey;

    printStatuses(result.statuses);
    assertStatuses(result.statuses);
  } finally {
    if (app) await stopApplication(app);

    if (denylistKey) {
      await clearDenylistKey(denylistKey).catch(() => undefined);
    }

    if (dataSource.isInitialized) {
      if (demo) {
        await clearDemoSessions(demo.userId).catch(() => undefined);
      }

      await dataSource.destroy();
    }
  }
}

async function runScenario(orderId: string): Promise<ScenarioResult> {
  const noToken = await getOrder(orderId);
  await noToken.arrayBuffer();

  const login = await fetch(`${BASE_URL}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      email: DEMO_EMAIL,
      password: DEMO_PASSWORD,
    }),
    signal: AbortSignal.timeout(5_000),
  });
  const r1 = readCookie(login);
  const a1 = await readAccessToken(login);

  if (!r1) {
    throw new Error('Login did not return the R1 refresh cookie');
  }

  const withToken = await getOrder(orderId, a1);
  await withToken.arrayBuffer();

  const refreshed = await refresh(r1);
  const r2 = readCookie(refreshed);
  const a2 = await readAccessToken(refreshed);

  if (!r2) {
    throw new Error('Refresh did not return the R2 refresh cookie');
  }

  const logout = await fetch(`${BASE_URL}/auth/logout`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${a2}`,
      cookie: r2,
    },
    signal: AbortSignal.timeout(5_000),
  });
  await logout.arrayBuffer();

  const afterLogout = await getOrder(orderId, a2);
  await afterLogout.arrayBuffer();

  const refreshAfterLogout = await refresh(r2);
  await refreshAfterLogout.arrayBuffer();

  return {
    statuses: {
      login: login.status,
      noToken: noToken.status,
      withToken: withToken.status,
      refresh: refreshed.status,
      logout: logout.status,
      afterLogout: afterLogout.status,
      refreshAfterLogout: refreshAfterLogout.status,
    },
    denylistKey: accessDenylistKey(a2),
  };
}

function getOrder(orderId: string, accessToken?: string): Promise<Response> {
  return fetch(`${BASE_URL}/orders/${orderId}`, {
    headers: accessToken
      ? {
          authorization: `Bearer ${accessToken}`,
        }
      : undefined,
    signal: AbortSignal.timeout(5_000),
  });
}

function refresh(cookie: string): Promise<Response> {
  return fetch(`${BASE_URL}/auth/refresh`, {
    method: 'POST',
    headers: { cookie },
    signal: AbortSignal.timeout(5_000),
  });
}

function readCookie(response: Response): string | undefined {
  return response.headers.get('set-cookie')?.split(';', 1)[0];
}

async function readAccessToken(response: Response): Promise<string> {
  const body: unknown = await response.json();

  if (
    typeof body !== 'object' ||
    body === null ||
    !('accessToken' in body) ||
    typeof body.accessToken !== 'string'
  ) {
    throw new Error('Response did not contain an access token');
  }

  return body.accessToken;
}

function accessDenylistKey(accessToken: string): string {
  const claims = decodeJwt(accessToken);

  if (typeof claims.iss !== 'string' || typeof claims.jti !== 'string') {
    throw new Error('Access token did not contain iss and jti');
  }

  return `auth:deny:${claims.iss}:${claims.jti}`;
}

function printStatuses(statuses: DemoStatuses): void {
  console.log(`login=${statuses.login}`);
  console.log(`no-token=${statuses.noToken}`);
  console.log(`with-token=${statuses.withToken}`);
  console.log(`refresh=${statuses.refresh}`);
  console.log(`logout=${statuses.logout}`);
  console.log(`after-logout=${statuses.afterLogout}`);
  console.log(`refresh-after-logout=${statuses.refreshAfterLogout}`);
}

function assertStatuses(statuses: DemoStatuses): void {
  const expected: DemoStatuses = {
    login: 200,
    noToken: 401,
    withToken: 200,
    refresh: 200,
    logout: 204,
    afterLogout: 401,
    refreshAfterLogout: 401,
  };

  for (const key of Object.keys(expected) as Array<keyof DemoStatuses>) {
    if (statuses[key] !== expected[key]) {
      throw new Error(
        `${key}: expected ${expected[key]}, received ${statuses[key]}`,
      );
    }
  }
}

async function findDemoContext(): Promise<DemoContext> {
  const [user, order] = await Promise.all([
    dataSource.getRepository(User).findOneBy({
      email: DEMO_EMAIL,
    }),
    dataSource.getRepository(Order).findOneBy({
      idempotencyKey: DEMO_ORDER_KEY,
    }),
  ]);

  if (!user) {
    throw new Error(`Seed user was not found: ${DEMO_EMAIL}`);
  }

  if (!order) {
    throw new Error(`Seed order was not found: ${DEMO_ORDER_KEY}`);
  }

  return {
    userId: user.id,
    orderId: order.id,
  };
}

function clearDemoSessions(userId: string): Promise<unknown> {
  return dataSource
    .getRepository(RefreshToken)
    .createQueryBuilder()
    .delete()
    .from(RefreshToken)
    .where('user_id = :userId', { userId })
    .execute();
}

async function clearDenylistKey(key: string): Promise<void> {
  const redisUrl = process.env.REDIS_QUEUE_URL;

  if (!redisUrl) {
    throw new Error('Missing required environment variable: REDIS_QUEUE_URL');
  }

  const redis = new Redis(redisUrl);

  try {
    await redis.del(key);
  } finally {
    await redis.quit();
  }
}

function startApplication(): ChildProcess {
  const child = spawn(process.execPath, ['dist/main.js'], {
    env: {
      ...process.env,
      PORT: String(PORT),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  child.stdout?.on('data', (chunk: Buffer) => process.stderr.write(chunk));
  child.stderr?.on('data', (chunk: Buffer) => process.stderr.write(chunk));

  return child;
}

async function waitUntilReady(app: ChildProcess): Promise<void> {
  const deadline = Date.now() + START_TIMEOUT_MS;

  while (Date.now() < deadline) {
    if (app.exitCode !== null) {
      throw new Error(`Application exited during startup: ${app.exitCode}`);
    }

    try {
      const response = await fetch(`${BASE_URL}/health`, {
        signal: AbortSignal.timeout(500),
      });

      if (response.ok) {
        await response.arrayBuffer();
        return;
      }
    } catch {
      // Connection failures are expected while Nest is starting.
    }

    await delay(100);
  }

  throw new Error(`Application did not start within ${START_TIMEOUT_MS}ms`);
}

async function stopApplication(app: ChildProcess): Promise<void> {
  if (app.exitCode !== null) return;

  app.kill('SIGTERM');

  const exited = await Promise.race([
    new Promise<true>((resolve) => app.once('exit', () => resolve(true))),
    delay(STOP_TIMEOUT_MS).then(() => false),
  ]);

  if (!exited && app.exitCode === null) {
    app.kill('SIGKILL');
  }
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
