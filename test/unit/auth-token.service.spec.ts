import { generateKeyPairSync } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../src/config/env.schema.js';
import { UserRole } from '../../src/modules/database/entities/user.entity.js';
import { AuthTokenService } from '../../src/modules/auth/auth-token.service.js';

describe('AuthTokenService', () => {
  let service: AuthTokenService;

  beforeEach(async () => {
    const { privateKey, publicKey } = generateKeyPairSync('ec', {
      namedCurve: 'P-256',
      privateKeyEncoding: {
        type: 'pkcs8',
        format: 'pem',
      },
      publicKeyEncoding: {
        type: 'spki',
        format: 'pem',
      },
    });

    const env: Env = {
      NODE_ENV: 'test',
      PORT: 3000,
      DB_URL: 'postgres://app:app@localhost/shop',
      BROKER_URL: 'amqp://app:app@localhost',
      JWT_PRIVATE_KEY: Buffer.from(privateKey).toString('base64'),
      JWT_PUBLIC_KEY: Buffer.from(publicKey).toString('base64'),
      JWT_KID: 'test-key',
      REFRESH_TOKEN_PEPPER: 'test-pepper',
      LOG_LEVEL: 'error',
      TIMEOUT_MS: 5000,
      REDIS_URL: 'redis://localhost:6379',
      REDIS_QUEUE_URL: 'redis://localhost:6380',
    };

    service = new AuthTokenService(new ConfigService<Env, true>(env));

    await service.onModuleInit();
  });

  it('signs and verifies a valid access token', async () => {
    const token = await service.signAccess({
      userId: '42',
      role: UserRole.CUSTOMER,
    });

    const claims = await service.verifyAccess(token);

    expect(claims.sub).toBe('42');
    expect(claims.role).toBe(UserRole.CUSTOMER);
    expect(claims.jti).toBeTruthy();
    expect(claims.exp).toBeGreaterThan(claims.iat);
  });

  it('rejects a token with a modified payload', async () => {
    const token = await service.signAccess({
      userId: '42',
      role: UserRole.CUSTOMER,
    });

    const parts = token.split('.');
    const payload = JSON.parse(
      Buffer.from(parts[1], 'base64url').toString('utf8'),
    ) as Record<string, unknown>;

    payload.role = UserRole.ADMIN;
    parts[1] = Buffer.from(JSON.stringify(payload)).toString('base64url');

    const tamperedToken = parts.join('.');

    await expect(service.verifyAccess(tamperedToken)).rejects.toThrow();
  });
});
