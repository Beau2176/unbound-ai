# UNBOUND AI high-risk evidence preservation

## Purpose

UNBOUND AI can preserve a narrowly scoped record after an **explicit high-risk safety enforcement event**. The preservation system exists so evidence is not destroyed by normal retention cleanup if UNBOUND later receives a valid legal request, preservation request, subpoena, warrant, court order, or other process that has been reviewed through the company's legal-response workflow.

This system is **not** a general surveillance archive and it does not decide whether conduct is criminal. Legal conclusions vary by jurisdiction and require qualified review. A separate safety/enforcement layer must first produce an explicit preservation-eligible event.

## What the system does not do

- It does not record every chat, search, file, photo, or video by default.
- It does not silently create a permanent copy of normal customer activity.
- It does not send preserved data to police, government agencies, private parties, or external services.
- It does not label a user a criminal or make a legal determination.
- It does not bypass the normal Privacy Notice, Terms, retention policy, or legal-review process.
- It does not expose a public ingestion endpoint that someone could use to manufacture an evidence record about another user.

## Preservation-eligible categories

The internal vault currently accepts only explicit safety events categorized as:

- `minor_sexual_exploitation`
- `credible_violent_threat`
- `human_trafficking_exploitation`
- `serious_cyber_abuse`
- `other_preservation_eligible`

These are **safety categories**, not findings that a law was violated. The future safety layer must supply the enforcement source, reason, and only the minimum evidence needed to understand the event.

## Stored record

A preserved record can contain:

- event UUID;
- account/user ID when available;
- request ID for internal correlation;
- safety category;
- enforcement source;
- preservation reason;
- optional classifier/reviewer confidence;
- occurrence and preservation timestamps;
- SHA-256 hash of the canonical evidence payload;
- encrypted evidence payload;
- evidence size;
- retention-expiration date;
- legal-hold metadata when a hold is placed.

The evidence payload is encrypted with **AES-256-GCM**. The encryption key is provided only through `ABUSE_EVIDENCE_ENCRYPTION_KEY` and is not stored in the repository. The plaintext hash is retained for integrity verification.

## Configuration

The vault defaults to disabled.

Required to enable preservation:

- `ABUSE_EVIDENCE_PRESERVATION_ENABLED=true`
- `ABUSE_EVIDENCE_ENCRYPTION_KEY=<32-byte key>`

The key may be supplied as 64 hexadecimal characters or base64 that decodes to exactly 32 bytes.

Optional:

- `ABUSE_EVIDENCE_RETENTION_DAYS` — defaults to 90 days and is bounded to 1–3650 days.

The final production retention period must be reviewed against UNBOUND's actual jurisdictions, Privacy Notice, Terms, provider obligations, and applicable preservation/reporting requirements before launch.

## Internal ingestion boundary

At runtime the server exposes an **internal application hook**:

`app.locals.preserveHighRiskSafetyEvidence(event)`

There is deliberately no public customer or admin endpoint that creates evidence records. A future safety enforcement component can invoke this hook only after it has independently produced a preservation-eligible event.

The current v0.94 work builds the vault and controls; it does **not** claim that a complete legal-violation classifier has been deployed.

## Admin controls

Admin-only endpoints are available for operational/legal-response use:

- `GET /api/admin/security/evidence/status` — safe configuration status.
- `GET /api/admin/security/evidence` — metadata only; no plaintext payload.
- `POST /api/admin/security/evidence/:id/read` — decrypts one record only when a documented reason is supplied and writes an access-audit entry.
- `POST /api/admin/security/evidence/:id/legal-hold` — prevents retention purge and requires a reference + reason.
- `POST /api/admin/security/evidence/:id/release-hold` — requires a documented release reason.
- `POST /api/admin/security/evidence/purge-expired` — deletes expired records that are not under legal hold.

All routes require the existing UNBOUND administrator authentication and database gate. Plaintext reads are returned with `Cache-Control: no-store`.

## Access auditing

Every plaintext read and legal-hold transition creates an entry in `abuse_evidence_access_audit` containing:

- evidence record ID;
- acting admin user ID when available;
- action;
- reason;
- request ID;
- timestamp.

Normal metadata listing does not decrypt evidence.

## Legal hold

When a valid preservation/legal request is accepted through UNBOUND's legal-response workflow, an administrator can place a legal hold with a reference and reason. Records under hold are excluded from normal expiration purge until the hold is released with a documented reason.

No code in this module determines whether a request is legally valid. That decision belongs to the owner/company's reviewed legal process.

## Future safety-layer integration

Before automatic preservation can be enabled in production, UNBOUND still needs a reviewed safety enforcement component that:

1. distinguishes ordinary discussion/research from actionable high-risk events;
2. uses a high threshold for preservation;
3. records the exact reason/source for the decision;
4. minimizes the preserved payload;
5. supports human review for ambiguous cases;
6. avoids treating lawful discussion, journalism, education, fiction, security research, or legal research as illegal merely because sensitive terms appear;
7. is tested for false positives and false negatives;
8. has counsel-approved rules for any category that may create mandatory reporting duties.

Until that layer exists and has been reviewed, the vault should remain available as infrastructure but **not** marketed as an automatic law-violation recorder.
