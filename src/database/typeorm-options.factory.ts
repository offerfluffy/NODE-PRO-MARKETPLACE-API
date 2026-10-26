import type { TypeOrmModuleOptions } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { readFile } from 'node:fs/promises';
import type { Env } from '../config/env.schema.js';
import { databaseEntities } from './entities/index.js';

export async function createTypeOrmOptions(
  config: ConfigService<Env, true>,
): Promise<TypeOrmModuleOptions> {
  const dbUrl = new URL(config.get('DB_URL', { infer: true }));
  const passwordFile = config.get('DB_PASSWORD_FILE', { infer: true });

  const password = passwordFile
    ? async () => {
        const value = (await readFile(passwordFile, 'utf8')).trim();

        if (!value) {
          throw new Error('Database password file is empty');
        }

        return value;
      }
    : decodeURIComponent(dbUrl.password);

  return {
    type: 'postgres',
    host: dbUrl.hostname,
    port: Number(dbUrl.port || 5432),
    username: decodeURIComponent(dbUrl.username),
    password,
    database: decodeURIComponent(dbUrl.pathname.slice(1)),

    entities: databaseEntities,

    synchronize: false,
    migrationsRun: false,
    logging: false,

    poolSize: 5,
  };
}
