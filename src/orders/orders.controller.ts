import {
  BadRequestException,
  Controller,
  Get,
  NotFoundException,
  Param,
} from '@nestjs/common';
import { OrdersService, type OrderResponse } from './orders.service.js';

const MAX_POSTGRES_BIGINT = 9_223_372_036_854_775_807n;

@Controller('orders')
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  @Get(':id')
  async findById(@Param('id') id: string): Promise<OrderResponse> {
    if (!isValidOrderId(id)) {
      throw new BadRequestException(
        'Order id must be a positive PostgreSQL bigint',
      );
    }

    const order = await this.ordersService.findById(id);

    if (!order) {
      throw new NotFoundException(`Order ${id} was not found`);
    }

    return order;
  }
}

function isValidOrderId(id: string): boolean {
  if (!/^[1-9]\d*$/.test(id)) {
    return false;
  }

  return BigInt(id) <= MAX_POSTGRES_BIGINT;
}
