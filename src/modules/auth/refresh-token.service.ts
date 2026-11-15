import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../config/env.schema.js';

const REFRESH_TOKEN_BYTES = 32;

export const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1_000;

export type GeneratedRefreshToken = {
  token: string;
  tokenHash: string;
  familyId: string;
  expiresAt: Date;
};

@Injectable()
export class RefreshTokenService {
  private readonly pepper: string;

  constructor(config: ConfigService<Env, true>) {
    this.pepper = config.get('REFRESH_TOKEN_PEPPER', {
      infer: true,
    });
  }

  generate(familyId = randomUUID()): GeneratedRefreshToken {
    const token = randomBytes(REFRESH_TOKEN_BYTES).toString('base64url');

    return {
      token,
      tokenHash: this.hash(token),
      familyId,
      expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_MS),
    };
  }

  hash(token: string): string {
    return createHmac('sha256', this.pepper).update(token).digest('hex');
  }
}
