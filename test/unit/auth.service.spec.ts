import { Test } from '@nestjs/testing';
import { UnauthorizedException } from '@nestjs/common';
import { jest } from '@jest/globals';
import {
  User,
  UserRole,
} from '../../src/modules/database/entities/user.entity.js';
import { RefreshToken } from '../../src/modules/database/entities/refreshToken.entity.js';
import { UsersRepository } from '../../src/modules/database/repositories/users.repository.js';
import { RefreshTokensRepository } from '../../src/modules/database/repositories/refresh-tokens.repository.js';
import { AuthTokenService } from '../../src/modules/auth/services/auth-token.service.js';
import { RefreshTokenService } from '../../src/modules/auth/services/refresh-token.service.js';
import { AuthService } from '../../src/modules/auth/services/auth.service.js';
import { AccessDenylistService } from '../../src/modules/auth/services/access-denylist.service.js';
import { hashPassword } from '../../src/modules/auth/utils/password.js';
import type { AccessTokenClaims } from '../../src/modules/auth/types/auth.types.js';

describe('AuthService', () => {
  it('returns raw refresh but persists only its hash', async () => {
    const passwordHash = await hashPassword('correct-password');

    const expiresAt = new Date('2030-01-01T00:00:00.000Z');
    const user = Object.assign(new User(), {
      id: '42',
      email: 'user@example.com',
      passwordHash,
      role: UserRole.CUSTOMER,
    });

    const users = {
      findByEmail: jest
        .fn<UsersRepository['findByEmail']>()
        .mockResolvedValue(user),
    };

    const refreshTokens = {
      create: jest
        .fn<RefreshTokensRepository['create']>()
        .mockResolvedValue(new RefreshToken()),
    };

    const accessTokens = {
      signAccess: jest
        .fn<AuthTokenService['signAccess']>()
        .mockResolvedValue('signed-access-token'),
    };

    const refreshTokenService = {
      generate: jest.fn<RefreshTokenService['generate']>().mockReturnValue({
        token: 'raw-refresh-token',
        tokenHash: 'stored-refresh-hash',
        familyId: 'family-123',
        expiresAt,
      }),
    };

    const accessDenylist = {
      revoke: jest
        .fn<AccessDenylistService['revoke']>()
        .mockResolvedValue(undefined),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        AuthService,
        {
          provide: UsersRepository,
          useValue: users,
        },
        {
          provide: RefreshTokensRepository,
          useValue: refreshTokens,
        },
        {
          provide: AuthTokenService,
          useValue: accessTokens,
        },
        {
          provide: RefreshTokenService,
          useValue: refreshTokenService,
        },
        {
          provide: AccessDenylistService,
          useValue: accessDenylist,
        },
      ],
    }).compile();

    const service = moduleRef.get(AuthService);

    const result = await service.login({
      email: 'user@example.com',
      password: 'correct-password',
    });

    expect(result).toEqual({
      accessToken: 'signed-access-token',
      refreshToken: 'raw-refresh-token',
      refreshExpiresAt: expiresAt,
    });

    expect(refreshTokens.create).toHaveBeenCalledWith({
      userId: '42',
      tokenHash: 'stored-refresh-hash',
      familyId: 'family-123',
      expiresAt,
    });

    const persistedInput = refreshTokens.create.mock.calls[0][0];

    expect(persistedInput).not.toHaveProperty('token');

    await expect(
      service.login({
        email: 'user@example.com',
        password: 'wrong-password',
      }),
    ).rejects.toBeInstanceOf(UnauthorizedException);

    users.findByEmail.mockResolvedValueOnce(null);

    await expect(
      service.login({
        email: 'missing@example.com',
        password: 'any-password',
      }),
    ).rejects.toBeInstanceOf(UnauthorizedException);

    expect(accessTokens.signAccess).toHaveBeenCalledTimes(1);
    expect(refreshTokens.create).toHaveBeenCalledTimes(1);
  });

  it('revokes both refresh family and access token on logout', async () => {
    const refreshTokens = {
      revokeFamilyByTokenHash: jest
        .fn<RefreshTokensRepository['revokeFamilyByTokenHash']>()
        .mockResolvedValue(true),
    };

    const refreshTokenService = {
      hash: jest
        .fn<RefreshTokenService['hash']>()
        .mockReturnValue('hashed-refresh-token'),
    };

    const accessDenylist = {
      revoke: jest
        .fn<AccessDenylistService['revoke']>()
        .mockResolvedValue(undefined),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        AuthService,
        {
          provide: UsersRepository,
          useValue: {},
        },
        {
          provide: RefreshTokensRepository,
          useValue: refreshTokens,
        },
        {
          provide: AuthTokenService,
          useValue: {},
        },
        {
          provide: RefreshTokenService,
          useValue: refreshTokenService,
        },
        {
          provide: AccessDenylistService,
          useValue: accessDenylist,
        },
      ],
    }).compile();

    const service = moduleRef.get(AuthService);
    const claims: AccessTokenClaims = {
      sub: '42',
      role: UserRole.CUSTOMER,
      jti: 'access-jti',
      iss: 'marketplace-api',
      aud: 'marketplace-web',
      iat: 1_000,
      exp: 2_000,
    };

    await service.logout(claims, 'raw-refresh-token');

    expect(refreshTokenService.hash).toHaveBeenCalledWith('raw-refresh-token');
    expect(refreshTokens.revokeFamilyByTokenHash).toHaveBeenCalledWith(
      'hashed-refresh-token',
      '42',
    );
    expect(accessDenylist.revoke).toHaveBeenCalledWith(claims);
  });
});
