import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  type Relation,
} from 'typeorm';
import { Order, type OrderStatus } from './order.entity.js';

@Entity('order_status_events')
@Check(
  'CHK_order_status_events_status',
  `"status" IN ('pending', 'paid', 'cancelled', 'completed')`,
)
@Index('idx_order_status_events_order_id_id', ['order', 'id'])
export class OrderStatusEvent {
  @PrimaryGeneratedColumn('identity', {
    type: 'bigint',
    generatedIdentity: 'ALWAYS',
  })
  id!: string;

  @ManyToOne(() => Order, (order) => order.statusEvents, {
    nullable: false,
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'order_id' })
  order!: Relation<Order>;

  @Column({ type: 'text' })
  status!: OrderStatus;

  @CreateDateColumn({
    name: 'created_at',
    type: 'timestamptz',
    default: () => 'CURRENT_TIMESTAMP',
  })
  createdAt!: Date;
}
