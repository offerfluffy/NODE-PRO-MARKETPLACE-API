import { randomInt } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import {
  Controller,
  Get,
  type INestApplication,
  UseGuards,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Redis } from 'ioredis';
import { DURABLE_REDIS } from '../src/modules/redis/redis.tokens.js';
import { ProductRateLimitGuard } from '../src/modules/rate-limit/product-rate-limit.guard.js';
import {
  RATE_LIMIT,
  RateLimitService,
} from '../src/modules/rate-limit/rate-limit.service.js';

const INSTANCE_COUNT = 2;
const REQUEST_COUNT = RATE_LIMIT + 3;

export type DemoRateLimitInstance = {
  app: INestApplication;
  limiter: RateLimitService;
  redis: Redis;
  url: string;
};

@Controller()
@UseGuards(ProductRateLimitGuard)
class DemoRateLimitController {
  @Get()
  allowed(): { ok: true } {
    return { ok: true };
  }
}

export async function startDemoInstance(
  redisUrl: string,
): Promise<DemoRateLimitInstance> {
  const redis = new Redis(redisUrl);
  const moduleRef = await Test.createTestingModule({
    controllers: [DemoRateLimitController],
    providers: [
      {
        provide: DURABLE_REDIS,
        useValue: redis,
      },
      RateLimitService,
      ProductRateLimitGuard,
    ],
  }).compile();

  const app = moduleRef.createNestApplication();
  app.getHttpAdapter().getInstance().set('trust proxy', true);
  await app.listen(0, '127.0.0.1');

  const address = app.getHttpServer().address() as AddressInfo;

  return {
    app,
    limiter: moduleRef.get(RateLimitService),
    redis,
    url: `http://127.0.0.1:${address.port}`,
  };
}

function requiredEnv(name: string): string {
  const value = process.env[name];

  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

async function stopDemoInstance(
  instance: DemoRateLimitInstance,
): Promise<void> {
  await instance.app.close().catch(() => undefined);
  await instance.redis.quit().catch(() => undefined);
}

async function main(): Promise<void> {
  const redisUrl = requiredEnv('REDIS_QUEUE_URL');
  const clientId = `203.0.113.${randomInt(1, 255)}`;
  const instances: DemoRateLimitInstance[] = [];

  try {
    for (let index = 0; index < INSTANCE_COUNT; index += 1) {
      instances.push(await startDemoInstance(redisUrl));
    }

    await instances[0].limiter.reset(clientId);

    const responses = await Promise.all(
      Array.from({ length: REQUEST_COUNT }, (_, index) =>
        fetch(instances[index % instances.length].url, {
          headers: {
            'x-forwarded-for': clientId,
          },
        }),
      ),
    );

    await Promise.all(responses.map((response) => response.arrayBuffer()));

    const allowed = responses.filter((response) => response.status === 200);
    const blocked = responses.filter((response) => response.status === 429);
    const lastRejection = blocked.at(-1);
    const hasRetryAfter = lastRejection?.headers.has('retry-after') ?? false;

    if (allowed.length !== RATE_LIMIT) {
      throw new Error(
        `Expected ${RATE_LIMIT} allowed requests, received ${allowed.length}`,
      );
    }

    if (blocked.length < 1 || lastRejection?.status !== 429) {
      throw new Error('Expected at least one HTTP 429 response');
    }

    if (!hasRetryAfter) {
      throw new Error('Expected the final rejection to include Retry-After');
    }

    console.log(`instances=${instances.length}`);
    console.log(`limit=${RATE_LIMIT}`);
    console.log(`requests=${responses.length}`);
    console.log(`allowed=${allowed.length}`);
    console.log(`blocked=${blocked.length}`);
    console.log(`status=${lastRejection.status}`);
    console.log(`retry-after=${hasRetryAfter ? 1 : 0}`);
  } finally {
    if (instances[0]) {
      await instances[0].limiter.reset(clientId).catch(() => undefined);
    }

    await Promise.allSettled(instances.map(stopDemoInstance));
  }
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
