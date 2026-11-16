import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { AuthenticatedRequest } from './auth-request.js';
import { AuthTokenService } from './auth-token.service.js';

@Injectable()
export class AccessTokenGuard implements CanActivate {
  constructor(private readonly tokens: AuthTokenService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();

    const authorization = request.headers.authorization;

    const [scheme, token, extra] = authorization?.trim().split(/\s+/) ?? [];

    if (scheme?.toLowerCase() !== 'bearer' || !token || extra) {
      throw new UnauthorizedException('A valid Bearer token is required');
    }

    try {
      request.auth = await this.tokens.verifyAccess(token);

      return true;
    } catch {
      throw new UnauthorizedException('Invalid or expired access token');
    }
  }
}
