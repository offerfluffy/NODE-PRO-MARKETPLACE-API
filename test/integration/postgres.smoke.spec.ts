import {
  PostgreSqlContainer,
  StartedPostgreSqlContainer,
} from '@testcontainers/postgresql';
import { Pool } from 'pg';

describe('PostgreSQL testcontainer', () => {
  let container: StartedPostgreSqlContainer | undefined;
  let pool: Pool | undefined;

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:16-alpine').start();

    pool = new Pool({
      connectionString: container.getConnectionUri(),
    });
  });

  afterAll(async () => {
    await pool?.end();
    await container?.stop();
  });

  it('executes SQL against a real PostgreSQL instance', async () => {
    if (!pool) {
      throw new Error('PostgreSQL pool was not initialized');
    }

    const result = await pool.query<{ answer: number }>(
      'SELECT 1::integer AS answer',
    );

    expect(result.rows[0]).toEqual({ answer: 1 });
  });
});