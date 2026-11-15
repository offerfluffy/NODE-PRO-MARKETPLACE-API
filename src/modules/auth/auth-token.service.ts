import { Injectable, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { importPKCS8, importSPKI } from 'jose';
import type { Env } from '../../config/env.schema.js';

const JWT_ALGORITHM = 'ES256';

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
}

function decodePem(base64: string): string {
  return Buffer.from(base64, 'base64').toString('utf8');
}