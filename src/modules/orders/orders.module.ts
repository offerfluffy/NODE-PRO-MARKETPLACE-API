import { Module } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { DatabaseModule } from '../database/database.module.js';
import { OrdersRepository } from '../database/repositories/orders.repository.js';
import { OrdersService } from './services/orders.service.js';
import { OrdersController } from './orders.controller.js';
import {
  CheckoutService,
  CheckoutTransactionHook,
} from './services/checkout/index.js';
import { OrderEventsService } from './realtime/order-events.service.js';
import { OrdersGateway } from './realtime/orders.gateway.js';
import { MessagingModule } from '../messaging/messaging.module.js';
import { ProductsModule } from '../products/products.module.js';

@Module({
  imports: [DatabaseModule, MessagingModule, ProductsModule],
  controllers: [OrdersController],
  providers: [
    {
      provide: OrdersRepository,
      inject: [DataSource],
      useFactory: (dataSource: DataSource) => new OrdersRepository(dataSource),
    },
    CheckoutTransactionHook,
    CheckoutService,
    OrdersService,
    OrderEventsService,
    OrdersGateway,
  ],
})
export class OrdersModule {}
