import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { AuthenticatedRequest } from './auth-request.js';
import { AuthTokenService } from './auth-token.service.js';
import { AccessDenylistService } from './access-denylist.service.js';

@Injectable()
export class AccessTokenGuard implements CanActivate {
  constructor(
    private readonly tokens: AuthTokenService,
    private readonly denylist: AccessDenylistService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();

    const authorization = request.headers.authorization;

    const [scheme, token, extra] = authorization?.trim().split(/\s+/) ?? [];

    if (scheme?.toLowerCase() !== 'bearer' || !token || extra) {
      throw new UnauthorizedException('A valid Bearer token is required');
    }

    try {
      const claims = await this.tokens.verifyAccess(token);

      const revoked = await this.denylist.isRevoked(claims);

      if (revoked) {
        throw new UnauthorizedException('Access token has been revoked');
      }

      request.auth = claims;

      return true;
    } catch {
      throw new UnauthorizedException(
        'Invalid, expired, or revoked access token',
      );
    }
  }
}
