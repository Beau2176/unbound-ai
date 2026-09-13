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

if ! [[ "${RETENTION_DAYS_VALUE}" =~ ^[1-9][0-9]{0,3}$ ]]; then
  echo "ERROR: BACKUP_RETENTION_DAYS must be an integer from 1 to 9999." >&2
  exit 4
fi

if ! [[ "${BACKUP_PREFIX_VALUE}" =~ ^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$ ]]; then
  echo "ERROR: BACKUP_PREFIX must be 1–64 letters, digits, underscores or hyphens, starting with a letter or digit." >&2
  exit 4
fi

if command -v sha256sum >/dev/null 2>&1; then
  CHECKSUM_COMMAND=(sha256sum)
elif command -v shasum >/dev/null 2>&1; then
  CHECKSUM_COMMAND=(shasum -a 256)
else
  echo "ERROR: sha256sum or shasum is required to checksum the backup." >&2
  exit 5
fi

mkdir -p -- "${BACKUP_DIR_VALUE}"
BACKUP_DIR_VALUE="$(cd -- "${BACKUP_DIR_VALUE}" && pwd -P)"
STAGING_DIR="$(mktemp -d "${BACKUP_DIR_VALUE}/.unbound-backup.XXXXXXXX")"
TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"
BACKUP_NAME="${BACKUP_PREFIX_VALUE}-${TIMESTAMP}-${STAGING_DIR##*.}.dump"
FINAL_FILE="${BACKUP_DIR_VALUE}/${BACKUP_NAME}"
TEMP_FILE="${STAGING_DIR}/${BACKUP_NAME}"
CHECKSUM_FILE="${FINAL_FILE}.sha256"
PUBLISHED_DUMP=false
PUBLISHED_PAIR=false

cleanup_partial() {
  if [[ "${PUBLISHED_DUMP}" == true && "${PUBLISHED_PAIR}" != true ]]; then
    rm -f -- "${FINAL_FILE}"
  fi
  rm -rf -- "${STAGING_DIR}"
}
trap cleanup_partial EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

pg_dump \
  --format=custom \
  --no-owner \
  --no-privileges \
  --file="${TEMP_FILE}" \
  "${DATABASE_URL_VALUE}"

pg_restore --list "${TEMP_FILE}" >/dev/null
if [[ ! -s "${TEMP_FILE}" ]]; then
  echo "ERROR: The backup archive is empty." >&2
  exit 6
fi

(
  cd -- "${STAGING_DIR}"
  "${CHECKSUM_COMMAND[@]}" "${BACKUP_NAME}" > "${BACKUP_NAME}.sha256"
  "${CHECKSUM_COMMAND[@]}" -c "${BACKUP_NAME}.sha256" >/dev/null
)

# Same-filesystem hard links publish complete files and refuse to overwrite.
# Consumers must require the checksum companion before using an archive.
ln -- "${TEMP_FILE}" "${FINAL_FILE}"
PUBLISHED_DUMP=true
ln -- "${TEMP_FILE}.sha256" "${CHECKSUM_FILE}"
PUBLISHED_PAIR=true

# Restrict cleanup to this directory and exact legacy/current backup names.
while IFS= read -r -d '' old_file; do
  old_name="${old_file##*/}"
  if [[ "${old_name}" =~ ^${BACKUP_PREFIX_VALUE}-[0-9]{8}T[0-9]{6}Z(-[a-zA-Z0-9]{8})?\.dump(\.sha256)?$ ]]; then
    rm -f -- "${old_file}"
  fi
done < <(find "${BACKUP_DIR_VALUE}" -maxdepth 1 -type f -mtime "+${RETENTION_DAYS_VALUE}" -print0)

FILE_SIZE_BYTES="$(wc -c < "${FINAL_FILE}" | tr -d ' ')"
echo "Backup created; archive listing and checksum verified: ${FINAL_FILE} (${FILE_SIZE_BYTES} bytes)"
echo "Checksum: ${CHECKSUM_FILE}"
