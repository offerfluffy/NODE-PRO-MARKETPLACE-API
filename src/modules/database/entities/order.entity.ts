import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  type Relation,
  UpdateDateColumn,
} from 'typeorm';
import { User } from './user.entity.js';
import { OrderItem } from './orderItem.entity.js';
import { OrderStatusEvent } from './orderStatusEvent.entity.js';

export enum OrderStatus {
  PENDING = 'pending',
  PAID = 'paid',
  CANCELLED = 'cancelled',
  COMPLETED = 'completed',
}

@Entity('orders')
@Check(
  'CHK_orders_status',
  `"status" IN ('pending', 'paid', 'cancelled', 'completed')`,
)
@Check('CHK_orders_total_amount_cents_positive', `"total_amount_cents" > 0`)
@Index(
  'UQ_orders_customer_id_idempotency_key',
  ['customer', 'idempotencyKey'],
  { unique: true },
)
@Index('idx_orders_pending_created_at', {
  synchronize: false,
})
export class Order {
  @PrimaryGeneratedColumn('identity', {
    type: 'bigint',
    generatedIdentity: 'ALWAYS',
  })
  id!: string;

  @ManyToOne(() => User, (user) => user.orders, {
    nullable: false,
    onDelete: 'RESTRICT',
  })
  @JoinColumn({ name: 'customer_id' })
  customer!: Relation<User>;

  @OneToMany(() => OrderItem, (item) => item.order)
  items!: Relation<OrderItem[]>;

  @OneToMany(() => OrderStatusEvent, (event) => event.order)
  statusEvents!: Relation<OrderStatusEvent[]>;

  @Column({ type: 'text' })
  status!: OrderStatus;

  @Column({
    name: 'total_amount_cents',
    type: 'integer',
  })
  totalAmountCents!: number;

  @Column({
    name: 'idempotency_key',
    type: 'text',
  })
  idempotencyKey!: string;

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
