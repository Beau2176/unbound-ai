# UNBOUND AI no-spend completion boundary

This document defines the point where repository-side work is complete enough that the remaining commercial-launch blockers are real external dependencies rather than unfinished internal preparation.

## Command

From `app/` run:

```bash
npm run no-spend-complete
```

Machine-readable output:

```bash
npm run no-spend-complete -- --json
```

The command exits non-zero when a required internal artifact or validation command is missing. It does not call providers, spend money, upgrade infrastructure, open accounts, create live verification sessions, charge cards, publish legal documents, or set readiness attestations.

## What `softwarePreparationComplete: true` means

It means the repository contains the required engineering and preparation artifacts for:

- infrastructure/cutover planning;
- backup and recovery procedures;
- bank/provider onboarding packets;
- Segpay billing integration and contract coverage;
- Yoti hard-18+ integration and contract coverage;
- Amazon SES email integration/readiness coverage;
- draft legal/data-flow review material for qualified counsel;
- ClamAV upload-scanning design and fail-closed contract coverage;
- live smoke/load/launch validation tooling;
- Android/iOS local production-derived bundles;
- native API/session transport validation;
- package-bound native validation;
- evidence-backed Android/iOS store-release gating.

It does **not** mean UNBOUND is commercially launch-ready.

## Remaining external-only stages

When the no-spend gate is green, the remaining blockers are expected to be these real-world stages:

1. **Production infrastructure** — paid always-on compute/database and actual platform health configuration.
2. **Durable backup/restore** — real production backup protection and a current isolated restore drill.
3. **Business bank** — provider eligibility/account approval plus verified ACH/wire/payment rails.
4. **Segpay** — merchant approval, production configuration/credentials, hosted checkout and real payment lifecycle verification.
5. **Yoti** — production onboarding/template/credentials and real hard-18+ end-to-end verification.
6. **Amazon SES/domain** — sender/domain DNS verification, production sending access/credentials and real delivery testing.
7. **Qualified legal/compliance review** — final policy review, publication and deliberate enforcement.
8. **Private ClamAV infrastructure** — real scanner deployment and operational verification in required fail-closed mode.
9. **Mobile signed-device/store evidence** — real signed Android/iOS device evidence, store-account/signing requirements, and store review where applicable.

Some of these may involve approval rather than a direct fee; they are still external because repository code cannot truthfully complete them.

## Fail-closed rule

Do not make this gate green by deleting a required artifact, weakening a readiness check, setting fake timestamps, inserting fake provider credentials, inventing signed-device evidence, or changing external blockers to internal-pass values.

The purpose of this gate is the opposite: prove that all free engineering/preparation work is present while preserving truthful external blockers.
