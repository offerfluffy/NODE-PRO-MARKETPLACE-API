import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { postgresBigintIdSchema } from '../orders/dto/create-order.dto.js';
import type { ProductCardDto } from './dto/product-card.dto.js';
import { ProductCardService } from './product-card.service.js';
import { ProductRateLimitGuard } from '../rate-limit/product-rate-limit.guard.js';
import { ProductsService } from './products.service.js';
import { AccessTokenGuard } from '../auth/guards/access-token.guard.js';
import { RolesGuard } from '../auth/guards/roles.guard.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { UserRole } from '../database/entities/user.entity.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import type { AccessTokenClaims } from '../auth/types/auth.types.js';
import {
  createProductSchema,
  type CreateProductDto,
} from './dto/create-product.dto.js';

@Controller('products')
export class ProductsController {
  constructor(
    private readonly productCardService: ProductCardService,
    private readonly productsService: ProductsService,
  ) {}

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

  @Post()
  @UseGuards(AccessTokenGuard, RolesGuard)
  @Roles(UserRole.SELLER, UserRole.ADMIN)
  async create(
    @CurrentUser()
    user: AccessTokenClaims,
    @Body(new ZodValidationPipe(createProductSchema))
    body: CreateProductDto,
  ): Promise<{ id: string }> {
    return this.productsService.create({
      sellerId: user.sub,
      name: body.name,
      description: body.description,
      priceCents: body.price_cents,
      quantityAvailable: body.quantity_available,
      status: body.status,
      imageUrl: body.image_url,
    });
  }
}
