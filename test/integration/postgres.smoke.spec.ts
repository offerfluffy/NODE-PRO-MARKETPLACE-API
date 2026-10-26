import {
  startTestDatabase,
  stopTestDatabase,
  TestDatabase,
} from './testkit/postgres';

describe('PostgreSQL testcontainer', () => {
  let database: TestDatabase | undefined;

  beforeAll(async () => {
    database = await startTestDatabase();
  });

  afterAll(async () => {
    if (database) {
      await stopTestDatabase(database);
    }
  });

  it('runs all migrations against a real PostgreSQL instance', async () => {
    if (!database) {
      throw new Error('Test database was not initialized');
    }

    const rows: Array<{ table_name: string | null }> =
      await database.dataSource.query(
        `SELECT to_regclass('public.orders')::text AS table_name`,
      );

    expect(rows[0].table_name).toBe('orders');
  });
});