import type { Request } from 'express';
import type { AccessTokenClaims } from './auth.types.js';

export interface AuthenticatedRequest extends Request {
  auth?: AccessTokenClaims;
}
