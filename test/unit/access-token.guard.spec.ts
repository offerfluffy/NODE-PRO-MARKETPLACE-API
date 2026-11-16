import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { jest } from '@jest/globals';
import { UserRole } from '../../src/modules/database/entities/user.entity.js';
import { AccessTokenGuard } from '../../src/modules/auth/guards/access-token.guard.js';
import { AuthTokenService } from '../../src/modules/auth/services/auth-token.service.js';
import { AccessDenylistService } from '../../src/modules/auth/services/access-denylist.service.js';
import type { AuthenticatedRequest } from '../../src/modules/auth/types/auth-request.js';
import type { AccessTokenClaims } from '../../src/modules/auth/types/auth.types.js';

describe('AccessTokenGuard', () => {
  const claims: AccessTokenClaims = {
    sub: '42',
    role: UserRole.CUSTOMER,
    jti: 'token-id',
    iss: 'marketplace-api',
    aud: 'marketplace-web',
    iat: 100,
    exp: 200,
  };

  const tokens = {
    verifyAccess: jest.fn<AuthTokenService['verifyAccess']>(),
  };
  const denylist = {
    isRevoked: jest.fn<AccessDenylistService['isRevoked']>(),
  };

  let guard: AccessTokenGuard;

  beforeEach(async () => {
    tokens.verifyAccess.mockReset();
    denylist.isRevoked.mockReset().mockResolvedValue(false);

    const moduleRef = await Test.createTestingModule({
      providers: [
        AccessTokenGuard,
        {
          provide: AuthTokenService,
          useValue: tokens,
        },
        {
          provide: AccessDenylistService,
          useValue: denylist,
        },
      ],
    }).compile();

    guard = moduleRef.get(AccessTokenGuard);
  });

  it('rejects a request without Bearer token', async () => {
    const { context } = createContext();

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );

    expect(tokens.verifyAccess).not.toHaveBeenCalled();
    expect(denylist.isRevoked).not.toHaveBeenCalled();
  });

  it('rejects an invalid token', async () => {
    tokens.verifyAccess.mockRejectedValueOnce(new Error('invalid signature'));

    const { context } = createContext('Bearer broken-token');

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );

    expect(denylist.isRevoked).not.toHaveBeenCalled();
  });

  it('rejects a revoked access token', async () => {
    tokens.verifyAccess.mockResolvedValueOnce(claims);
    denylist.isRevoked.mockResolvedValueOnce(true);

    const { context, request } = createContext('Bearer revoked-token');

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );

    expect(request.auth).toBeUndefined();
  });

  it('stores verified claims on the request', async () => {
    tokens.verifyAccess.mockResolvedValueOnce(claims);

    const { context, request } = createContext('Bearer valid-token');

    await expect(guard.canActivate(context)).resolves.toBe(true);

    expect(denylist.isRevoked).toHaveBeenCalledWith(claims);
    expect(request.auth).toEqual(claims);
  });
});

function createContext(authorization?: string): {
  context: ExecutionContext;
  request: AuthenticatedRequest;
} {
  const request = {
    headers: {
      authorization,
    },
  } as AuthenticatedRequest;

  const context = {
    switchToHttp: () => ({
      getRequest: () => request,
    }),
  } as ExecutionContext;

  return { context, request };
}
