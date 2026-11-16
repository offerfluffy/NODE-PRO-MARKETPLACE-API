import type { Request } from 'express';
import type { AccessTokenClaims } from './auth.types.js';

export type AuthenticatedRequest = Request & {
  auth?: AccessTokenClaims;
};
