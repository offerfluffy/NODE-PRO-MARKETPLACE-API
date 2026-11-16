import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Res,
  Headers,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Response } from 'express';
import type { Env } from '../../config/env.schema.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { AuthService, type TokenPairResult } from './services/auth.service.js';
import { loginSchema, type LoginDto } from './dto/login.dto.js';
import { readCookie } from './utils/cookie.js';
import { AccessTokenGuard } from './guards/access-token.guard.js';
import { CurrentUser } from './decorators/current-user.decorator.js';
import type { AccessTokenClaims } from './types/auth.types.js';

export const REFRESH_COOKIE_NAME = 'refresh_token';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(
    @Body(new ZodValidationPipe(loginSchema))
    body: LoginDto,
    @Res({ passthrough: true })
    response: Response,
  ): Promise<{ accessToken: string }> {
    const result = await this.auth.login(body);

    this.setRefreshCookie(response, result);

    return {
      accessToken: result.accessToken,
    };
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(
    @Headers('cookie')
    cookieHeader: string | undefined,
    @Res({ passthrough: true })
    response: Response,
  ): Promise<{ accessToken: string }> {
    const rawRefreshToken = readCookie(cookieHeader, REFRESH_COOKIE_NAME);

    if (!rawRefreshToken) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    const result = await this.auth.refresh(rawRefreshToken);

    this.setRefreshCookie(response, result);

    return {
      accessToken: result.accessToken,
    };
  }

  @Post('logout')
  @UseGuards(AccessTokenGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(
    @CurrentUser()
    claims: AccessTokenClaims,
    @Headers('cookie')
    cookieHeader: string | undefined,
    @Res({ passthrough: true })
    response: Response,
  ): Promise<void> {
    const rawRefreshToken = readCookie(cookieHeader, REFRESH_COOKIE_NAME);

    await this.auth.logout(claims, rawRefreshToken);

    response.clearCookie(REFRESH_COOKIE_NAME, {
      httpOnly: true,
      sameSite: 'strict',
      secure:
        this.config.get('NODE_ENV', {
          infer: true,
        }) === 'production',
      path: '/auth',
    });
  }

  private setRefreshCookie(response: Response, result: TokenPairResult): void {
    response.cookie(REFRESH_COOKIE_NAME, result.refreshToken, {
      httpOnly: true,
      sameSite: 'strict',
      secure:
        this.config.get('NODE_ENV', {
          infer: true,
        }) === 'production',
      path: '/auth',
      expires: result.refreshExpiresAt,
    });
  }
}
