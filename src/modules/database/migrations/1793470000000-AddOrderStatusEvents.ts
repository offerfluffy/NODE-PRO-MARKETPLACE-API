import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddOrderStatusEvents1793470000000 implements MigrationInterface {
  name = 'AddOrderStatusEvents1793470000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "order_status_events" (
        "id" bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
        "order_id" bigint NOT NULL,
        "status" text NOT NULL,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "CHK_order_status_events_status"
          CHECK ("status" IN ('pending', 'paid', 'cancelled', 'completed')),
        CONSTRAINT "PK_cee8187701a1f5ca1d3780f89dc" PRIMARY KEY ("id"),
        CONSTRAINT "FK_4dd918631de3ec45cb4fa4d2d83"
          FOREIGN KEY ("order_id") REFERENCES "orders"("id")
          ON DELETE CASCADE ON UPDATE NO ACTION
      )`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_order_status_events_order_id_id"
       ON "order_status_events" ("order_id", "id")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "order_status_events"`);
  }
}
