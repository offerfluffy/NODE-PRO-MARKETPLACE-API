import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Patch,
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
import {
  updateOrderStatusSchema,
  type UpdateOrderStatusDto,
} from './dto/update-order-status.dto.js';

@Controller('orders')
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

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
}
