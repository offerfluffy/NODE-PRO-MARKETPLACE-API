import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { OrderPlacedConsumer } from '../src/modules/messaging/rabbitmq/order-placed.consumer.js';
import { OrderPlacedPublisher } from '../src/modules/messaging/rabbitmq/order-placed.publisher.js';

export async function startOutboxDemoApp(): Promise<INestApplication> {
  const { AppModule } = await import('../src/app.module.js');

  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  })
    .overrideProvider(OrderPlacedPublisher)
    .useValue({
      publish: async () => undefined,
    })
    .overrideProvider(OrderPlacedConsumer)
    .useValue({})
    .compile();

  const app = moduleRef.createNestApplication();
  await app.init();

  return app;
}
