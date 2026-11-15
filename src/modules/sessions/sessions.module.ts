import { Module } from '@nestjs/common';
import { RedisModule } from '../redis/redis.module.js';
import { SessionStoreService } from './session-store.service.js';

@Module({
  imports: [RedisModule],
  providers: [SessionStoreService],
  exports: [SessionStoreService],
})
export class SessionsModule {}
