import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { OrderPlacedPublisher } from './rabbitmq/order-placed.publisher.js';
import { OrderPlacedConsumer } from './rabbitmq/order-placed.consumer.js';

@Module({
  imports: [ConfigModule],
  providers: [OrderPlacedPublisher, OrderPlacedConsumer],
  exports: [OrderPlacedPublisher],
})
export class MessagingModule {}
