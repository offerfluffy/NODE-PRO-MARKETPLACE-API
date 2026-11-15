import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  startTestDatabase,
  stopTestDatabase,
  type TestDatabase,
} from '../../integration/testkit/postgres.js';
import { OrderPlacedPublisher } from '../../../src/modules/messaging/rabbitmq/order-placed.publisher.js';
import { OrderPlacedConsumer } from '../../../src/modules/messaging/rabbitmq/order-placed.consumer.js';
import {
  CACHE_REDIS,
  DURABLE_REDIS,
} from '../../../src/modules/redis/redis.tokens.js';
import { OrderPostProcessingQueueService } from '../../../src/modules/jobs/order-post-processing-queue.service.js';
import { OrderPostProcessingWorker } from '../../../src/modules/jobs/order-post-processing.worker.js';

export type TestApplication = TestDatabase & {
  app: INestApplication;
};

export async function startTestApplication(): Promise<TestApplication> {
  const database = await startTestDatabase();

  process.env.NODE_ENV = 'test';
  process.env.PORT = '3000';
  process.env.DB_URL = database.container.getConnectionUri();
  process.env.BROKER_URL = 'amqp://app:app@127.0.0.1:21140';
  process.env.REDIS_URL = 'redis://127.0.0.1:1';
  process.env.REDIS_QUEUE_URL = 'redis://127.0.0.1:1';
  process.env.LOG_LEVEL = 'error';
  process.env.TIMEOUT_MS = '5000';
  delete process.env.DB_PASSWORD_FILE;

  try {
    // Must be dynamic: DB_URL must exist before AppModule is evaluated.
    const { AppModule } = await import('../../../src/app.module.js');
    const redisStub = {
      del: async () => 0,
      quit: async () => 'OK',
    };

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(OrderPlacedPublisher)
      .useValue({
        publish: async () => undefined,
      })
      .overrideProvider(OrderPlacedConsumer)
      .useValue({})
      .overrideProvider(CACHE_REDIS)
      .useValue(redisStub)
      .overrideProvider(DURABLE_REDIS)
      .useValue(redisStub)
      .overrideProvider(OrderPostProcessingQueueService)
      .useValue({
        enqueue: async () => undefined,
      })
      .overrideProvider(OrderPostProcessingWorker)
      .useValue({})
      .compile();

    const app = moduleRef.createNestApplication();
    await app.init();

    return { ...database, app };
  } catch (error) {
    await stopTestDatabase(database);
    throw error;
  }
}

export async function stopTestApplication(
  context: TestApplication,
): Promise<void> {
  await context.app.close();
  await stopTestDatabase(context);
}
