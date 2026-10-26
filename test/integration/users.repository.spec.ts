import { User } from '../../src/database/entities/user.entity';
import { UsersRepository } from '../../src/database/repositories/users.repository';
import { aUser } from './testkit/builders';
import {
  startTestDatabase,
  stopTestDatabase,
  TestDatabase,
} from './testkit/postgres';

describe('UsersRepository integration', () => {
  let database: TestDatabase | undefined;
  let users: UsersRepository;

  beforeAll(async () => {
    database = await startTestDatabase();
    users = new UsersRepository(database.dataSource);
  });

  beforeEach(async () => {
    if (!database) {
      throw new Error('Test database was not initialized');
    }

    await database.dataSource.query('TRUNCATE users RESTART IDENTITY CASCADE');
  });

  afterAll(async () => {
    if (database) {
      await stopTestDatabase(database);
    }
  });

  it('persists a user in PostgreSQL', async () => {
    if (!database) {
      throw new Error('Test database was not initialized');
    }

    const input = aUser({ fullName: 'Ada Lovelace' });

    const created = await users.create(input);

    const persisted = await database.dataSource
      .getRepository(User)
      .findOneByOrFail({ id: created.id });

    expect(persisted).toMatchObject(input);
  });

  it('finds an email case-insensitively', async () => {
    await users.create(
      aUser({
        email: 'Ada.Lovelace@example.com',
      }),
    );

    const found = await users.findByEmail('ADA.LOVELACE@EXAMPLE.COM');

    expect(found?.email).toBe('Ada.Lovelace@example.com');
  });

  it('rejects duplicate emails through unique constraint 23505', async () => {
    await users.create(
      aUser({
        email: 'duplicate@example.com',
      }),
    );

    await expect(
      users.create(
        aUser({
          email: 'DUPLICATE@example.com',
        }),
      ),
    ).rejects.toHaveProperty('driverError.code', '23505');
  });
});
