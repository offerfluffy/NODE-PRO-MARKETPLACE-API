import { UserRole } from '../../../src/database/entities/user.entity';
import { CreateUserInput } from '../../../src/database/repositories/users.repository';

let userSequence = 0;

export function aUser(
  overrides: Partial<CreateUserInput> = {},
): CreateUserInput {
  userSequence += 1;

  return {
    email: `user-${userSequence}@example.com`,
    passwordHash: 'test-password-hash',
    fullName: `Test User ${userSequence}`,
    role: UserRole.CUSTOMER,
    balanceCents: 10_000,
    ...overrides,
  };
}