import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { OrderPlacedPublisher } from './rabbitmq/order-placed.publisher.js';

@Module({
  imports: [ConfigModule],
  providers: [OrderPlacedPublisher],
  exports: [OrderPlacedPublisher],
})
export class MessagingModule {}
