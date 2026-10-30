import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddConcurrencySupport1791965248069 implements MigrationInterface {
  name = 'AddConcurrencySupport1791965248069';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "jobs" ("id" bigint GENERATED ALWAYS AS IDENTITY NOT NULL, "type" text NOT NULL, "payload" jsonb NOT NULL, "status" text NOT NULL DEFAULT 'pending', "processed" integer NOT NULL DEFAULT '0', "worker" text, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "CHK_jobs_processed_positive_or_zero" CHECK ("processed" >= 0), CONSTRAINT "CHK_jobs_status" CHECK ("status" IN ('pending', 'done')), CONSTRAINT "PK_cf0a6c42b72fcc7f7c237def345" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_jobs_status_id" ON "jobs" ("status", "id")`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" ADD "balance_cents" integer NOT NULL DEFAULT '0'`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" ADD CONSTRAINT "CHK_balance_cents_positive_or_zero" CHECK ("balance_cents" >= 0)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "users" DROP CONSTRAINT "CHK_balance_cents_positive_or_zero"`,
    );
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "balance_cents"`);
    await queryRunner.query(`DROP TABLE "jobs"`);
  }
}
