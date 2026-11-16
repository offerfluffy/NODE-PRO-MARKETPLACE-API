import { spawn, type ChildProcess } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import dataSource from '../src/modules/database/data-source.js';
import { Order } from '../src/modules/database/entities/order.entity.js';
import {
  Product,
  ProductStatus,
} from '../src/modules/database/entities/product.entity.js';
import { RefreshToken } from '../src/modules/database/entities/refreshToken.entity.js';
import { User } from '../src/modules/database/entities/user.entity.js';
import { seedDatabase } from '../src/modules/database/seed/seed-database.js';

const PORT = 21_243;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const DEMO_PASSWORD = 'demo-password';
const CUSTOMER_ONE_EMAIL = 'customer.one@example.com';
const CUSTOMER_TWO_EMAIL = 'customer.two@example.com';
const SELLER_EMAIL = 'seller.one@example.com';
const DEMO_ORDER_KEY = 'seed-order-001';
const DEMO_PRODUCT_NAME = 'RBAC Demo Product';
const START_TIMEOUT_MS = 30_000;
const STOP_TIMEOUT_MS = 5_000;

type DemoStatuses = {
  anon: number;
  own: number;
  foreign: number;
  roleDenied: number;
  roleAllowed: number;
  tampered: number;
};

type DemoContext = {
  orderId: string;
  userIds: string[];
};

async function main(): Promise<void> {
  let app: ChildProcess | undefined;
  let demo: DemoContext | undefined;

  try {
    await dataSource.initialize();
    await dataSource.runMigrations();
    await seedDatabase(dataSource);

    demo = await findDemoContext();
    await clearDemoState(demo);

    app = startApplication();
    await waitUntilReady(app);

    const statuses = await runScenario(demo.orderId);
    printStatuses(statuses);
    assertStatuses(statuses);
  } finally {
    if (app) await stopApplication(app);

    if (dataSource.isInitialized) {
      if (demo) {
        await clearDemoState(demo).catch(() => undefined);
      }

      await dataSource.destroy();
    }
  }
}

async function runScenario(orderId: string): Promise<DemoStatuses> {
  const [customerOne, customerTwo, seller] = await Promise.all([
    login(CUSTOMER_ONE_EMAIL),
    login(CUSTOMER_TWO_EMAIL),
    login(SELLER_EMAIL),
  ]);

  const anon = await getOrder(orderId);
  await anon.arrayBuffer();

  const own = await getOrder(orderId, customerOne);
  await own.arrayBuffer();

  const foreign = await getOrder(orderId, customerTwo);
  await foreign.arrayBuffer();

  const roleDenied = await createProduct(customerOne);
  await roleDenied.arrayBuffer();

  const roleAllowed = await createProduct(seller);
  await roleAllowed.arrayBuffer();

  const tampered = await createProduct(tamperRole(customerOne));
  await tampered.arrayBuffer();

  return {
    anon: anon.status,
    own: own.status,
    foreign: foreign.status,
    roleDenied: roleDenied.status,
    roleAllowed: roleAllowed.status,
    tampered: tampered.status,
  };
}

async function login(email: string): Promise<string> {
  const response = await fetch(`${BASE_URL}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      email,
      password: DEMO_PASSWORD,
    }),
    signal: AbortSignal.timeout(5_000),
  });
  const body: unknown = await response.json();

  if (response.status !== 200) {
    throw new Error(`Login for ${email} returned ${response.status}`);
  }

  if (
    typeof body !== 'object' ||
    body === null ||
    !('accessToken' in body) ||
    typeof body.accessToken !== 'string'
  ) {
    throw new Error(`Login for ${email} did not return an access token`);
  }

  return body.accessToken;
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

function createProduct(accessToken: string): Promise<Response> {
  return fetch(`${BASE_URL}/products`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${accessToken}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      name: DEMO_PRODUCT_NAME,
      description: 'Product created by demo:rbac',
      price_cents: 12_900,
      quantity_available: 7,
      status: ProductStatus.ACTIVE,
      image_url: null,
    }),
    signal: AbortSignal.timeout(5_000),
  });
}

function tamperRole(accessToken: string): string {
  const parts = accessToken.split('.');

  if (parts.length !== 3) {
    throw new Error('Access token is not a JWT');
  }

  const payload = JSON.parse(
    Buffer.from(parts[1], 'base64url').toString('utf8'),
  ) as Record<string, unknown>;

  payload.role = 'admin';
  parts[1] = Buffer.from(JSON.stringify(payload)).toString('base64url');

  return parts.join('.');
}

function printStatuses(statuses: DemoStatuses): void {
  console.log(`anon=${statuses.anon}`);
  console.log(`own=${statuses.own}`);
  console.log(`foreign=${statuses.foreign}`);
  console.log(`role-denied=${statuses.roleDenied}`);
  console.log(`role-allowed=${statuses.roleAllowed}`);
  console.log(`tampered=${statuses.tampered}`);
}

function assertStatuses(statuses: DemoStatuses): void {
  const expected: DemoStatuses = {
    anon: 401,
    own: 200,
    foreign: 403,
    roleDenied: 403,
    roleAllowed: 201,
    tampered: 401,
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
  const users = dataSource.getRepository(User);
  const [customerOne, customerTwo, seller, order] = await Promise.all([
    users.findOneBy({ email: CUSTOMER_ONE_EMAIL }),
    users.findOneBy({ email: CUSTOMER_TWO_EMAIL }),
    users.findOneBy({ email: SELLER_EMAIL }),
    dataSource.getRepository(Order).findOneBy({
      idempotencyKey: DEMO_ORDER_KEY,
    }),
  ]);

  if (!customerOne || !customerTwo || !seller || !order) {
    throw new Error('Required RBAC demo seed data was not found');
  }

  return {
    orderId: order.id,
    userIds: [customerOne.id, customerTwo.id, seller.id],
  };
}

async function clearDemoState(demo: DemoContext): Promise<void> {
  await dataSource
    .getRepository(RefreshToken)
    .createQueryBuilder()
    .delete()
    .from(RefreshToken)
    .where('user_id IN (:...userIds)', { userIds: demo.userIds })
    .execute();

  await dataSource.getRepository(Product).delete({
    name: DEMO_PRODUCT_NAME,
  });
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
