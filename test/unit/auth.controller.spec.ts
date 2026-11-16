import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { jest } from '@jest/globals';
import type { Response } from 'express';
import type { Env } from '../../src/config/env.schema.js';
import {
  AuthController,
  REFRESH_COOKIE_NAME,
} from '../../src/modules/auth/auth.controller.js';
import { AuthService } from '../../src/modules/auth/services/auth.service.js';
import { AccessTokenGuard } from '../../src/modules/auth/guards/access-token.guard.js';

describe('AuthController', () => {
  it('returns access in JSON and refresh in httpOnly cookie', async () => {
    const expiresAt = new Date('2030-01-01T00:00:00.000Z');

    const auth = {
      login: jest.fn<AuthService['login']>().mockResolvedValue({
        accessToken: 'signed-access-token',
        refreshToken: 'raw-refresh-token',
        refreshExpiresAt: expiresAt,
      }),
    };

    const config = new ConfigService<Env, true>({
      NODE_ENV: 'test',
    } as Env);

    const moduleRef = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        {
          provide: AuthService,
          useValue: auth,
        },
        {
          provide: ConfigService,
          useValue: config,
        },
      ],
    })
      .overrideGuard(AccessTokenGuard)
      .useValue({
        canActivate: () => true,
      })
      .compile();

    const controller = moduleRef.get(AuthController);

    const cookie = jest.fn();
    const response = {
      cookie,
    } as unknown as Response;

    const result = await controller.login(
      {
        email: 'user@example.com',
        password: 'correct-password',
      },
      response,
    );

    expect(result).toEqual({
      accessToken: 'signed-access-token',
    });

    expect(result).not.toHaveProperty('refreshToken');

    expect(cookie).toHaveBeenCalledWith(
      REFRESH_COOKIE_NAME,
      'raw-refresh-token',
      {
        httpOnly: true,
        sameSite: 'strict',
        secure: false,
        path: '/auth',
        expires: expiresAt,
      },
    );
  });
});
