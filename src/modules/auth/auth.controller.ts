import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Res,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Response } from 'express';
import type { Env } from '../../config/env.schema.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { AuthService } from './auth.service.js';
import { loginSchema, type LoginDto } from './dto/login.dto.js';

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

    return {
      accessToken: result.accessToken,
    };
  }
}
