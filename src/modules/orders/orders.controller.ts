import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
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

@Controller('orders')
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  @Post()
  async create(
    @Body(new ZodValidationPipe(createOrderSchema))
    body: CreateOrderDto,
  ): Promise<OrderResponseDto> {
    try {
      return await this.ordersService.create({
        customerId: body.customer_id,
        idempotencyKey: body.idempotency_key,
        items: body.items.map((item) => ({
          productId: item.product_id,
          quantity: item.quantity,
        })),
      });
    } catch (error: unknown) {
      throw toCheckoutHttpException(error);
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
}
