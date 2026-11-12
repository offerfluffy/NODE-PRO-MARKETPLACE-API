import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddTransactionalOutbox1794301681079 implements MigrationInterface {
  name = 'AddTransactionalOutbox1794301681079';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "outbox" ("id" bigint GENERATED ALWAYS AS IDENTITY NOT NULL, "aggregate_type" text NOT NULL, "aggregate_id" text NOT NULL, "type" text NOT NULL, "payload" jsonb NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "published_at" TIMESTAMP WITH TIME ZONE, "attempts" integer NOT NULL DEFAULT '0', CONSTRAINT "PK_340ab539f309f03bdaa14aa7649" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_outbox_unpublished_created_at_id" ON "outbox" ("created_at", "id") WHERE "published_at" IS NULL`,
    );
    await queryRunner.query(
      `CREATE TABLE "processed_messages" ("message_id" text NOT NULL, "consumer" text NOT NULL, "processed_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_d4853eee97acfc588e49f9290d1" PRIMARY KEY ("message_id", "consumer"))`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "processed_messages"`);
    await queryRunner.query(
      `DROP INDEX "public"."idx_outbox_unpublished_created_at_id"`,
    );
    await queryRunner.query(`DROP TABLE "outbox"`);
  }
}
