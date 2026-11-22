import {
  ExecutionContext,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { jest } from '@jest/globals';
import { UserRole } from '../../src/modules/database/entities/user.entity.js';
import { RolesGuard } from '../../src/modules/auth/guards/roles.guard.js';
import type { AccessTokenClaims } from '../../src/modules/auth/types/auth.types.js';

describe('RolesGuard', () => {
  const claims: AccessTokenClaims = {
    sub: '42',
    role: UserRole.CUSTOMER,
    jti: 'access-jti',
    iss: 'marketplace-api',
    aud: 'marketplace-web',
    iat: 1_000,
    exp: 2_000,
  };

  it('allows handlers without role metadata', () => {
    const { guard, reflector } = createGuard();
    reflector.mockReturnValue(undefined);

    expect(guard.canActivate(createContext(claims))).toBe(true);
  });

  it('allows a role listed by the handler', () => {
    const { guard, reflector } = createGuard();
    reflector.mockReturnValue([UserRole.CUSTOMER, UserRole.ADMIN]);

    expect(guard.canActivate(createContext(claims))).toBe(true);
  });

  it('returns 403 for an authenticated but disallowed role', () => {
    const { guard, reflector } = createGuard();
    reflector.mockReturnValue([UserRole.SELLER, UserRole.ADMIN]);

    expect(() => guard.canActivate(createContext(claims))).toThrow(
      ForbiddenException,
    );
  });

  it('returns 401 when authentication context is missing', () => {
    const { guard, reflector } = createGuard();
    reflector.mockReturnValue([UserRole.SELLER]);

    expect(() => guard.canActivate(createContext())).toThrow(
      UnauthorizedException,
    );
  });
});

function createGuard(): {
  guard: RolesGuard;
  reflector: jest.Mock<() => UserRole[] | undefined>;
} {
  const getAllAndOverride = jest.fn<() => UserRole[] | undefined>();
  const guard = new RolesGuard({
    getAllAndOverride,
  } as unknown as Reflector);

  return {
    guard,
    reflector: getAllAndOverride,
  };
}

function createContext(claims?: AccessTokenClaims): ExecutionContext {
  const request = {
    auth: claims,
  };

  return {
    getHandler: () => function handler() {},
    getClass: () => class TestController {},
    switchToHttp: () => ({
      getRequest: () => request,
    }),
  } as unknown as ExecutionContext;
}
