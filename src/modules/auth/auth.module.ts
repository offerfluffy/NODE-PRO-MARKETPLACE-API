import { Module } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { DatabaseModule } from '../database/database.module.js';
import { UsersRepository } from '../database/repositories/users.repository.js';
import { RefreshTokensRepository } from '../database/repositories/refresh-tokens.repository.js';
import { AuthTokenService } from './auth-token.service.js';
import { RefreshTokenService } from './refresh-token.service.js';

@Module({
  imports: [DatabaseModule],
  providers: [
    {
      provide: UsersRepository,
      inject: [DataSource],
      useFactory: (dataSource: DataSource) =>
        new UsersRepository(dataSource),
    },
    {
      provide: RefreshTokensRepository,
      inject: [DataSource],
      useFactory: (dataSource: DataSource) =>
        new RefreshTokensRepository(dataSource),
    },
    AuthTokenService,
    RefreshTokenService,
  ],
  exports: [
    AuthTokenService,
    RefreshTokenService,
  ],
})
export class AuthModule {}