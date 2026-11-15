import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
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

export type TokenPairResult = {
  accessToken: string;
  refreshToken: string;
  refreshExpiresAt: Date;
};

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly users: UsersRepository,
    private readonly refreshTokens: RefreshTokensRepository,
    private readonly accessTokens: AuthTokenService,
    private readonly refreshTokenService: RefreshTokenService,
  ) {}

  async login(input: LoginInput): Promise<TokenPairResult> {
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

  async refresh(rawRefreshToken: string): Promise<TokenPairResult> {
    const tokenHash = this.refreshTokenService.hash(rawRefreshToken);

    const result = await this.refreshTokens.rotate(tokenHash, (familyId) =>
      this.refreshTokenService.generate(familyId),
    );

    if (result.status === 'reuse') {
      this.logger.warn(
        `Refresh token reuse detected: familyId=${result.familyId}`,
      );

      throw new UnauthorizedException('Invalid refresh token');
    }

    if (result.status === 'invalid') {
      throw new UnauthorizedException('Invalid refresh token');
    }

    const accessToken = await this.accessTokens.signAccess({
      userId: result.userId,
      role: result.role,
    });

    return {
      accessToken,
      refreshToken: result.next.token,
      refreshExpiresAt: result.next.expiresAt,
    };
  }
}
