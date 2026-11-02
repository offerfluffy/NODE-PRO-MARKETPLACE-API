import { assertOrderPlacedTopology } from './order-placed.topology.js';
import { withRabbitChannel } from './rabbitmq-connection.js';

async function main() {
  const brokerUrl = requiredEnv('BROKER_URL');

  await withRabbitChannel(brokerUrl, assertOrderPlacedTopology);

  console.log('rabbitmq-topology=ready');
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});

function requiredEnv(name: string): string {
  const value = process.env[name];

  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}
