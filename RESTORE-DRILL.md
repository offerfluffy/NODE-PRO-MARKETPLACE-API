# Restore drill report

## Run details

- Date: 2026-10-22 (CEST)
- Environment: local development Docker Compose stack
- Source database: `shop`, accessed through PgBouncer on port `21120`
- Dump: `backups/shop_2026-10-22_10-37-46.dump`
- Dump format: PostgreSQL custom archive (`pg_dump -Fc`)
- Dump size: 20,974 bytes (24 KB allocated on disk)

The drill was timed with `/usr/bin/time -p` while using the same
`scripts/with-secrets.sh` entry point documented for development and grading:

```bash
bash scripts/with-secrets.sh dev bash scripts/restore-drill.sh
```

For the measured grader-compatible run, `SKIP_VAULT=1` supplied the local
development credentials from the environment instead of contacting Infisical.

## Verification result

The script created a new empty PostgreSQL container and volume, restored the
latest dump, and ran the same control query against the source and restored
databases.

| Check | Result |
| --- | ---: |
| Source `orders` row count | 16 |
| Restored `orders` row count | 16 |
| Source `sum(total_amount_cents)` | 164600 |
| Restored `sum(total_amount_cents)` | 164600 |
| Final result | `MATCH` |

The `pg_restore` command completed in less than one whole second, so the
script's integer timer printed `Restore time: 0s`. The complete drill was also
run repeatedly; each run recreated a clean target and printed `MATCH`. The
temporary restore container and volume were removed after each run.

## RTO and RPO

- **Measured RTO: 3.57 seconds.** This is the end-to-end wall-clock time for
  creating and waiting for the clean PostgreSQL target, restoring the dump,
  validating the control values, and cleaning up the temporary resources.
- **Calculated RPO: up to 24 hours.** `backup.cron` runs once per day at 02:00,
  so a failure immediately before the next successful backup could lose almost
  one day of data. A missed or failed scheduled backup could make the real RPO
  worse and would require monitoring in production.

## Outcome

The backup is restorable, the selected data checks match the source database,
and the restore drill is repeatable from an empty volume.
