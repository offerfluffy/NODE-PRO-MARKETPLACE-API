import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { OrderPlacedConsumer } from '../src/modules/messaging/rabbitmq/order-placed.consumer.js';
import { OrderPlacedPublisher } from '../src/modules/messaging/rabbitmq/order-placed.publisher.js';
import { CheckoutTransactionHook } from '../src/modules/orders/services/checkout/index.js';
import type { OrderPlacedEvent } from '../src/modules/orders/events/order-placed.event.js';

type OutboxDemoAppOptions = {
  afterOutboxEnqueued?: (event: OrderPlacedEvent) => Promise<void>;
};

export async function startOutboxDemoApp(
  options: OutboxDemoAppOptions = {},
): Promise<INestApplication> {
  const { AppModule } = await import('../src/app.module.js');

  const moduleBuilder = Test.createTestingModule({
    imports: [AppModule],
  })
    .overrideProvider(OrderPlacedPublisher)
    .useValue({
      publish: async () => undefined,
    })
    .overrideProvider(OrderPlacedConsumer)
    .useValue({});

  if (options.afterOutboxEnqueued) {
    moduleBuilder.overrideProvider(CheckoutTransactionHook).useValue({
      afterOutboxEnqueued: options.afterOutboxEnqueued,
    });
  }

  const moduleRef = await moduleBuilder.compile();

  const app = moduleRef.createNestApplication({ logger: false });
  await app.init();

  return app;
}
