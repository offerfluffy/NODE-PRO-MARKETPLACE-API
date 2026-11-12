import {
  type CanActivate,
  type ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { RateLimitService } from './rate-limit.service.js';
import type { Request, Response } from 'express';

@Injectable()
export class ProductRateLimitGuard implements CanActivate {
  constructor(private readonly rateLimitService: RateLimitService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const http = context.switchToHttp();
    const request = http.getRequest<Request>();
    const response = http.getResponse<Response>();

    const clientId = request.ip ?? request.socket.remoteAddress ?? 'unknown';

    const decision = await this.rateLimitService.consume(clientId);

    if (decision.allowed) {
      return true;
    }

    response.setHeader('Retry-After', String(decision.retryAfterSeconds));

    throw new HttpException('Too many requests', HttpStatus.TOO_MANY_REQUESTS);
  }
}
