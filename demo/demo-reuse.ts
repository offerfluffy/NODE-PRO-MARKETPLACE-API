import { spawn, type ChildProcess } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import dataSource from '../src/modules/database/data-source.js';
import { RefreshToken } from '../src/modules/database/entities/refreshToken.entity.js';
import { User } from '../src/modules/database/entities/user.entity.js';
import { seedDatabase } from '../src/modules/database/seed/seed-database.js';

const PORT = 21_242;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const DEMO_EMAIL = 'customer.two@example.com';
const DEMO_PASSWORD = 'demo-password';
const START_TIMEOUT_MS = 30_000;
const STOP_TIMEOUT_MS = 5_000;

type DemoStatuses = {
  login: number;
  r1Refresh: number;
  r1Reuse: number;
  r2AfterReuse: number;
};

async function main(): Promise<void> {
  let app: ChildProcess | undefined;
  let demoUserId: string | undefined;

  try {
    await dataSource.initialize();
    await dataSource.runMigrations();
    await seedDatabase(dataSource);

    demoUserId = await findDemoUserId();
    await clearDemoSessions(demoUserId);

    app = startApplication();
    await waitUntilReady(app);

    const statuses = await runScenario();
    printStatuses(statuses);
    assertStatuses(statuses);
  } finally {
    if (app) await stopApplication(app);

    if (dataSource.isInitialized) {
      if (demoUserId) {
        await clearDemoSessions(demoUserId).catch(() => undefined);
      }

      await dataSource.destroy();
    }
  }
}

async function runScenario(): Promise<DemoStatuses> {
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
  await login.arrayBuffer();

  if (!r1) {
    throw new Error('Login did not return the R1 refresh cookie');
  }

  const firstRefresh = await refresh(r1);
  const r2 = readCookie(firstRefresh);
  await firstRefresh.arrayBuffer();

  if (!r2) {
    throw new Error('R1 refresh did not return the R2 refresh cookie');
  }

  const r1Reuse = await refresh(r1);
  await r1Reuse.arrayBuffer();

  const r2AfterReuse = await refresh(r2);
  await r2AfterReuse.arrayBuffer();

  return {
    login: login.status,
    r1Refresh: firstRefresh.status,
    r1Reuse: r1Reuse.status,
    r2AfterReuse: r2AfterReuse.status,
  };
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

function printStatuses(statuses: DemoStatuses): void {
  console.log(`login=${statuses.login}`);
  console.log(`r1-refresh=${statuses.r1Refresh}`);
  console.log(`r1-reuse=${statuses.r1Reuse}`);
  console.log(`r2-after-reuse=${statuses.r2AfterReuse}`);
}

function assertStatuses(statuses: DemoStatuses): void {
  const expected: DemoStatuses = {
    login: 200,
    r1Refresh: 200,
    r1Reuse: 401,
    r2AfterReuse: 401,
  };

  for (const key of Object.keys(expected) as Array<keyof DemoStatuses>) {
    if (statuses[key] !== expected[key]) {
      throw new Error(
        `${key}: expected ${expected[key]}, received ${statuses[key]}`,
      );
    }
  }
}

async function findDemoUserId(): Promise<string> {
  const user = await dataSource.getRepository(User).findOneBy({
    email: DEMO_EMAIL,
  });

  if (!user) {
    throw new Error(`Seed user was not found: ${DEMO_EMAIL}`);
  }

  return user.id;
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
