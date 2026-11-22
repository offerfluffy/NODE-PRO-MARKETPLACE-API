import { jest } from '@jest/globals';
import type { Redis } from 'ioredis';
import { UserRole } from '../../src/modules/database/entities/user.entity.js';
import { AccessDenylistService } from '../../src/modules/auth/services/access-denylist.service.js';
import type { AccessTokenClaims } from '../../src/modules/auth/types/auth.types.js';

describe('AccessDenylistService', () => {
  const claims: AccessTokenClaims = {
    sub: '42',
    role: UserRole.CUSTOMER,
    jti: 'access-jti',
    iss: 'marketplace-api',
    aud: 'marketplace-web',
    iat: 900,
    exp: 1_060,
  };

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('stores the jti only for the remaining access-token lifetime', async () => {
    jest.spyOn(Date, 'now').mockReturnValue(1_000_000);

    const set = jest
      .fn<(...args: unknown[]) => Promise<'OK'>>()
      .mockResolvedValue('OK');
    const service = new AccessDenylistService({ set } as unknown as Redis);

    await service.revoke(claims);

    expect(set).toHaveBeenCalledWith(
      'auth:deny:marketplace-api:access-jti',
      '1',
      'EX',
      60,
    );
  });

  it('recognizes revoked tokens and skips already expired tokens', async () => {
    jest.spyOn(Date, 'now').mockReturnValue(1_100_000);

    const set = jest
      .fn<(...args: unknown[]) => Promise<'OK'>>()
      .mockResolvedValue('OK');
    const exists = jest
      .fn<(key: string) => Promise<number>>()
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(0);
    const service = new AccessDenylistService({
      set,
      exists,
    } as unknown as Redis);

    await expect(service.isRevoked(claims)).resolves.toBe(true);
    await expect(service.isRevoked(claims)).resolves.toBe(false);
    await service.revoke(claims);

    expect(set).not.toHaveBeenCalled();
  });
});
