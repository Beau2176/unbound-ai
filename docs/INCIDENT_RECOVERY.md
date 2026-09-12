# UNBOUND AI Incident and Database Recovery Runbook

This runbook defines the minimum recovery procedure for UNBOUND AI production data.

## Current production constraint

A Render Postgres database on the **Free** compute plan does not receive Render-managed logical backups or point-in-time recovery (PITR). A Free database therefore must not be treated as production-protected data storage.

Before paid/public launch, use at least one of these protections:

1. Upgrade Render Postgres to a paid database plan and enable/verify Render-managed recovery.
2. Configure an external backup job that runs `pg_dump`, verifies the dump, and copies it to durable storage outside the database instance.

Best practice for a commercial launch is to use both managed recovery and an external logical backup.

## Application recovery-readiness variables

UNBOUND AI reports recovery readiness from these environment variables:

- `DATABASE_BACKUP_MODE=none|managed|external|hybrid`
- `DATABASE_MANAGED_RECOVERY_ENABLED=true|false`
- `DATABASE_EXTERNAL_BACKUP_ENABLED=true|false`
- `DATABASE_BACKUP_LAST_VERIFIED_AT=<ISO-8601 timestamp>`
- `DATABASE_BACKUP_MAX_AGE_HOURS=<positive integer>` (default `26`)
- `DATABASE_RESTORE_LAST_TESTED_AT=<ISO-8601 timestamp>`
- `DATABASE_RESTORE_TEST_MAX_AGE_DAYS=<positive integer>` (default `90`)

The administrator-only endpoint `/api/admin/ops/recovery` returns the current launch-readiness assessment. These flags are declarations of verified operational state; do not set them to `true` until the corresponding protection has actually been tested.

## Create a verified logical backup

The repository includes `app/scripts/backup-postgres.sh`.

Requirements:

- PostgreSQL client utilities containing `pg_dump` and `pg_restore`
- `BACKUP_DATABASE_URL` or `DATABASE_URL`
- durable output storage mounted or copied elsewhere after the script completes

Example:

```bash
export BACKUP_DATABASE_URL='postgresql://...'
export BACKUP_DIR='/secure/backups/unbound-ai'
export BACKUP_RETENTION_DAYS='14'
bash app/scripts/backup-postgres.sh
```

The script:

- creates a PostgreSQL custom-format dump;
- avoids embedding credentials in filenames or console output;
- validates the dump with `pg_restore --list`;
- creates a SHA-256 checksum;
- writes files with a restrictive process umask;
- removes matching local backup files older than the configured retention period.

A local dump is **not** a durable backup until it has been copied to storage that survives loss of the database host and application host.

## Verify a backup before depending on it

At minimum:

```bash
pg_restore --list /path/to/unbound-ai-YYYYMMDDTHHMMSSZ.dump >/dev/null
```

Then verify its checksum using the adjacent `.sha256` file.

For launch readiness, also perform a restore drill into an empty disposable PostgreSQL database. Do not perform a destructive restore into the live production database.

Example restore drill:

```bash
export TARGET_DATABASE_URL='postgresql://...empty-test-database...'
pg_restore \
  --dbname="$TARGET_DATABASE_URL" \
  --no-owner \
  --no-privileges \
  --verbose \
  /path/to/unbound-ai-YYYYMMDDTHHMMSSZ.dump
```

After the restore, verify representative tables and counts, authenticate with a test account if appropriate, and confirm application startup against the recovered database. Record the successful drill time in `DATABASE_RESTORE_LAST_TESTED_AT`.

## Data-loss incident procedure

1. Stop or restrict writes if continued writes could make recovery harder.
2. Record the incident start time and the last known-good time.
3. Preserve the current database; do not immediately delete it.
4. If paid Render PITR is available, restore into a **new** recovery instance and validate it before cutover.
5. Otherwise restore the newest verified logical backup into an empty database instance.
6. Validate schema, critical row counts, account sign-in, conversation history, billing metadata, entitlement state, and security records.
7. Point the application at the recovered database only after validation.
8. Confirm `/readyz` is healthy and exercise critical user flows.
9. Keep the original database isolated until the recovery is accepted.
10. Document data-loss window, root cause, corrective action, and the next restore-test date.

## Application shutdown behavior

UNBOUND AI marks readiness false while handling `SIGTERM` or `SIGINT`, stops accepting new connections, closes the HTTP server, then closes the PostgreSQL pool. A bounded shutdown timer prevents an indefinitely hung deploy or restart.

## Launch gate

Do not mark database recovery as launch-ready while `/api/admin/ops/recovery` reports blockers. In particular, a Free Render Postgres database with no verified external backup remains a production launch blocker.
