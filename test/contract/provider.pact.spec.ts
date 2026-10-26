import path from 'node:path';
import { Verifier } from '@pact-foundation/pact';
import { seedDatabase } from '../../src/modules/database/seed/seed-database.js';
import {
  startTestApplication,
  stopTestApplication,
  type TestApplication,
} from '../e2e/testkit/app.js';

describe('Pact provider verification', () => {
  let context: TestApplication;

  beforeAll(async () => {
    context = await startTestApplication();

    // Pact needs a real HTTP address, unlike supertest.
    await context.app.listen(0, '127.0.0.1');
  });

  afterAll(async () => {
    if (context) {
      await stopTestApplication(context);
    }
  });

  it('satisfies the consumer contract', async () => {
    const providerBaseUrl = await context.app.getUrl();

    await new Verifier({
      provider: 'marketplace-api',
      providerBaseUrl,
      pactUrls: [
        path.resolve(
          process.cwd(),
          'pacts/marketplace-web-marketplace-api.json',
        ),
      ],
      stateHandlers: {
        'order with id 1 exists': async () => {
          await seedDatabase(context.dataSource);
        },
      },
    }).verifyProvider();
  });
});