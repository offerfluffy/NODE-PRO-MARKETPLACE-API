import { ConfigService } from '@nestjs/config';
import type { Env } from '../../src/config/env.schema.js';
import { RefreshToken } from '../../src/modules/database/entities/refreshToken.entity.js';
import { UsersRepository } from '../../src/modules/database/repositories/users.repository.js';
import { RefreshTokensRepository } from '../../src/modules/database/repositories/refresh-tokens.repository.js';
import { RefreshTokenService } from '../../src/modules/auth/refresh-token.service.js';
import {
  startTestDatabase,
  stopTestDatabase,
  type TestDatabase,
} from './testkit/postgres.js';
import { aUser } from './testkit/builders.js';

describe('RefreshTokensRepository', () => {
  let context: TestDatabase;

  beforeAll(async () => {
    context = await startTestDatabase();
  });

  afterAll(async () => {
    if (context) {
      await stopTestDatabase(context);
    }
  });

  it('rotates R1 and revokes the family when R1 is reused', async () => {
    const users = new UsersRepository(context.dataSource);

    const tokens = new RefreshTokensRepository(context.dataSource);

    const tokenService = new RefreshTokenService(
      new ConfigService<Env, true>({
        REFRESH_TOKEN_PEPPER: 'integration-pepper',
      } as Env),
    );

    const user = await users.create(aUser());
    const r1 = tokenService.generate();

    await tokens.create({
      userId: user.id,
      tokenHash: r1.tokenHash,
      familyId: r1.familyId,
      expiresAt: r1.expiresAt,
    });

    const firstRotation = await tokens.rotate(
      tokenService.hash(r1.token),
      (familyId) => tokenService.generate(familyId),
    );

    expect(firstRotation.status).toBe('rotated');

    if (firstRotation.status !== 'rotated') {
      throw new Error('R1 did not rotate');
    }

    expect(firstRotation.familyId).toBe(r1.familyId);

    const afterRotation = await context.dataSource
      .getRepository(RefreshToken)
      .find({
        where: {
          familyId: r1.familyId,
        },
      });

    expect(afterRotation).toHaveLength(2);

    const storedR1 = afterRotation.find(
      (token) => token.tokenHash === r1.tokenHash,
    );

    const storedR2 = afterRotation.find(
      (token) => token.tokenHash === firstRotation.next.tokenHash,
    );

    expect(storedR1?.usedAt).not.toBeNull();
    expect(storedR2?.usedAt).toBeNull();

    const reuse = await tokens.rotate(tokenService.hash(r1.token), (familyId) =>
      tokenService.generate(familyId),
    );

    expect(reuse.status).toBe('reuse');

    const afterReuse = await context.dataSource
      .getRepository(RefreshToken)
      .find({
        where: {
          familyId: r1.familyId,
        },
      });

    expect(afterReuse.every((token) => token.revokedAt !== null)).toBe(true);

    const r2AfterReuse = await tokens.rotate(
      tokenService.hash(firstRotation.next.token),
      (familyId) => tokenService.generate(familyId),
    );

    expect(r2AfterReuse.status).toBe('invalid');
  });
});
