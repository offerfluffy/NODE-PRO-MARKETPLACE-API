import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller.js';
import { validate } from './config/env.schema.js';
import { DatabaseModule } from './modules/database/database.module.js';
import { OrdersModule } from './modules/orders/orders.module.js';
import { RedisModule } from './modules/redis/redis.module.js';
import { ProductsModule } from './modules/products/products.module.js';
import { SessionsModule } from './modules/sessions/sessions.module.js';
import { AuthModule } from './modules/auth/auth.module.js';
import { UploadsModule } from './modules/uploads/uploads.module.js';
import { ProbesModule } from './modules/probes/probes.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      ignoreEnvFile: process.env.NODE_ENV === 'test',
      validate,
    }),
    ProbesModule,
    RedisModule,
    DatabaseModule,
    AuthModule,
    OrdersModule,
    ProductsModule,
    SessionsModule,
    UploadsModule,
  ],
  controllers: [AppController],
  providers: [],
})
export class AppModule {}
