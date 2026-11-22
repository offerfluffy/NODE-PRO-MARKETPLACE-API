import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from '../decorators/roles.decorator.js';
import type { AuthenticatedRequest } from '../types/auth-request.js';
import type { UserRole } from '../../database/entities/user.entity.js';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const allowedRoles = this.reflector.getAllAndOverride<UserRole[]>(
      ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!allowedRoles) {
      return true;
    }

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();

    if (!request.auth) {
      throw new UnauthorizedException('Authentication context is missing');
    }

    if (!allowedRoles.includes(request.auth.role)) {
      throw new ForbiddenException('Your role cannot perform this action');
    }

    return true;
  }
}
