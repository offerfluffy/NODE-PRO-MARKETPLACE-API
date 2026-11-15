import {
  hashPassword,
  verifyPassword,
} from '../../src/modules/auth/password.js';

describe('password hashing', () => {
  it('accepts the correct password', async () => {
    const stored = await hashPassword('demo-password');

    await expect(verifyPassword('demo-password', stored)).resolves.toBe(true);

    expect(stored).not.toContain('demo-password');
  });

  it('rejects an incorrect password', async () => {
    const stored = await hashPassword('demo-password');

    await expect(verifyPassword('wrong-password', stored)).resolves.toBe(false);
  });
});
