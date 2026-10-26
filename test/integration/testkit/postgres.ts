import {
  PostgreSqlContainer,
  StartedPostgreSqlContainer,
} from '@testcontainers/postgresql';
import { DataSource } from 'typeorm';
import { resolve } from 'node:path';

const MIGRATIONS_GLOB = resolve(
  process.cwd(),
  'src/database/migrations/*.ts',
);

export type TestDatabase = {
  container: StartedPostgreSqlContainer;
  dataSource: DataSource;
};

export async function startTestDatabase(): Promise<TestDatabase> {
  const container = await new PostgreSqlContainer(
    'postgres:16-alpine',
  ).start();

  const dataSource = new DataSource({
    type: 'postgres',
    url: container.getConnectionUri(),
    migrations: [MIGRATIONS_GLOB],
    synchronize: false,
    logging: false,
  });

  try {
    await dataSource.initialize();
    await dataSource.runMigrations();

    return {
      container,
      dataSource,
    };
  } catch (error) {
    await stopTestDatabase({container, dataSource})

    throw error;
  }
}

export async function stopTestDatabase(
  database: TestDatabase,
): Promise<void> {
  if (database.dataSource.isInitialized) {
    await database.dataSource.destroy();
  }

  await database.container.stop();
}