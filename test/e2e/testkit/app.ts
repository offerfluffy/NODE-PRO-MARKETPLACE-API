import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  startTestDatabase,
  stopTestDatabase,
  type TestDatabase,
} from '../../integration/testkit/postgres.js';

export type TestApplication = TestDatabase & {
  app: INestApplication;
};

export async function startTestApplication(): Promise<TestApplication> {
  const database = await startTestDatabase();

  process.env.NODE_ENV = 'test';
  process.env.PORT = '3000';
  process.env.DB_URL = database.container.getConnectionUri();
  process.env.LOG_LEVEL = 'error';
  process.env.TIMEOUT_MS = '5000';
  delete process.env.DB_PASSWORD_FILE;

  try {
    // Must be dynamic: DB_URL must exist before AppModule is evaluated.
    const { AppModule } = await import('../../../src/app.module.js');

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

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
