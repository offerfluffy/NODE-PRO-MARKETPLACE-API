import {
  BadRequestException,
  ConflictException,
  type HttpException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  CheckoutTotalOutOfRangeError,
  CustomerUnavailableError,
  IdempotencyConflictError,
  InsufficientFundsError,
  InsufficientStockError,
  InvalidCheckoutError,
  ProductUnavailableError,
} from './checkout.errors.js';

export function toCheckoutHttpException(error: unknown): HttpException {
  if (error instanceof InvalidCheckoutError) {
    return new BadRequestException(error.message);
  }

  if (
    error instanceof ProductUnavailableError ||
    error instanceof CustomerUnavailableError
  ) {
    return new NotFoundException(error.message);
  }

  if (
    error instanceof InsufficientStockError ||
    error instanceof IdempotencyConflictError
  ) {
    return new ConflictException(error.message);
  }

  if (
    error instanceof InsufficientFundsError ||
    error instanceof CheckoutTotalOutOfRangeError
  ) {
    return new UnprocessableEntityException(error.message);
  }

  throw error;
}
