import request from 'supertest';
import {
  startTestApplication,
  stopTestApplication,
  type TestApplication,
} from './testkit/app.js';

describe('Application E2E', () => {
  let context: TestApplication;

  beforeAll(async () => {
    context = await startTestApplication();
  });

  afterAll(async () => {
    await stopTestApplication(context);
  });

  it('connects the full application to the test database', async () => {
    const response = await request(context.app.getHttpServer())
      .get('/db')
      .expect(200);

    expect(response.body.current_user).toBe(context.container.getUsername());
  });
});
