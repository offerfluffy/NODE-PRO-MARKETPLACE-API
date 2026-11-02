import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Patch,
  Post,
  Sse,
  Headers,
  UnauthorizedException,
  type MessageEvent,
} from '@nestjs/common';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import {
  createOrderSchema,
  postgresBigintIdSchema,
  type CreateOrderDto,
} from './dto/create-order.dto.js';
import type { OrderResponseDto } from './dto/order-response.dto.js';
import { toCheckoutHttpException } from './checkout-http-error.mapper.js';
import { OrdersService } from './services/orders.service.js';
import {
  updateOrderStatusSchema,
  type UpdateOrderStatusDto,
} from './dto/update-order-status.dto.js';
import { OrderEventsService } from './realtime/order-events.service.js';
import {
  concat,
  defer,
  from,
  map,
  mergeMap,
  startWith,
  type Observable,
} from 'rxjs';

const SSE_RETRY_MS = 1_500;

@Controller('orders')
export class OrdersController {
  constructor(
    private readonly ordersService: OrdersService,
    private readonly orderEventsService: OrderEventsService,
  ) {}

  @Post()
  async create(
    @Body(new ZodValidationPipe(createOrderSchema))
    body: CreateOrderDto,
  ): Promise<OrderResponseDto> {
    try {
      return await this.ordersService.create(body);
    } catch (error: unknown) {
      throw toCheckoutHttpException(error);
    }
  }

  @Patch(':id/status')
  @HttpCode(HttpStatus.NO_CONTENT)
  async updateStatus(
    @Body(new ZodValidationPipe(updateOrderStatusSchema))
    body: UpdateOrderStatusDto,
    @Param('id', new ZodValidationPipe(postgresBigintIdSchema))
    id: string,
  ): Promise<void> {
    const result = await this.ordersService.updateStatus(id, body.status);

    if (!result) {
      throw new NotFoundException(`Order ${id} was not found`);
    }
  }

  @Get(':id')
  async findById(
    @Param('id', new ZodValidationPipe(postgresBigintIdSchema))
    id: string,
  ): Promise<OrderResponseDto> {
    const order = await this.ordersService.findById(id);

    if (!order) {
      throw new NotFoundException(`Order ${id} was not found`);
    }

    return order;
  }

  @Sse(':id/events')
  async events(
    @Param('id', new ZodValidationPipe(postgresBigintIdSchema))
    id: string,
    @Headers('x-user-id') userIdHeader: string | undefined,
    @Headers('last-event-id')
    lastEventIdHeader: string | undefined,
  ): Promise<Observable<MessageEvent>> {
    const userIdResult = postgresBigintIdSchema.safeParse(userIdHeader);
    if (!userIdResult.success) {
      throw new UnauthorizedException('A valid x-user-id header is required');
    }

    const ownsOrder = await this.ordersService.isOwnedByCustomer(
      id,
      userIdResult.data,
    );
    if (!ownsOrder) {
      throw new ForbiddenException(
        'The order does not belong to this customer',
      );
    }

    const parsedLastEventId = Number(lastEventIdHeader ?? '0');
    const lastEventId =
      Number.isSafeInteger(parsedLastEventId) && parsedLastEventId >= 0
        ? parsedLastEventId
        : 0;

    const replay$ = defer(() =>
      from(this.orderEventsService.eventsAfter(id, lastEventId)),
    ).pipe(mergeMap((events) => from(events)));

    const events$ = concat(replay$, this.orderEventsService.eventsFor(id));

    return events$.pipe(
      map((event): MessageEvent => ({
        id: String(event.id),
        type: 'order.status',
        data: event,
      })),
      startWith<MessageEvent>({ comment: 'connected', retry: SSE_RETRY_MS }),
    );
  }
}
