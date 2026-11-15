import { ConfigService } from '@nestjs/config';
import type { Env } from '../../src/config/env.schema.js';
import { RefreshTokenService } from '../../src/modules/auth/refresh-token.service.js';

describe('RefreshTokenService', () => {
  it('generates an opaque token and stores only its hash', () => {
    const service = createService('pepper-one');
    const generated = service.generate();

    expect(generated.token).toHaveLength(43);
    expect(generated.tokenHash).toMatch(/^[a-f0-9]{64}$/);
    expect(generated.tokenHash).not.toBe(generated.token);

    expect(service.hash(generated.token)).toBe(generated.tokenHash);
  });

  it('produces a different hash with another pepper', () => {
    const token = 'the-same-refresh-token';

    const firstHash = createService('pepper-one').hash(token);

    const secondHash = createService('pepper-two').hash(token);

    expect(firstHash).not.toBe(secondHash);
  });
});

function createService(pepper: string): RefreshTokenService {
  const config = new ConfigService<Env, true>({
    REFRESH_TOKEN_PEPPER: pepper,
  } as Env);

  return new RefreshTokenService(config);
}
