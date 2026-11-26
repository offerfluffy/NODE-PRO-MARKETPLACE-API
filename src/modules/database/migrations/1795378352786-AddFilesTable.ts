import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddFilesTable1795378352786 implements MigrationInterface {
  name = 'AddFilesTable1795378352786';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "files" ("id" bigint GENERATED ALWAYS AS IDENTITY NOT NULL, "key" text NOT NULL, "owner_id" bigint NOT NULL, "status" text NOT NULL DEFAULT 'PENDING', "content_type" text NOT NULL, "size" bigint NOT NULL, "upload_id" text, "etag" text, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "CHK_files_size_positive" CHECK ("size" > 0), CONSTRAINT "CHK_files_status" CHECK ("status" IN ('PENDING', 'COMPLETED')), CONSTRAINT "PK_6c16b9093a142e0e7613b04a3d9" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_files_status_created_at" ON "files" ("status", "created_at") `,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_files_owner_id" ON "files" ("owner_id") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_files_key" ON "files" ("key") `,
    );
    await queryRunner.query(
      `ALTER TABLE "files" ADD CONSTRAINT "FK_4bc1db1f4f34ec9415acd88afdb" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "files" DROP CONSTRAINT "FK_4bc1db1f4f34ec9415acd88afdb"`,
    );
    await queryRunner.query(`DROP INDEX "public"."UQ_files_key"`);
    await queryRunner.query(`DROP INDEX "public"."idx_files_owner_id"`);
    await queryRunner.query(
      `DROP INDEX "public"."idx_files_status_created_at"`,
    );
    await queryRunner.query(`DROP TABLE "files"`);
  }
}
