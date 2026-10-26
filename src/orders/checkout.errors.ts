export abstract class CheckoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class InvalidCheckoutError extends CheckoutError {}

export class ProductUnavailableError extends CheckoutError {}

export class CustomerUnavailableError extends CheckoutError {}

export class InsufficientStockError extends CheckoutError {}

export class InsufficientFundsError extends CheckoutError {}

export class IdempotencyConflictError extends CheckoutError {}

export class CheckoutTotalOutOfRangeError extends CheckoutError {}