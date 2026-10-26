import { Injectable, Logger, OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Pool } from 'pg';
import { Env } from '../config/env.schema.js';
import { readFile } from 'fs/promises';

@Injectable()
export class DatabaseService implements OnApplicationShutdown {
  private readonly pool: Pool;

  constructor(private readonly config: ConfigService<Env, true>) {
    const connectionString = config.get('DB_URL', { infer: true });
    const passwordFile = config.get('DB_PASSWORD_FILE', { infer: true });

    const dbUrl = new URL(connectionString);
    const password = passwordFile
      ? async () => {
          const value = (await readFile(passwordFile, 'utf8')).trim();

          if (!value) {
            throw new Error('Database password file is empty');
          }

          return value;
        }
      : decodeURIComponent(dbUrl.password);

    this.pool = new Pool({
      host: dbUrl.hostname,
      port: Number(dbUrl.port || 5432),
      database: decodeURIComponent(dbUrl.pathname.slice(1)),
      user: decodeURIComponent(dbUrl.username),
      password,
    });

    this.pool.on('error', (e) => {
      const code = (e as Error & { code?: string }).code ?? 'unknown';
      Logger.log(`server closed idle-connection (code: ${code})`);
    });
  }
  async checkConnection() {
    const result = await this.pool.query(
      'SELECT current_user, now()::text AS now',
    );

    return result.rows[0];
  }

  async onApplicationShutdown(): Promise<void> {
    await this.pool.end();
  }
}
