import { Module } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { DatabaseModule } from '../database/database.module.js';
import { OrdersRepository } from '../database/repositories/orders.repository.js';

@Module({
  imports: [DatabaseModule],
  providers: [
    {
      provide: OrdersRepository,
      inject: [DataSource],
      useFactory: (dataSource: DataSource) => new OrdersRepository(dataSource),
    },
  ],
  exports: [OrdersRepository],
})
export class OrdersModule {}
