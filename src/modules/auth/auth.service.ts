import { Injectable, UnauthorizedException } from '@nestjs/common';
import { UsersRepository } from '../database/repositories/users.repository.js';
import { RefreshTokensRepository } from '../database/repositories/refresh-tokens.repository.js';
import { verifyPassword } from './password.js';
import { AuthTokenService } from './auth-token.service.js';
import { RefreshTokenService } from './refresh-token.service.js';

const DUMMY_PASSWORD_HASH =
  'scrypt$16384$8$1$6Qegkh8QDR9b1cDXiSD/ww==$Bgp/1yXlpcIZynbb05Hu7M/GuVz6hJr4IKu7N5EqHAU=';

export type LoginInput = {
  email: string;
  password: string;
};

export type LoginResult = {
  accessToken: string;
  refreshToken: string;
  refreshExpiresAt: Date;
};

@Injectable()
export class AuthService {
  constructor(
    private readonly users: UsersRepository,
    private readonly refreshTokens: RefreshTokensRepository,
    private readonly accessTokens: AuthTokenService,
    private readonly refreshTokenService: RefreshTokenService,
  ) {}

  async login(input: LoginInput): Promise<LoginResult> {
    const user = await this.users.findByEmail(input.email);

    const passwordMatches = await verifyPassword(
      input.password,
      user?.passwordHash ?? DUMMY_PASSWORD_HASH,
    );

    if (!user || !passwordMatches) {
      throw new UnauthorizedException('Invalid email or password');
    }

    const accessToken = await this.accessTokens.signAccess({
      userId: user.id,
      role: user.role,
    });

    const refresh = this.refreshTokenService.generate();

    await this.refreshTokens.create({
      userId: user.id,
      tokenHash: refresh.tokenHash,
      familyId: refresh.familyId,
      expiresAt: refresh.expiresAt,
    });

    return {
      accessToken,
      refreshToken: refresh.token,
      refreshExpiresAt: refresh.expiresAt,
    };
  }
}
