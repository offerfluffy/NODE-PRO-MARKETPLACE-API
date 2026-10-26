import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  OneToOne,
  PrimaryGeneratedColumn,
  type Relation,
  UpdateDateColumn,
} from 'typeorm';
import { User } from './user.entity.js';
import { Inventory } from './inventory.entity.js';
import { OrderItem } from './orderItem.entity.js';

export enum ProductStatus {
  DRAFT = 'draft',
  ACTIVE = 'active',
  ARCHIVED = 'archived',
}

@Entity('products')
@Check('CHK_products_status', `"status" IN ('draft', 'active', 'archived')`)
@Check('CHK_products_price_cents_positive', `"price_cents" > 0`)
@Index('idx_products_seller_created_at', { synchronize: false })
@Index('idx_products_search_vector', { synchronize: false })
export class Product {
  @PrimaryGeneratedColumn('identity', {
    type: 'bigint',
    generatedIdentity: 'ALWAYS',
  })
  id!: string;

  @ManyToOne(() => User, (user) => user.products, {
    nullable: false,
    onDelete: 'RESTRICT',
  })
  @JoinColumn({ name: 'seller_id' })
  seller!: Relation<User>;

  @OneToOne(() => Inventory, (inventory) => inventory.product)
  inventory!: Relation<Inventory>;

  @OneToMany(() => OrderItem, (item) => item.product)
  orderItems!: Relation<OrderItem[]>;

  @Column({ type: 'text' })
  name!: string;

  @Column({ type: 'text' })
  description!: string;

  @Column({
    name: 'price_cents',
    type: 'integer',
  })
  priceCents!: number;

  @Column({ type: 'text' })
  status!: ProductStatus;

  @Column({
    name: 'image_url',
    type: 'text',
    nullable: true,
  })
  imageUrl!: string | null;

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

  @Column({
    name: 'search_vector',
    type: 'tsvector',
    asExpression: `to_tsvector('simple', "name" || ' ' || "description")`,
    generatedType: 'STORED',
  })
  searchVector!: string;
}
