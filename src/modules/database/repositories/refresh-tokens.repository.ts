import {
  DataSource,
  Repository,
} from 'typeorm';
import { RefreshToken } from '../entities/refreshToken.entity.js';

export type CreateRefreshTokenInput = {
  userId: string;
  tokenHash: string;
  familyId: string;
  expiresAt: Date;
};

export class RefreshTokensRepository {
  private readonly tokens: Repository<RefreshToken>;

  constructor(dataSource: DataSource) {
    this.tokens = dataSource.getRepository(RefreshToken);
  }

  async create(
    input: CreateRefreshTokenInput,
  ): Promise<RefreshToken> {
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