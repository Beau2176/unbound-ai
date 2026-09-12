#!/usr/bin/env bash
set -euo pipefail

umask 077

DATABASE_URL_VALUE="${BACKUP_DATABASE_URL:-${DATABASE_URL:-}}"
BACKUP_DIR_VALUE="${BACKUP_DIR:-./backups}"
BACKUP_PREFIX_VALUE="${BACKUP_PREFIX:-unbound-ai}"
RETENTION_DAYS_VALUE="${BACKUP_RETENTION_DAYS:-14}"

if [[ -z "${DATABASE_URL_VALUE}" ]]; then
  echo "ERROR: Set BACKUP_DATABASE_URL or DATABASE_URL before running a backup." >&2
  exit 2
fi

for command_name in pg_dump pg_restore; do
  if ! command -v "${command_name}" >/dev/null 2>&1; then
    echo "ERROR: ${command_name} is required and was not found in PATH." >&2
    exit 3
  fi
done

if ! [[ "${RETENTION_DAYS_VALUE}" =~ ^[0-9]+$ ]] || (( RETENTION_DAYS_VALUE < 1 )); then
  echo "ERROR: BACKUP_RETENTION_DAYS must be a positive integer." >&2
  exit 4
fi

mkdir -p "${BACKUP_DIR_VALUE}"
TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"
FINAL_FILE="${BACKUP_DIR_VALUE}/${BACKUP_PREFIX_VALUE}-${TIMESTAMP}.dump"
TEMP_FILE="${FINAL_FILE}.partial"
CHECKSUM_FILE="${FINAL_FILE}.sha256"

cleanup_partial() {
  rm -f "${TEMP_FILE}"
}
trap cleanup_partial EXIT

pg_dump \
  --format=custom \
  --no-owner \
  --no-privileges \
  --file="${TEMP_FILE}" \
  "${DATABASE_URL_VALUE}"

pg_restore --list "${TEMP_FILE}" >/dev/null
mv "${TEMP_FILE}" "${FINAL_FILE}"
trap - EXIT

if command -v sha256sum >/dev/null 2>&1; then
  (
    cd "${BACKUP_DIR_VALUE}"
    sha256sum "$(basename "${FINAL_FILE}")" > "$(basename "${CHECKSUM_FILE}")"
  )
elif command -v shasum >/dev/null 2>&1; then
  (
    cd "${BACKUP_DIR_VALUE}"
    shasum -a 256 "$(basename "${FINAL_FILE}")" > "$(basename "${CHECKSUM_FILE}")"
  )
else
  echo "ERROR: sha256sum or shasum is required to checksum the backup." >&2
  rm -f "${FINAL_FILE}"
  exit 5
fi

find "${BACKUP_DIR_VALUE}" -type f \
  \( -name "${BACKUP_PREFIX_VALUE}-*.dump" -o -name "${BACKUP_PREFIX_VALUE}-*.dump.sha256" \) \
  -mtime "+${RETENTION_DAYS_VALUE}" -delete

FILE_SIZE_BYTES="$(wc -c < "${FINAL_FILE}" | tr -d ' ')"
echo "Backup created and verified: ${FINAL_FILE} (${FILE_SIZE_BYTES} bytes)"
echo "Checksum: ${CHECKSUM_FILE}"
