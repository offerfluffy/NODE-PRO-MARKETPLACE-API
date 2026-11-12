import {
  Injectable,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { connect, type ChannelModel, type ConfirmChannel } from 'amqplib';
import type { Env } from '../../../config/env.schema.js';
import type { OrderPlacedEvent } from '../../orders/events/order-placed.event.js';
import { ORDER_PLACED_TOPOLOGY } from './order-placed.topology.js';

@Injectable()
export class OrderPlacedPublisher implements OnModuleInit, OnModuleDestroy {
  private connection: ChannelModel | undefined;
  private channel: ConfirmChannel | undefined;

  constructor(private readonly config: ConfigService<Env, true>) {}

  async onModuleInit(): Promise<void> {
    const brokerUrl = this.config.get('BROKER_URL', {
      infer: true,
    });
    const connection = await connect(brokerUrl);

    try {
      const channel = await connection.createConfirmChannel();

      this.connection = connection;
      this.channel = channel;
    } catch (error) {
      await connection.close();
      throw error;
    }
  }

  async publish(event: OrderPlacedEvent): Promise<void> {
    const channel = this.channel;

    if (!channel) {
      throw new Error('RabbitMQ publisher is not initialized');
    }

    await publishOrderPlaced(channel, event);
  }

  async onModuleDestroy(): Promise<void> {
    const channel = this.channel;
    const connection = this.connection;

    this.channel = undefined;
    this.connection = undefined;

    try {
      await channel?.close();
    } finally {
      await connection?.close();
    }
  }
}

export async function publishOrderPlaced(
  channel: ConfirmChannel,
  event: OrderPlacedEvent,
): Promise<void> {
  const payload = Buffer.from(JSON.stringify(event), 'utf8');

  channel.publish(
    ORDER_PLACED_TOPOLOGY.exchange,
    ORDER_PLACED_TOPOLOGY.routingKey,
    payload,
    {
      persistent: true,
      contentType: 'application/json',
      contentEncoding: 'utf-8',
      messageId: event.eventId,
      type: event.type,
    },
  );

  await channel.waitForConfirms();
}
