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

### v0.67 backup integrity hardening

Each run now stages its archive and checksum in a private directory and adds a
random suffix to the timestamp, so simultaneous runs cannot overwrite one another.
The checksum is generated and checked before publication; publication refuses
to replace an existing file. Ordinary failures and handled termination signals
clean up staging files. An uncatchable kill or host failure can leave a staging
directory or an archive without its checksum: consumers must require both files
and verify the checksum before accepting a backup.

`BACKUP_PREFIX` accepts 1–64 ASCII letters, digits, underscores or hyphens and
must start with a letter or digit. `BACKUP_RETENTION_DAYS` accepts integers from
1 to 9999 without leading zeros. Retention runs only after a new archive and
checksum are published, only in the output directory itself, and only for exact
timestamped backup filenames belonging to the selected prefix. Both original
timestamp-only filenames and new filenames with random suffixes are recognized.
Unrelated files and nested directories are preserved. Use a trusted backup
directory on a filesystem supporting hard links.

Run `npm run backup-check` from `app` for isolated script regression tests. The
tests substitute PostgreSQL commands and exercise concurrent runs, private file
permissions, actual SHA-256 verification, failed dump/list/checksum commands,
empty dumps, invalid configuration, and retention boundaries. Production CI
includes this check. These tests do not connect to production or replace a real
restore drill, durable storage configuration, or operational readiness evidence.

Archive listing checks inspect the archive table of contents; they do not test
restoring all data. See the official [PostgreSQL pg_restore documentation](https://www.postgresql.org/docs/current/app-pgrestore.html).

A local dump is **not** a durable backup until it has been copied to storage that survives loss of the database host and application host.

### v0.68 real PostgreSQL recovery integration gate

Production CI also starts an isolated PostgreSQL 16 service and runs
`npm run recovery-integration-check`. This test starts the actual integrated
application (`start.js`) against a new database, registers a synthetic account,
and seeds conversation, subscription, consent, usage and audit records. It stops
the application, runs the repository backup script, verifies the checksum,
restores the dump with `--exit-on-error --single-transaction`, and compares every
public table's row count and content digest plus every sequence's state. It then
starts the app against the restored database, signs in, loads recovered history,
and confirms anonymous access to that history is denied.

For a local run, provide `TEST_POSTGRES_URL` pointing to a disposable loopback
PostgreSQL server's `/postgres` maintenance database. The script refuses remote
hosts, other initial database names, and URL query overrides. The test role must
be able to create/drop databases. It creates uniquely named `unbound_ci_*`
databases and drops only databases created by that run in its cleanup. Required
tools are Node 24, Bash, `pg_dump`, `pg_restore` and a SHA-256 utility. Match the
PostgreSQL client major version to the test server.

No production connection strings, external AI/email/billing credentials or live
customer data are used. A successful CI run proves the tested schema and
synthetic records survive a logical backup/restore cycle. It does **not** verify
offsite backup storage, production retention, production volume, or recovery of
a real production backup. It must not update production recovery attestations.

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

## Maintenance controls

UNBOUND AI supports environment-controlled incident modes:

- `UNBOUND_MAINTENANCE_MODE=off` — normal operation.
- `UNBOUND_MAINTENANCE_MODE=read_only` — safe HTTP methods continue, while API writes (including chat requests that persist history/usage) return `503` with `Retry-After`.
- `UNBOUND_MAINTENANCE_MODE=offline` — all API traffic is blocked except `/api/system/status`, which remains available to report maintenance state.
- `UNBOUND_MAINTENANCE_MESSAGE=<message>` — optional user-facing maintenance reason.
- `UNBOUND_MAINTENANCE_RETRY_AFTER_SECONDS=<seconds>` — retry guidance, default `300`.

For a data-integrity incident, switch to `read_only` before backup or recovery work whenever the application must remain reachable. Use `offline` when even reads should stop. Changing these environment variables requires the hosting environment to restart/redeploy the service before the new mode takes effect.

Billing and verification webhook writes are also blocked in maintenance mode. Confirm that the provider will retry delivery and reconcile any missed events after normal operation resumes.

## Data-loss incident procedure

1. Set `UNBOUND_MAINTENANCE_MODE=read_only` (or `offline` when reads are unsafe) if continued writes could make recovery harder.
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
