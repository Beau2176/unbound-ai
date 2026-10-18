# Full-site release checkpoint — October 17, 2026

This checkpoint applies to the full UNBOUND AI platform at `https://unbound-ai-app.onrender.com/`. The separate Founders Beta site was not changed. Dates below use UTC where an exact timestamp is supplied; the review date is October 17 in America/Denver.

## Completed verification

| Item | Evidence | Result |
| --- | --- | --- |
| Release fixes | Main commit `d347bedba6768909d0a1f1daeb0da5293bf8ed13`, PR #163 | Launch-plan metadata corrected; `proxy-addr` 2.0.8 with spoofing regression coverage |
| Production build and recovery CI | Main workflow run `39089000945` | Passed |
| Render HTTP health check | `/healthz`, deployment `dep-dba2tctg1s2s73aihckg`, live at `2026-10-18T02:28:25.936067Z` | Saved and deployed |
| Public smoke check | `npm run live-smoke -- --origin=https://unbound-ai-app.onrender.com --require-ready --timeout-ms=30000` | All nine checks passed: health, readiness, system status, homepage, three scripts, Terms, Privacy |
| Database connection | Existing restored Neon production database | Server and database readiness returned HTTP 200 after deployment |
| Saved archive integrity | Existing recovery archive, PostgreSQL 18 catalog and complete archive-export verification | Passed without restoring over live data |
| Current recovery checkpoint | Neon snapshot `snap-flat-sunset-b5itis22`, created `2026-10-18T02:31:21Z` | Created from production |
| Snapshot restore | Separate branch `br-autumn-boat-b52tbjcd`, restored from that snapshot | Ready; 50-table schema fingerprint and account/history counts matched the source |
| Production isolation | Original production branch remained primary/default; no connection-string cutover | Production was not replaced or restored |
| Conversation build | Feature head `9e7cd62a16b77ff103bc47cb6ce5885d27b54da9`, Production CI `39089728757`, Mobile Native CI `39089728835` | Both passed; local full CI passed with zero audit vulnerabilities |

The recovery-copy compute `ep-purple-heart-b5k1tqnu` was suspended after read-only verification. The recovery branch and snapshot remain available; no credentials or personal account/history contents are recorded here.

## Remaining release work

- **Always-on hosting:** Render web compute remains Free. Do not assert paid production infrastructure readiness.
- **Ongoing backups:** Neon remains `free_v3` with `history_retention_seconds=21600` (six hours). The snapshot schedule and prior snapshot list were empty before this checkpoint. One manual snapshot is now saved; this is not a recurring backup policy. Automated snapshots require a paid plan. See [Neon pricing](https://neon.com/pricing) and [backup and restore documentation](https://neon.com/docs/guides/backup-restore).
- **Complete recovery rehearsal:** Snapshot restore and data/schema comparisons passed. Starting the application against the isolated copy and verifying representative login/history behavior remain outstanding. Do not set full production recovery attestations from the read-only comparison alone.
- **Conversation acceptance:** PR #162 remains a draft. Verify real browser appearance, ordinary multi-turn conversation, listening without unsolicited advice, requested advice, a subject change, explicit stop, and voice input/playback before release.
- **Commercial dependencies:** Confirm the actual full-site billing, hard 18+ verification, transactional email, legal publication/consent, private upload scanning, and owner/business requirements through the existing launch gate. A published Terms/Privacy URL passing the smoke test does not establish final legal approval.

No paid plan was purchased, no AI generation was invoked, and no production-readiness attestation was set during this verification. Successful public health checks are runtime evidence, not commercial launch approval.
