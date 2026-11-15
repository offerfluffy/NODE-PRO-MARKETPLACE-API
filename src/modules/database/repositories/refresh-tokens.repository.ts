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
}
