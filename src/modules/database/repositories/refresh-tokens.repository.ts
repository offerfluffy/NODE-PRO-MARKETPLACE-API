import { DataSource, Repository } from 'typeorm';
import { RefreshToken } from '../entities/refreshToken.entity.js';
import { UserRole } from '../entities/user.entity.js';

export type CreateRefreshTokenInput = {
  userId: string;
  tokenHash: string;
  familyId: string;
  expiresAt: Date;
};

export type NextRefreshToken = {
  token: string;
  tokenHash: string;
  expiresAt: Date;
};

export type RefreshRotationResult =
  | {
      status: 'rotated';
      userId: string;
      role: UserRole;
      familyId: string;
      next: NextRefreshToken;
    }
  | {
      status: 'reuse';
      familyId: string;
    }
  | {
      status: 'invalid';
    };

export class RefreshTokensRepository {
  private readonly tokens: Repository<RefreshToken>;

  constructor(private readonly dataSource: DataSource) {
    this.tokens = dataSource.getRepository(RefreshToken);
  }

  async create(input: CreateRefreshTokenInput): Promise<RefreshToken> {
    const token = this.tokens.create({
      user: {
        id: input.userId,
      },
      tokenHash: input.tokenHash,
      familyId: input.familyId,
      usedAt: null,
      revokedAt: null,
      expiresAt: input.expiresAt,
    });

    return this.tokens.save(token);
  }

  async rotate(
    tokenHash: string,
    createNext: (familyId: string) => NextRefreshToken,
  ): Promise<RefreshRotationResult> {
    return this.dataSource.transaction(async (manager) => {
      const tokens = manager.getRepository(RefreshToken);

      const current = await tokens
        .createQueryBuilder('refresh')
        .innerJoinAndSelect('refresh.user', 'user')
        .where('refresh.tokenHash = :tokenHash', { tokenHash })
        .setLock('pessimistic_write', undefined, ['refresh'])
        .getOne();

      if (!current || current.revokedAt) {
        return { status: 'invalid' };
      }

      if (current.usedAt) {
        await tokens
          .createQueryBuilder()
          .update(RefreshToken)
          .set({
            revokedAt: new Date(),
          })
          .where('family_id = :familyId', {
            familyId: current.familyId,
          })
          .andWhere('revoked_at IS NULL')
          .execute();

        return {
          status: 'reuse',
          familyId: current.familyId,
        };
      }

      if (current.expiresAt.getTime() <= Date.now()) {
        return { status: 'invalid' };
      }

      current.usedAt = new Date();
      await tokens.save(current);

      const next = createNext(current.familyId);

      await tokens.save(
        tokens.create({
          user: {
            id: current.user.id,
          },
          tokenHash: next.tokenHash,
          familyId: current.familyId,
          usedAt: null,
          revokedAt: null,
          expiresAt: next.expiresAt,
        }),
      );

      return {
        status: 'rotated',
        userId: current.user.id,
        role: current.user.role,
        familyId: current.familyId,
        next,
      };
    });
  }

  async revokeFamilyByTokenHash(
    tokenHash: string,
    userId: string,
  ): Promise<boolean> {
    return this.dataSource.transaction(async (manager) => {
      const tokens = manager.getRepository(RefreshToken);

      const current = await tokens
        .createQueryBuilder('refresh')
        .innerJoin('refresh.user', 'user')
        .where('refresh.tokenHash = :tokenHash', { tokenHash })
        .andWhere('user.id = :userId', { userId })
        .setLock('pessimistic_write', undefined, ['refresh'])
        .getOne();

      if (!current) {
        return false;
      }

      await tokens
        .createQueryBuilder()
        .update(RefreshToken)
        .set({ revokedAt: new Date() })
        .where('family_id = :familyId', {
          familyId: current.familyId,
        })
        .andWhere('revoked_at IS NULL')
        .execute();

      return true;
    });
  }
}
