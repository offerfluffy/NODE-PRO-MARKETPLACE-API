import { Test } from '@nestjs/testing';
import { UserRole } from '../../src/modules/database/entities/user.entity.js';
import { UsersRepository } from '../../src/modules/database/repositories/users.repository.js';
import { RefreshTokensRepository } from '../../src/modules/database/repositories/refresh-tokens.repository.js';
import { AuthTokenService } from '../../src/modules/auth/auth-token.service.js';
import { RefreshTokenService } from '../../src/modules/auth/refresh-token.service.js';
import { AuthService } from '../../src/modules/auth/auth.service.js';
import { hashPassword } from '../../src/modules/auth/password.js';

describe('AuthService', () => {
  it('returns raw refresh but persists only its hash', async () => {
    const passwordHash = await hashPassword('correct-password');

    const expiresAt = new Date('2030-01-01T00:00:00.000Z');

    const users = {
      findByEmail: jest.fn().mockResolvedValue({
        id: '42',
        email: 'user@example.com',
        passwordHash,
        role: UserRole.CUSTOMER,
      }),
    };

    const refreshTokens = {
      create: jest.fn().mockResolvedValue(undefined),
    };

    const accessTokens = {
      signAccess: jest.fn().mockResolvedValue('signed-access-token'),
    };

    const refreshTokenService = {
      generate: jest.fn().mockReturnValue({
        token: 'raw-refresh-token',
        tokenHash: 'stored-refresh-hash',
        familyId: 'family-123',
        expiresAt,
      }),
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
  });
});
