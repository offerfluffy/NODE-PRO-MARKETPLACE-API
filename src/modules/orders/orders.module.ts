import { Module } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { DatabaseModule } from '../database/database.module.js';
import { OrdersRepository } from '../database/repositories/orders.repository.js';
import { OrdersService } from './services/orders.service.js';
import { OrdersController } from './orders.controller.js';
import { CheckoutService } from './services/checkout/index.js';
import { OrderEventsService } from './realtime/order-events.service.js';

@Module({
  imports: [DatabaseModule],
  controllers: [OrdersController],
  providers: [
    {
      provide: OrdersRepository,
      inject: [DataSource],
      useFactory: (dataSource: DataSource) => new OrdersRepository(dataSource),
    },
    CheckoutService,
    OrdersService,
    OrderEventsService,
  ],
  exports: [],
})
export class OrdersModule {}
