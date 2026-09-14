# UNBOUND AI no-spend launch preparation

This runbook defines the work that can be completed before UNBOUND AI spends money on production hosting, provider contracts, banking, legal review, or private antivirus infrastructure.

The rule is simple: **prepare, verify, document, and test what can be tested safely; do not claim a paid or externally approved dependency is ready until the real dependency exists and has been verified.**

## Verified baseline — September 14, 2026

Connected Render inspection showed:

- `unbound-ai-app` is deployed from `main` on Render Free compute in Ohio.
- `unbound-browser-worker` is deployed from `main` on Render Free compute in Ohio.
- neither web service currently has a Render platform health-check path configured.
- `unbound-ai-db` is PostgreSQL 18 on Render Free Postgres.
- the current Free Postgres instance expires October 11, 2026.

These facts are a planning baseline, not launch approval. Do not set the production-infrastructure readiness attestations while the services remain in this state.

## One-command preflight

From `app/` run:

```bash
npm run launch-preflight
```

For machine-readable output:

```bash
node scripts/no-spend-launch-preflight.js --json
```

The command is read-only. It evaluates the existing readiness modules for infrastructure, recovery, banking/owner checks, Segpay, Yoti, SES, legal publishing/consent, and ClamAV. It does not upgrade Render, open accounts, submit provider transactions, change readiness flags, or expose configured secrets.

## Work order

### 1. Infrastructure — free preparation now

Complete now:

- record the current Render service/database IDs, region, plan, branch, deployment behavior, and health endpoints;
- measure current CPU, memory, request latency, error rate, and database connection behavior so the eventual paid sizes are based on evidence;
- define the intended paid web/database target, `/healthz` platform health-check path, cutover sequence, rollback sequence, and post-cutover verification list;
- keep `UNBOUND_INFRA_*` production attestations false until the paid always-on compute, durable database, and real platform health check exist.

Stop point requiring spend: moving the web service/database to paid production plans.

### 2. Backup / restore — free preparation now

Complete now:

- keep `backup-postgres.sh`, checksum/retention contracts, and PostgreSQL recovery integration tests green;
- document the future production backup destination, retention period, encryption/access policy, verification evidence, incident owner, and restore command sequence;
- rehearse restore behavior only with synthetic or isolated test databases;
- never use a rehearsal to overwrite or mutate the production database.

Stop point requiring real production infrastructure: establish actual durable backups, verify a current production backup, restore it into an isolated database, and record the real verification timestamps.

### 3. Business bank — free preparation now

Complete now:

- use the provider/application packet to describe UNBOUND truthfully before applying;
- request a pre-application eligibility review for the exact 18+ AI/SaaS model;
- ask whether incoming Segpay/ad-network ACH, outgoing ACH, domestic wires, reserve/chargeback-related transfers, debit-card use, downloadable statements, and normal vendor payments are supported;
- record written eligibility confirmation or a reference/case number when available;
- do not hide or misclassify the adults-only product to obtain a low-cost account.

Stop point requiring external approval and possibly funding: opening and validating the approved operating account.

### 4. Segpay — free preparation now

Complete now:

- prepare the truthful underwriting packet and product description;
- prepare the recurring TOP package requirements and final pricing decision inputs;
- prepare the exact signed hosted-pay-page test matrix for `amount`, `REF1`, and `REF2`;
- prepare authenticated billing postback cases for sale, rebill, decline, cancellation, disable/expiry, reactivation, refund, chargeback, retry/idempotency, and portal handoff;
- keep all Segpay verification attestations false until Merchant Services confirms the real production setup.

Stop point requiring provider approval/contract configuration: merchant approval, production pay page, production credentials, and live end-to-end payment tests.

### 5. Yoti — free preparation now

Complete now:

- prepare the onboarding description for the adults-only AI use case and intended launch jurisdictions;
- document UNBOUND's evidence-minimization boundary: no raw ID image, selfie, biometric template, or exact age stored by UNBOUND;
- prepare test cases for over-18 success, fail/underage outcome, cancellation, expiry, retries, duplicate/stale notifications, tampered signatures, unknown states, and provider outage;
- require an approved non-biometric alternative where applicable;
- keep all Yoti production attestations false until the actual onboarding/template/signature checks are completed.

Stop point requiring external provider setup: production onboarding, template approval, credentials/keys, and real end-to-end testing.

### 6. Amazon SES — free preparation now

Complete now:

- choose the intended sender domain/address and document DNS records required for DKIM/SPF and a deliberate DMARC policy;
- document the least-privilege credential plan and the selected AWS region;
- prepare delivery tests for initial verification, resend, expiry, invalid/used token rejection, provider failure, bounce/complaint handling, and post-registration automatic send;
- keep sender-identity, production-access, and real-delivery review attestations false until those facts are verified.

Stop point requiring external account/domain configuration: verified sender/domain, production sending access, production credentials, and real delivery tests.

### 7. Final legal review — free preparation now

Complete now:

- keep Terms and Privacy pages clearly marked draft and non-binding;
- resolve as much as possible of the operator identity, support/privacy contacts, launch jurisdictions, pricing/renewal/cancellation/refund terms, retention schedule, privacy-rights procedure, underage-account handling, provider disclosures, international-transfer language, IP/output terms, disputes, liability, and advertising disclosures;
- give counsel the existing data-flow review plus the provider/application packet and unresolved-decision list;
- do not publish non-draft versions or enable acceptance/enforcement before qualified review of the actual launch configuration.

Stop point requiring qualified external review: final legal/compliance approval and deliberate publication of non-draft policies.

### 8. ClamAV — free preparation now

Complete now:

- keep static upload defenses and ClamAV protocol/outage regression tests green;
- define the private-network deployment, INSTREAM size limits, monitoring/alerting ownership, restart behavior, timeout behavior, and fail-closed rollout plan;
- prepare validation with clean files and the harmless EICAR antivirus test file only;
- never expose `clamd` to the public internet and never use live malware for validation.

Stop point requiring infrastructure: deploy a real private scanner, test it, move from `best-effort` to `required`, and verify fail-closed behavior operationally.

### 9. Final launch rehearsal

Before external dependencies exist, use `docs/LAUNCH_REHEARSAL.md` only as a dry-run checklist.

Run the full real rehearsal only after infrastructure, backup/restore, banking, Segpay, Yoti, SES, legal review, and ClamAV truthfully report ready. A rehearsal must not make a blocked prerequisite appear complete.

## What not to do during the no-spend phase

Do not:

- upgrade a Render plan or create another paid resource;
- enter fake approval timestamps or readiness flags;
- commit provider/bank credentials or secrets;
- run live card charges merely to make a checklist green;
- publish draft legal documents as final;
- substitute a birth-date checkbox for the hard 18+ provider;
- expose ClamAV publicly;
- treat CI/synthetic recovery as a production restore drill.

The goal of this phase is to reach the point where the remaining work is **only real external approval, paid infrastructure, credentials, and production validation**, with no avoidable engineering/documentation work left behind.
