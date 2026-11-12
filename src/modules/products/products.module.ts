import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module.js';
import { ProductCardRepository } from '../database/repositories/product-card.repository.js';
import { DataSource } from 'typeorm';
import { ProductCardService } from './product-card.service.js';
import { ProductsController } from './products.controller.js';

@Module({
  imports: [DatabaseModule],
  providers: [
    {
      provide: ProductCardRepository,
      inject: [DataSource],
      useFactory: (dataSource: DataSource) =>
        new ProductCardRepository(dataSource),
    },
    ProductCardService,
  ],
  controllers: [ProductsController],
})
export class ProductsModule {}
