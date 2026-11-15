import { Module } from '@nestjs/common';
import { AuthTokenService } from './auth-token.service.js';
import { RefreshTokenService } from './refresh-token.service.js';

@Module({
  providers: [AuthTokenService, RefreshTokenService],
  exports: [AuthTokenService, RefreshTokenService],
})
export class AuthModule {}
