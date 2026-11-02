import { MigrationInterface, QueryRunner } from "typeorm";

export class AddJobEventId1793641582317 implements MigrationInterface {
    name = 'AddJobEventId1793641582317'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "jobs" ADD "event_id" text`);
        await queryRunner.query(`CREATE UNIQUE INDEX "UQ_jobs_event_id" ON "jobs" ("event_id") `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX "public"."UQ_jobs_event_id"`);
        await queryRunner.query(`ALTER TABLE "jobs" DROP COLUMN "event_id"`);
    }

}
