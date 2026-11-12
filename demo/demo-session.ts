import { setTimeout as delay } from 'node:timers/promises';
import { Redis } from 'ioredis';
import { SessionStoreService } from '../src/modules/sessions/session-store.service.js';

const DEMO_USER_ID = '1';
const TTL_COUNTDOWN_WAIT_MS = 2_100;

function requiredEnv(name: string): string {
  const value = process.env[name];

  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

async function main(): Promise<void> {
  const redisUrl = requiredEnv('REDIS_QUEUE_URL');
  let redis = new Redis(redisUrl);
  let sessionStore = new SessionStoreService(redis);
  let sessionId: string | undefined;
  const sessionIds = new Set<string>();

  try {
    sessionId = await sessionStore.create({ userId: DEMO_USER_ID });
    sessionIds.add(sessionId);

    const sessionKey = `session:${sessionId}`;
    const exists = await redis.exists(sessionKey);
    const firstRead = await sessionStore.read(sessionId);

    if (exists !== 1) {
      throw new Error('The created session was not found in Redis');
    }

    if (firstRead?.userId !== DEMO_USER_ID) {
      throw new Error('The session could not be read back correctly');
    }

    await delay(TTL_COUNTDOWN_WAIT_MS);

    const ttlBeforeRenewal = await redis.ttl(sessionKey);
    const secondRead = await sessionStore.read(sessionId);
    const ttlAfterRenewal = await redis.ttl(sessionKey);
    const ttlRenewed = ttlAfterRenewal > ttlBeforeRenewal;

    if (secondRead?.userId !== DEMO_USER_ID) {
      throw new Error('The session was not returned during TTL renewal');
    }

    if (!ttlRenewed) {
      throw new Error(
        `Expected rolling TTL to increase, got ${ttlBeforeRenewal} -> ${ttlAfterRenewal}`,
      );
    }

    await redis.quit();

    redis = new Redis(redisUrl);
    sessionStore = new SessionStoreService(redis);

    const readAfterRestart = await sessionStore.read(sessionId);

    if (readAfterRestart?.userId !== DEMO_USER_ID) {
      throw new Error('The session did not survive the client restart');
    }

    console.log('requests=3');
    console.log(`sessions=${sessionIds.size}`);
    console.log(`in-redis=${exists === 1 ? 1 : 0}`);
    console.log(`ttl-renewed=${ttlRenewed ? 1 : 0}`);
    console.log('survived-restart=1');
  } finally {
    if (sessionId) {
      await sessionStore.delete(sessionId).catch(() => undefined);
    }

    await redis.quit().catch(() => undefined);
  }
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
