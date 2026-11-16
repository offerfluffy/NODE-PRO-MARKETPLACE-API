import { Module } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { DatabaseModule } from '../database/database.module.js';
import { UsersRepository } from '../database/repositories/users.repository.js';
import { RefreshTokensRepository } from '../database/repositories/refresh-tokens.repository.js';
import { AuthTokenService } from './auth-token.service.js';
import { RefreshTokenService } from './refresh-token.service.js';
import { AuthService } from './auth.service.js';
import { AuthController } from './auth.controller.js';
import { AccessTokenGuard } from './access-token.guard.js';
import { RedisModule } from '../redis/redis.module.js';
import { AccessDenylistService } from './access-denylist.service.js';

@Module({
  imports: [DatabaseModule, RedisModule],
  controllers: [AuthController],
  providers: [
    {
      provide: UsersRepository,
      inject: [DataSource],
      useFactory: (dataSource: DataSource) => new UsersRepository(dataSource),
    },
    {
      provide: RefreshTokensRepository,
      inject: [DataSource],
      useFactory: (dataSource: DataSource) =>
        new RefreshTokensRepository(dataSource),
    },
    AuthTokenService,
    RefreshTokenService,
    AuthService,
    AccessTokenGuard,
    AccessDenylistService,
  ],
  exports: [
    AuthTokenService,
    RefreshTokenService,
    AccessTokenGuard,
    AccessDenylistService,
  ],
})
export class AuthModule {}
