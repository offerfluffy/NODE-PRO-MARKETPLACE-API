import { connect } from 'amqplib';
import { setTimeout as delay } from 'node:timers/promises';
import dataSource from '../../database/data-source.js';
import { assertOrderPlacedTopology } from '../rabbitmq/order-placed.topology.js';
import { relayOutboxBatch } from './outbox-relay.js';
import { publishOrderPlaced } from '../rabbitmq/order-placed.publisher.js';

const BATCH_SIZE = 100;
const POLL_INTERVAL_MS = 500;

let stopping = false;

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    stopping = true;
  });
}

async function main(): Promise<void> {
  await dataSource.initialize();

  try {
    const connection = await connect(requiredEnv('BROKER_URL'));

    try {
      const channel = await connection.createConfirmChannel();

      try {
        await assertOrderPlacedTopology(channel);

        while (!stopping) {
          const published = await relayOutboxBatch(
            dataSource,
            (event) => publishOrderPlaced(channel, event),
            BATCH_SIZE,
          );

          if (published === 0) {
            await delay(POLL_INTERVAL_MS);
          }
        }
      } finally {
        await channel.close();
      }
    } finally {
      await connection.close();
    }
  } finally {
    await dataSource.destroy();
  }
}

function requiredEnv(name: string): string {
  const value = process.env[name];

  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
