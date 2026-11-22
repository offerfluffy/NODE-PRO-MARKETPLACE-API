import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddRefreshTokens1794772669881 implements MigrationInterface {
  name = 'AddRefreshTokens1794772669881';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "refresh_tokens" ("id" bigint GENERATED ALWAYS AS IDENTITY NOT NULL, "token_hash" text NOT NULL, "family_id" uuid NOT NULL, "used_at" TIMESTAMP WITH TIME ZONE, "revoked_at" TIMESTAMP WITH TIME ZONE, "expires_at" TIMESTAMP WITH TIME ZONE NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "user_id" bigint NOT NULL, CONSTRAINT "PK_7d8bee0204106019488c4c50ffa" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_refresh_tokens_family_id" ON "refresh_tokens" ("family_id") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_refresh_tokens_token_hash" ON "refresh_tokens" ("token_hash") `,
    );
    await queryRunner.query(
      `ALTER TABLE "refresh_tokens" ADD CONSTRAINT "FK_3ddc983c5f7bcf132fd8732c3f4" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "refresh_tokens" DROP CONSTRAINT "FK_3ddc983c5f7bcf132fd8732c3f4"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."UQ_refresh_tokens_token_hash"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."idx_refresh_tokens_family_id"`,
    );
    await queryRunner.query(`DROP TABLE "refresh_tokens"`);
  }
}
