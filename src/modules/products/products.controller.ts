import {
  Controller,
  Get,
  NotFoundException,
  Param,
  UseGuards,
} from '@nestjs/common';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { postgresBigintIdSchema } from '../orders/dto/create-order.dto.js';
import type { ProductCardDto } from './dto/product-card.dto.js';
import { ProductCardService } from './product-card.service.js';
import { ProductRateLimitGuard } from '../rate-limit/product-rate-limit.guard.js';

@Controller('products')
export class ProductsController {
  constructor(private readonly productCardService: ProductCardService) {}

  @UseGuards(ProductRateLimitGuard)
  @Get(':id')
  async findById(
    @Param('id', new ZodValidationPipe(postgresBigintIdSchema))
    id: string,
  ): Promise<ProductCardDto> {
    const product = await this.productCardService.findById(id);

    if (!product) {
      throw new NotFoundException(`Product ${id} was not found`);
    }

    return product;
  }
}
