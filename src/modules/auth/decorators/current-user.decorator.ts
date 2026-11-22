import {
  createParamDecorator,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import type { AccessTokenClaims } from '../types/auth.types.js';
import type { AuthenticatedRequest } from '../types/auth-request.js';

export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AccessTokenClaims => {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();

    if (!request.auth) {
      throw new UnauthorizedException('Authentication context is missing');
    }

    return request.auth;
  },
);
