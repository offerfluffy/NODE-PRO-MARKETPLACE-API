import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module.js';
import { ProductCardRepository } from '../database/repositories/product-card.repository.js';
import { DataSource } from 'typeorm';
import { ProductCardService } from './services/product-card.service.js';
import { ProductsController } from './products.controller.js';
import { RedisModule } from '../redis/redis.module.js';
import { ProductCardCacheService } from './services/product-card-cache.service.js';
import { RateLimitModule } from '../rate-limit/rate-limit.module.js';
import { ProductsRepository } from '../database/repositories/products.repository.js';
import { AuthModule } from '../auth/auth.module.js';
import { ProductsService } from './services/products.service.js';

@Module({
  imports: [DatabaseModule, RedisModule, RateLimitModule, AuthModule],
  providers: [
    {
      provide: ProductCardRepository,
      inject: [DataSource],
      useFactory: (dataSource: DataSource) =>
        new ProductCardRepository(dataSource),
    },
    {
      provide: ProductsRepository,
      inject: [DataSource],
      useFactory: (dataSource: DataSource) =>
        new ProductsRepository(dataSource),
    },
    ProductCardCacheService,
    ProductCardService,
    ProductsService,
  ],
  controllers: [ProductsController],
  exports: [ProductCardCacheService],
})
export class ProductsModule {}
