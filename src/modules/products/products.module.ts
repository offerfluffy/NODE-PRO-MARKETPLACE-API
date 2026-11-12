import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module.js';
import { ProductCardRepository } from '../database/repositories/product-card.repository.js';
import { DataSource } from 'typeorm';
import { ProductCardService } from './product-card.service.js';
import { ProductsController } from './products.controller.js';
import { RedisModule } from '../redis/redis.module.js';
import { ProductCardCacheService } from './product-card-cache.service.js';
import { RateLimitModule } from '../rate-limit/rate-limit.module.js';

@Module({
  imports: [DatabaseModule, RedisModule, RateLimitModule],
  providers: [
    {
      provide: ProductCardRepository,
      inject: [DataSource],
      useFactory: (dataSource: DataSource) =>
        new ProductCardRepository(dataSource),
    },
    ProductCardCacheService,
    ProductCardService,
  ],
  controllers: [ProductsController],
  exports: [ProductCardCacheService],
})
export class ProductsModule {}
