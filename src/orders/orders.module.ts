import { Module } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { DatabaseModule } from '../database/database.module.js';
import { OrdersRepository } from '../database/repositories/orders.repository.js';
import { OrdersService } from './orders.service.js';
import { OrdersController } from './orders.controller.js';

@Module({
  imports: [DatabaseModule],
  controllers: [OrdersController],
  providers: [
    {
      provide: OrdersRepository,
      inject: [DataSource],
      useFactory: (dataSource: DataSource) => new OrdersRepository(dataSource),
    },
    OrdersService,
  ],
  exports: [OrdersRepository],
})
export class OrdersModule {}
