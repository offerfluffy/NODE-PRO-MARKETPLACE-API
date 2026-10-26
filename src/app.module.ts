import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller.js';
import { validate } from './config/env.schema.js';
import { DatabaseModule } from './database/database.module.js';
import { OrdersModule } from './orders/orders.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      ignoreEnvFile: process.env.NODE_ENV === 'test',
      validate,
    }),
    DatabaseModule,
    OrdersModule,
  ],
  controllers: [AppController],
  providers: [],
})
export class AppModule {}
