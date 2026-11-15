import {
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import {
  connect,
  type ConsumeMessage,
  type Channel,
  type ChannelModel,
} from 'amqplib';
import type { Env } from '../../../config/env.schema.js';
import {
  assertOrderPlacedTopology,
  ORDER_PLACED_TOPOLOGY,
} from './order-placed.topology.js';
import {
  type OrderPlacedEvent,
  orderPlacedEventSchema,
} from '../../orders/events/order-placed.event.js';
import { applyOrderPlacedEffect } from '../../orders/events/apply-order-placed.effect.js';
import { OrderPostProcessingQueueService } from '../../jobs/order-post-processing-queue.service.js';

export const ORDER_PLACED_PREFETCH = 10;

@Injectable()
export class OrderPlacedConsumer implements OnModuleInit, OnModuleDestroy {
  private connection: ChannelModel | undefined;
  private channel: Channel | undefined;
  private consumerTag: string | undefined;
  private readonly logger = new Logger(OrderPlacedConsumer.name);

  constructor(
    private readonly config: ConfigService<Env, true>,
    private readonly dataSource: DataSource,
    private readonly orderPostProcessingQueueService: OrderPostProcessingQueueService,
  ) {}

  private async handleMessage(
    channel: Channel,
    message: ConsumeMessage,
  ): Promise<void> {
    let event: OrderPlacedEvent;

    try {
      const body: unknown = JSON.parse(message.content.toString('utf8'));

      event = orderPlacedEventSchema.parse(body);
    } catch {
      channel.reject(message, false);
      return;
    }

    try {
      await applyOrderPlacedEffect(this.dataSource, event);
    } catch {
      channel.reject(message, false);
      return;
    }

    try {
      await this.orderPostProcessingQueueService.enqueue({
        eventId: event.eventId,
        orderId: event.data.orderId,
        customerId: event.data.customerId,
      });
    } catch {
      channel.nack(message, false, true);
      return;
    }

    channel.ack(message);
  }

  async onModuleInit(): Promise<void> {
    const brokerUrl = this.config.get('BROKER_URL', {
      infer: true,
    });
    const connection = await connect(brokerUrl);

    try {
      const channel = await connection.createChannel();

      try {
        await assertOrderPlacedTopology(channel);
        await channel.prefetch(ORDER_PLACED_PREFETCH);

        const { consumerTag } = await channel.consume(
          ORDER_PLACED_TOPOLOGY.queue,
          (message) => {
            if (!message) {
              this.logger.warn('RabbitMQ cancelled the consumer');
              return;
            }

            void this.handleMessage(channel, message).catch(
              (error: unknown) => {
                this.logger.error(
                  'Unhandled order.placed consumer error',
                  error instanceof Error ? error.stack : undefined,
                );
              },
            );
          },
          {
            noAck: false,
          },
        );

        this.connection = connection;
        this.channel = channel;
        this.consumerTag = consumerTag;
      } catch (error) {
        await channel.close();
        throw error;
      }
    } catch (error) {
      await connection.close();
      throw error;
    }
  }

  async onModuleDestroy(): Promise<void> {
    const consumerTag = this.consumerTag;
    const channel = this.channel;
    const connection = this.connection;

    this.consumerTag = undefined;
    this.channel = undefined;
    this.connection = undefined;

    try {
      if (channel && consumerTag) {
        await channel.cancel(consumerTag);
      }
    } finally {
      try {
        await channel?.close();
      } finally {
        await connection?.close();
      }
    }
  }
}
