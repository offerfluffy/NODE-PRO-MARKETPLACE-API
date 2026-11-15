import { EntityManager } from 'typeorm';
import { User, UserRole } from '../entities/user.entity.js';

type UserSeed = Pick<
  User,
  'email' | 'passwordHash' | 'fullName' | 'role' | 'balanceCents'
>;

const DEMO_PASSWORD_HASH =
  'scrypt$16384$8$1$vGS4AX/975kOh6P3Dbmyyg==$UXZftOZb6EjwSF+pbS/fSbAcQwgPllZan26gT12Afmg=';

export const USER_SEEDS: UserSeed[] = [
  {
    email: 'seller.one@example.com',
    passwordHash: DEMO_PASSWORD_HASH,
    fullName: 'Seller One',
    role: UserRole.SELLER,
    balanceCents: 0,
  },
  {
    email: 'seller.two@example.com',
    passwordHash: DEMO_PASSWORD_HASH,
    fullName: 'Seller Two',
    role: UserRole.SELLER,
    balanceCents: 0,
  },
  {
    email: 'customer.one@example.com',
    passwordHash: DEMO_PASSWORD_HASH,
    fullName: 'Customer One',
    role: UserRole.CUSTOMER,
    balanceCents: 1_000_000,
  },
  {
    email: 'customer.two@example.com',
    passwordHash: DEMO_PASSWORD_HASH,
    fullName: 'Customer Two',
    role: UserRole.CUSTOMER,
    balanceCents: 1_000_000,
  },
  {
    email: 'customer.three@example.com',
    passwordHash: DEMO_PASSWORD_HASH,
    fullName: 'Customer Three',
    role: UserRole.CUSTOMER,
    balanceCents: 1_000_000,
  },
  {
    email: 'customer.four@example.com',
    passwordHash: DEMO_PASSWORD_HASH,
    fullName: 'Customer Four',
    role: UserRole.CUSTOMER,
    balanceCents: 1_000_000,
  },
  {
    email: 'customer.five@example.com',
    passwordHash: DEMO_PASSWORD_HASH,
    fullName: 'Customer Five',
    role: UserRole.CUSTOMER,
    balanceCents: 1_000_000,
  },
  {
    email: 'admin@example.com',
    passwordHash: DEMO_PASSWORD_HASH,
    fullName: 'Admin User',
    role: UserRole.ADMIN,
    balanceCents: 0,
  },
];

export async function seedUsers(
  manager: EntityManager,
): Promise<Map<string, User>> {
  const repository = manager.getRepository(User);
  const usersByEmail = new Map<string, User>();

  for (const userData of USER_SEEDS) {
    let user = await repository.findOneBy({ email: userData.email });

    if (!user) {
      user = repository.create(userData);
    } else {
      repository.merge(user, userData);
    }

    user = await repository.save(user);

    usersByEmail.set(user.email, user);
  }

  return usersByEmail;
}
