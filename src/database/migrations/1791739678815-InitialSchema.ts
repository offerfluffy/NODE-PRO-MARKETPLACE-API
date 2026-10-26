import { MigrationInterface, QueryRunner } from 'typeorm';

export class InitialSchema1791739678815 implements MigrationInterface {
  name = 'InitialSchema1791739678815';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "typeorm_metadata" (
        "type" character varying NOT NULL,
        "database" character varying,
        "schema" character varying,
        "table" character varying,
        "name" character varying,
        "value" text
      )
    `);
    await queryRunner.query(
      `CREATE TABLE "inventories" ("id" bigint GENERATED ALWAYS AS IDENTITY NOT NULL, "quantity_available" integer NOT NULL DEFAULT '0', "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "product_id" bigint NOT NULL, CONSTRAINT "REL_92fc0c77bab4a656b9619322c6" UNIQUE ("product_id"), CONSTRAINT "CHK_quantity_available" CHECK ("quantity_available" >= 0), CONSTRAINT "PK_7b1946392ffdcb50cfc6ac78c0e" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `INSERT INTO "typeorm_metadata"
        ("database", "schema", "table", "type", "name", "value")
      VALUES (current_database(), current_schema(), $1, $2, $3, $4)`,
      [
        'products',
        'GENERATED_COLUMN',
        'search_vector',
        `to_tsvector('simple', "name" || ' ' || "description")`,
      ],
    );
    await queryRunner.query(
      `CREATE TABLE "products" ("id" bigint GENERATED ALWAYS AS IDENTITY NOT NULL, "name" text NOT NULL, "description" text NOT NULL, "price_cents" integer NOT NULL, "status" text NOT NULL, "image_url" text, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "search_vector" tsvector GENERATED ALWAYS AS (to_tsvector('simple', "name" || ' ' || "description")) STORED NOT NULL, "seller_id" bigint NOT NULL, CONSTRAINT "CHK_products_price_cents_positive" CHECK ("price_cents" > 0), CONSTRAINT "CHK_products_status" CHECK ("status" IN ('draft', 'active', 'archived')), CONSTRAINT "PK_0806c755e0aca124e67c0cf6d7d" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "order_items" ("id" bigint GENERATED ALWAYS AS IDENTITY NOT NULL, "quantity" integer NOT NULL, "unit_price_cents" integer NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "order_id" bigint NOT NULL, "product_id" bigint NOT NULL, CONSTRAINT "CHK_order_items_quantity_positive" CHECK ("quantity" > 0), CONSTRAINT "CHK_order_items_unit_price_cents_positive" CHECK ("unit_price_cents" > 0), CONSTRAINT "PK_005269d8574e6fac0493715c308" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_order_items_order_id_product_id" ON "order_items" ("order_id", "product_id") `,
    );
    await queryRunner.query(
      `CREATE TABLE "orders" ("id" bigint GENERATED ALWAYS AS IDENTITY NOT NULL, "status" text NOT NULL, "total_amount_cents" integer NOT NULL, "idempotency_key" text NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "customer_id" bigint NOT NULL, CONSTRAINT "CHK_orders_total_amount_cents_positive" CHECK ("total_amount_cents" > 0), CONSTRAINT "CHK_orders_status" CHECK ("status" IN ('pending', 'paid', 'cancelled', 'completed')), CONSTRAINT "PK_710e2d4957aa5878dfe94e4ac2f" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_orders_customer_id_idempotency_key" ON "orders" ("customer_id", "idempotency_key") `,
    );
    await queryRunner.query(
      `CREATE TABLE "users" ("id" bigint GENERATED ALWAYS AS IDENTITY NOT NULL, "email" text NOT NULL, "password_hash" text NOT NULL, "full_name" text NOT NULL, "role" text NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "CHK_users_role" CHECK ("role" IN ('customer', 'seller', 'admin')), CONSTRAINT "PK_a3ffb1c0c8416b9fc6f907b7433" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `ALTER TABLE "inventories" ADD CONSTRAINT "FK_92fc0c77bab4a656b9619322c62" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "products" ADD CONSTRAINT "FK_425ee27c69d6b8adc5d6475dcfe" FOREIGN KEY ("seller_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "order_items" ADD CONSTRAINT "FK_145532db85752b29c57d2b7b1f1" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "order_items" ADD CONSTRAINT "FK_9263386c35b6b242540f9493b00" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "orders" ADD CONSTRAINT "FK_772d0ce0473ac2ccfa26060dbe9" FOREIGN KEY ("customer_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(`
      CREATE INDEX "idx_products_seller_created_at"
      ON "products" ("seller_id", "created_at" DESC)
    `);
    await queryRunner.query(`
      CREATE INDEX "idx_orders_pending_created_at"
      ON "orders" ("created_at" DESC)
      WHERE "status" = 'pending'
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "idx_users_email_lower"
      ON "users" (LOWER("email"))
    `);
    await queryRunner.query(`
      CREATE INDEX "idx_products_search_vector"
      ON "products"
      USING GIN ("search_vector")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "public"."idx_products_search_vector"`);
    await queryRunner.query(`DROP INDEX "public"."idx_users_email_lower"`);
    await queryRunner.query(
      `DROP INDEX "public"."idx_orders_pending_created_at"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."idx_products_seller_created_at"`,
    );
    await queryRunner.query(
      `ALTER TABLE "orders" DROP CONSTRAINT "FK_772d0ce0473ac2ccfa26060dbe9"`,
    );
    await queryRunner.query(
      `ALTER TABLE "order_items" DROP CONSTRAINT "FK_9263386c35b6b242540f9493b00"`,
    );
    await queryRunner.query(
      `ALTER TABLE "order_items" DROP CONSTRAINT "FK_145532db85752b29c57d2b7b1f1"`,
    );
    await queryRunner.query(
      `ALTER TABLE "products" DROP CONSTRAINT "FK_425ee27c69d6b8adc5d6475dcfe"`,
    );
    await queryRunner.query(
      `ALTER TABLE "inventories" DROP CONSTRAINT "FK_92fc0c77bab4a656b9619322c62"`,
    );
    await queryRunner.query(`DROP TABLE "users"`);
    await queryRunner.query(
      `DROP INDEX "public"."UQ_orders_customer_id_idempotency_key"`,
    );
    await queryRunner.query(`DROP TABLE "orders"`);
    await queryRunner.query(
      `DROP INDEX "public"."UQ_order_items_order_id_product_id"`,
    );
    await queryRunner.query(`DROP TABLE "order_items"`);
    await queryRunner.query(`DROP TABLE "products"`);
    await queryRunner.query(
      `DELETE FROM "typeorm_metadata"
      WHERE "type" = $1
        AND "name" = $2
        AND "database" = current_database()
        AND "schema" = current_schema()
        AND "table" = $3`,
      ['GENERATED_COLUMN', 'search_vector', 'products'],
    );
    await queryRunner.query(`DROP TABLE "inventories"`);
  }
}
