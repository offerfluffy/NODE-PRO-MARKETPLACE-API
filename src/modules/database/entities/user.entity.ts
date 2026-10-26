import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  OneToMany,
  PrimaryGeneratedColumn,
  type Relation,
  UpdateDateColumn,
} from 'typeorm';
import { Order } from './order.entity.js';
import { Product } from './product.entity.js';

export const enum UserRole {
  CUSTOMER = 'customer',
  SELLER = 'seller',
  ADMIN = 'admin',
}

@Entity('users')
@Check('CHK_users_role', `"role" IN ('customer', 'seller', 'admin')`)
@Check('CHK_balance_cents_positive_or_zero', `"balance_cents" >= 0`)
@Index('idx_users_email_lower', { synchronize: false })
export class User {
  @PrimaryGeneratedColumn('identity', {
    type: 'bigint',
    generatedIdentity: 'ALWAYS',
  })
  id!: string;

  @OneToMany(() => Product, (product) => product.seller)
  products!: Relation<Product[]>;

  @OneToMany(() => Order, (order) => order.customer)
  orders!: Relation<Order[]>;

  @Column({ type: 'text' })
  email!: string;

  @Column({ name: 'password_hash', type: 'text' })
  passwordHash!: string;

  @Column({ name: 'full_name', type: 'text' })
  fullName!: string;

  @Column({ type: 'text' })
  role!: UserRole;

  @Column({ type: 'integer', name: 'balance_cents', default: '0' })
  balanceCents: number;

  @CreateDateColumn({
    name: 'created_at',
    type: 'timestamptz',
    default: () => 'CURRENT_TIMESTAMP',
  })
  createdAt!: Date;

  @UpdateDateColumn({
    name: 'updated_at',
    type: 'timestamptz',
    default: () => 'CURRENT_TIMESTAMP',
  })
  updatedAt!: Date;
}
