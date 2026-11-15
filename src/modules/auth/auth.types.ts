import type { UserRole } from '../database/entities/user.entity.js';

export type SignAccessInput = {
  userId: string;
  role: UserRole;
};

export type AccessTokenClaims = {
  sub: string;
  role: UserRole;
  jti: string;
  iss: string;
  aud: string | string[];
  iat: number;
  exp: number;
};