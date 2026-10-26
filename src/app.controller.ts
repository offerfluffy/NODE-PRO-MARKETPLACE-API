import { Controller, Get } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Env } from './config/env.schema.js';
import { DatabaseService } from './database/database.service.js';

@Controller()
export class AppController {
  constructor(
    private readonly config: ConfigService<Env, true>,
    private readonly database: DatabaseService,
  ) {}

  @Get('health')
  health() {
    return { status: 'ok', uptimeSec: Math.round(process.uptime()) };
  }
  @Get('db')
  checkConnection() {
    return this.database.checkConnection();
  }

  @Get('config')
  showConfig() {
    const dbUrl = new URL(this.config.get('DB_URL', { infer: true }));
    return {
      port: this.config.get('PORT', { infer: true }),
      logLevel: this.config.get('LOG_LEVEL', { infer: true }),
      timeoutMs: this.config.get('TIMEOUT_MS', { infer: true }),
      dbHost: dbUrl.host,
      dbUser: dbUrl.username,
    };
  }
}
