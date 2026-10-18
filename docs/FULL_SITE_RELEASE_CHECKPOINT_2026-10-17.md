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
| Conversation deployment | PR #162, main `05d0b39de635d55f50d837b689b759f9b763fe96`, deployment `dep-dba31gflk1mc73cffrrg` | Live |
| Native navigation correction | PR #164, all five remote checks passed on `c9d5445590fd6089da3d9a8b7f307fdcef6d6eef`; main `4dda2a8b515f8cede3e4a52c62f6e03b56cc7f58` | Live at `2026-10-18T02:46:34.938194Z`; duplicate header links removed and missing tools included in Tools |
| Live Conversation controls | Real browser on the full site | Enter, active state, placeholder, reload persistence, exit to Balanced, exit persistence, and Tools menu passed |
| Browser worker health check | `/healthz`, deployment `dep-dba34qnavr4c73fvkhl0` | Saved, deployed, authenticated worker and browser self-test healthy |

The recovery-copy compute `ep-purple-heart-b5k1tqnu` was suspended after read-only verification. The recovery branch and snapshot remain available; no credentials or personal account/history contents are recorded here.

A later content-digest comparison confirmed the original conversations/messages and stable account fields match the source. The account `updated_at` column changed on the live database when the owner-account startup update ran during deployment; it is the only differing account column and is excluded from that later stable-field comparison. A direct attempt to start the application against the recovery copy could not resolve the database hostname from this workspace. The test stopped before creating synthetic account/history fixtures; its temporary credential file was removed and the recovery-copy compute was returned to idle. Application startup/login against the actual copy therefore remains unverified.

A passive Free-plan baseline from `2026-10-18T02:13:24.401Z` through `2026-10-18T02:43:24.401Z` returned four CPU samples (maximum `0.0018737833` CPU units) and eight memory samples (maximum `125612030` bytes, about 120 MiB). No HTTP latency samples were available. This sparse, quiet-traffic interval is not a load test or production-sizing recommendation.

## Phone account-menu follow-up

Signed-in phone screenshots exposed a shared-shell bug: desktop initialization moved Security and the other account buttons into a panel hidden on mobile. Create Account also remained visible after being moved out of its signed-out container. Responsive placement now keeps the original account controls in the phone menu or desktop account panel as appropriate, and Create Account/Log Out explicitly follow account state. The new account-menu regression executes the production placement and account-rendering functions across initialization, repeated breakpoint changes, sign-in, sign-out, and administrator/ordinary-account states. Both reported failures reproduced before the fix and pass afterward.

The password form now appears near the top of Account Security under a named Change password heading, before passkeys, recovery codes, devices, alerts, and activity. Opening Security resets its internal scroll position to the top. Guidance points users who forgot their password to the existing recovery-code reset and states its session/passkey/code revocation effects.

This navigation correction retains the existing password and recovery checks. Changing a password or generating recovery codes still requires the current password. A signed-in passkey user who has forgotten that password does not yet have a passkey-verified password-reset flow. Do not claim that this menu fix resolves that separate recovery limitation. The user subsequently reached Security on their signed-in phone and reported generating recovery codes and changing their password; fresh cloud-browser login then verified the updated credentials.

## Signed-in account and live launch-gate verification

After the user changed their password on their own phone, a fresh secure password sign-in succeeded in the cloud browser. Account-scoped Conversation mode saved successfully and remained active after reload; exiting restored Balanced, and the original Straight Shooter style was restored and verified after another reload. Security displayed the password form and the status of ten unused recovery codes generated on the user's phone. History displayed three saved conversations. No password or recovery-code values were read, recorded, or regenerated during these checks, and no AI or audio request was sent.

The live engineering endpoint returned four passing checks and seven blockers out of eleven checks at `2026-10-18T03:38:41Z`. Runtime, maintenance state, configured AI streaming, and configured research support passed; this configuration evidence is not a live model-quality test. Blockers were production infrastructure, recovery protection, final published legal policies, legal consent enforcement, transactional email configuration, billing provider selection, and hard age-verification provider selection. The owner/business gate showed zero of five recorded verifications; this does not establish that external approvals were denied or never obtained.

The dashboard incorrectly read the engineering endpoint's `{ launch: ... }` response as a direct payload, displaying zero checks. The page now reads that documented wrapper and rejects missing or empty check lists with a visible error. The regression executes the actual server route and actual dashboard script together, preserves the separate direct owner/business payload, and checks malformed responses and denied administrator access. It reproduced the zero-check error before the fix and passes afterward.

## Further no-spend release preparation

The backup script previously checked only the custom archive's catalog before
publishing and pruning old backups. A temporary truncated copy of the saved
PostgreSQL 18 archive reproduced the gap: the catalog check returned success,
while a complete `pg_restore --file=/dev/null` read failed. The original archive
passed the full read and was unchanged; the temporary damaged copy was removed.
The script now requires that complete read before publication or retention
cleanup. Failure contracts verify existing backups survive, and the PostgreSQL
16/18 integration matrix includes the same truncated-data scenario using only
synthetic fixtures. This strengthens archive validation; it does not establish
recurring offsite backups or complete the actual-copy startup/login drill.

Rehearsal summaries also previously counted old PASS results even when a current
prerequisite became blocked. They now preserve historical evidence separately,
show the affected step as blocked, and require all current preflight prerequisites
before finalization. The regression executes the actual integrated finalization
route: drifted prerequisites and incomplete results return 409 without updating
the run; current prerequisites and complete results allow the normal audited
completion. The launch catalog now derives prices from the plan definitions and
requires Premium $49.99, Ultra $129.99, and Unlimited $299.99 checkout evidence;
Max remains excluded from the initial launch.

The draft Terms/Privacy and internal data-flow map now distinguish Render
application/browser-worker hosting from Neon PostgreSQL storage. They remain
non-binding drafts with acceptance and enforcement off. Billing/provider packets
and the no-spend handoff now match the three-plan launch and list the exact next
external inputs without treating missing approvals as denials or authorizing
purchases. Local full CI passed with zero audit vulnerabilities, and focused
backup, rehearsal-route, and legal-draft checks passed. No production data was
restored, provider call made, commercial readiness flag changed, or paid service
purchased during this follow-up.

## Remaining release work

- **Always-on hosting:** Render web compute remains Free. Do not assert paid production infrastructure readiness.
- **Ongoing backups:** Neon remains `free_v3` with `history_retention_seconds=21600` (six hours). The snapshot schedule and prior snapshot list were empty before this checkpoint. One manual snapshot is now saved; this is not a recurring backup policy. Automated snapshots require a paid plan. See [Neon pricing](https://neon.com/pricing) and [backup and restore documentation](https://neon.com/docs/guides/backup-restore).
- **Complete recovery rehearsal:** Snapshot restore and data/schema comparisons passed. Starting the application against the isolated copy and verifying representative login/history behavior remain outstanding. Do not set full production recovery attestations from the read-only comparison alone.
- **Conversation acceptance:** The interface, Tools navigation, account-scoped saving, reload persistence, exit to Balanced, and restoration of the original account style are verified. Ordinary multi-turn conversation, listening without unsolicited advice, requested advice, a subject change, explicit stop, and device voice input/playback still need acceptance. No paid model or speech requests were made.
- **Commercial dependencies:** Confirm the actual full-site billing, hard 18+ verification, transactional email, legal publication/consent, private upload scanning, and owner/business requirements through the existing launch gate. A published Terms/Privacy URL passing the smoke test does not establish final legal approval.

No paid plan was purchased, no AI generation was invoked, and no production-readiness attestation was set during this verification. Successful public health checks are runtime evidence, not commercial launch approval.
