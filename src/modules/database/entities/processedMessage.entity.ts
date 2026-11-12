import { CreateDateColumn, Entity, PrimaryColumn } from 'typeorm';

@Entity('processed_messages')
export class ProcessedMessage {
  @PrimaryColumn({
    name: 'message_id',
    type: 'text',
  })
  messageId!: string;

  @PrimaryColumn({
    type: 'text',
  })
  consumer!: string;

  @CreateDateColumn({
    name: 'processed_at',
    type: 'timestamptz',
    default: () => 'CURRENT_TIMESTAMP',
  })
  processedAt!: Date;
}
