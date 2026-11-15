import { Injectable, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { importPKCS8, importSPKI, SignJWT } from 'jose';
import type { SignAccessInput } from './auth.types.js';
import type { Env } from '../../config/env.schema.js';

const JWT_ALGORITHM = 'ES256';
const JWT_ISSUER = 'marketplace-api';
const JWT_AUDIENCE = 'marketplace-web';
const ACCESS_TOKEN_TTL = '10m';

@Injectable()
export class AuthTokenService implements OnModuleInit {
  private privateKey!: CryptoKey;
  private publicKey!: CryptoKey;
  private kid!: string;

  constructor(private readonly config: ConfigService<Env, true>) {}

  async onModuleInit(): Promise<void> {
    const privateKeyBase64 = this.config.get('JWT_PRIVATE_KEY', {
      infer: true,
    });
    const publicKeyBase64 = this.config.get('JWT_PUBLIC_KEY', {
      infer: true,
    });

    this.kid = this.config.get('JWT_KID', { infer: true });

    const privateKeyPem = decodePem(privateKeyBase64);
    const publicKeyPem = decodePem(publicKeyBase64);

    this.privateKey = await importPKCS8(privateKeyPem, JWT_ALGORITHM);
    this.publicKey = await importSPKI(publicKeyPem, JWT_ALGORITHM);
  }

  async signAccess(input: SignAccessInput): Promise<string> {
    return new SignJWT({
      role: input.role,
    })
      .setProtectedHeader({
        alg: JWT_ALGORITHM,
        kid: this.kid,
        typ: 'JWT',
      })
      .setSubject(input.userId)
      .setIssuer(JWT_ISSUER)
      .setAudience(JWT_AUDIENCE)
      .setJti(randomUUID())
      .setIssuedAt()
      .setExpirationTime(ACCESS_TOKEN_TTL)
      .sign(this.privateKey);
  }
}

function decodePem(base64: string): string {
  return Buffer.from(base64, 'base64').toString('utf8');
}
