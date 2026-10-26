import { DataSource, Repository } from 'typeorm';
import { User, UserRole } from '../entities/user.entity';

export type CreateUserInput = {
  email: string;
  passwordHash: string;
  fullName: string;
  role: UserRole;
  balanceCents?: number;
};

export class UsersRepository {
  private readonly users: Repository<User>;

  constructor(dataSource: DataSource) {
    this.users = dataSource.getRepository(User);
  }

  async create(input: CreateUserInput): Promise<User> {
    const user = this.users.create(input);

    return this.users.save(user);
  }

  async findByEmail(email: string): Promise<User | null> {
    return this.users
      .createQueryBuilder('user')
      .where('LOWER(user.email) = LOWER(:email)', { email })
      .getOne();
  }
}
