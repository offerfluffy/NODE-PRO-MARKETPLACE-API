import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module.js';
import { ProductCardRepository } from '../database/repositories/product-card.repository.js';
import { DataSource } from 'typeorm';
import { ProductCardService } from './product-card.service.js';

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
})
export class ProductsModule {}
