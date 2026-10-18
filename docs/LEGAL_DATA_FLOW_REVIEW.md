# UNBOUND AI legal/privacy data-flow review map

Status: **DRAFT REVIEW MATERIAL — NOT A PUBLISHED PRIVACY NOTICE OR LEGAL OPINION**

This document maps the current production-target architecture to the draft Terms of Use and Privacy Notice so legal/compliance review can focus on the service UNBOUND AI is actually building. It must be rechecked against production configuration before any policy version is marked non-draft.

## Review rule

Do not enable legal acceptance or enforcement merely because this map exists. The binding documents still require the operator identity, launch jurisdictions, final pricing/refund terms, retention schedule, rights-request process, dispute terms, provider contracts, infrastructure plan, and qualified legal/compliance review.

## Provider and data-flow map

| Function | Current production target | Data UNBOUND may send | Data UNBOUND is designed to keep | Data UNBOUND is designed not to keep | Primary code boundary |
| --- | --- | --- | --- | --- | --- |
| Application / browser-worker hosting | Render | Application requests and browser-worker traffic needed to operate the requested service | Application operational records; persistent account data is stored in the separate Neon database | Infrastructure secrets in public responses/repo | `app/server.js`, `browser-worker/*`, `app/ops/*` |
| PostgreSQL database / recovery | Neon | Account, conversation, security, entitlement, operational and other application records stored through database queries | Persistent PostgreSQL records and provider-managed recovery data; a separate recovery-test copy exists | Database credentials in public responses/repo; an unverified promise of recurring backups | `app/server.js`, `app/ops/recovery-readiness.js`, `docs/INCIDENT_RECOVERY.md` |
| AI generation / research | OpenAI API | User prompt/content and necessary conversation/mode context for requested AI features | Conversation/history and usage metadata according to UNBOUND product settings | Passwords, recovery codes, billing secrets, raw age evidence merely because they exist elsewhere | `app/ai/gateway.js` |
| Transactional email | Amazon Simple Email Service (SES) | Recipient email, limited display-name data, verification/security email content and one-time verification link | Email-verification state and only the HMAC token hash/challenge metadata | Raw verification token after the outbound request, provider message IDs in public state, AWS secrets | `app/email/*` |
| Commercial billing | Segpay | Signed plan price plus opaque account reference through hosted checkout; authenticated lifecycle postbacks return subscription state | Plan/status, periods, cancellation state, opaque provider identifiers and idempotent webhook metadata | Full card number, CVV, raw payment method, Segpay signing/postback secrets | `app/billing/*` |
| Hard 18+ verification | Yoti Age Verification Service | Opaque verification reference plus hosted-flow/template/return/cancel/notification configuration | Normalized verification state, 18+ threshold, timestamps, result code, hashed provider session reference | Raw ID images, selfies, exact age, biometric templates, notification signature/evidence | `app/age/*` |
| Authentication / account security | UNBOUND + device authenticators | Necessary web requests for sign-in/security features | Password hashes, sessions, passkey public credential metadata, hashed recovery codes, security/audit events | Passkey private keys, device PINs, local biometric unlock data | `app/security/*`, `app/server.js` |

## Provider-specific review notes

### OpenAI API

The production-target AI gateway uses the OpenAI API. Before publication, confirm the exact API products/endpoints, account retention configuration, abuse-monitoring controls, subprocessors/regions that matter to the launch, and the then-current OpenAI business-data/privacy terms. UNBOUND should disclose what user content is transmitted to perform requested AI features and avoid implying that all content stays exclusively inside UNBOUND infrastructure.

### Render

Render currently hosts the full-site application and browser worker on Free web services in Ohio. Both have `/healthz` configured. The active PostgreSQL database is on Neon, not the expired Render database. Before publication, confirm the final Render plans/regions and review Render's then-current DPA/privacy/security materials for the application and browser-worker data flows.

### Neon

The existing Neon PostgreSQL 18 production project is in AWS us-east-2. Its current Free configuration has a six-hour history window and no scheduled snapshots. A manual production snapshot and an isolated recovery branch were created for verification; data/schema comparisons passed, while application startup/login against that actual copy remains unverified. These recovery copies contain personal data and need an access, retention, and deletion policy. They are not proof of recurring backup protection. Before final publication, review Neon's then-current privacy/DPA/subprocessor terms and describe the actual purchased or externally backed-up production arrangement. See the [current checkpoint](FULL_SITE_RELEASE_CHECKPOINT_2026-10-17.md).

### Amazon SES

SES is the production-target transactional email provider. Review the final sender domain, AWS region/account, message categories, suppression/bounce handling, security-email retention, and AWS data-processing terms. UNBOUND's application database stores a cryptographic verification-token hash rather than the raw token.

### Segpay

Segpay is the production-target commercial billing provider because UNBOUND's planned adults-only business model requires a processor that actually approves the use case. Before publication, confirm Segpay's written merchant approval, final product/price, renewal/cancellation/refund rules, card-brand disclosures, descriptor/support requirements, reserve/chargeback terms, and privacy/data-processing obligations. The application is designed to redirect users into hosted checkout and not store card numbers or CVV.

### Yoti AVS

Yoti AVS is the production-target hard age-verification provider. The approved production template determines which age-assurance methods users may choose and therefore what evidence Yoti/subprocessors may process. UNBOUND is designed to receive only the age-check outcome plus limited session metadata, not the underlying raw evidence. Before publication, confirm the approved 18+ template, non-biometric alternative, launch jurisdictions, retention/re-verification period, provider privacy disclosures, and any biometric/sensitive-data consent language required for the methods actually offered.

See [the account-data review](ACCOUNT_DATA_REVIEW.md) for the implemented export/deletion boundaries, isolated verification, and the draft request-handling process.

## UNBOUND-controlled records that still need a final retention schedule

The final Privacy Notice and internal retention policy should assign reviewed retention periods and deletion/exception rules to at least:

- account/profile records;
- conversation history and user content;
- AI/research usage and cost metadata;
- sessions, devices, passkeys, recovery-code hashes and security alerts;
- legal-consent/audit records;
- email verification challenges and delivery state;
- subscription/billing webhook records;
- age-verification state/events;
- advertising records if the marketplace launches;
- application/security logs;
- database backups and restore-test copies;
- records retained for fraud, disputes, tax/accounting, legal holds or mandatory reporting.

## Launch review questions still intentionally unresolved

1. The operator is UNBOUND FORGEWORKS LLC and the existing support/privacy/legal contact is unboundai111710@gmail.com. The owner-selected public mailing address is 251 Villa Vista St, Sterling, CO 80751, United States. Are any additional public contact details needed in the reviewed final policies?
2. Which U.S. states/countries are in the initial launch, and which are intentionally excluded pending review?
3. The intended initial paid plans are Premium $49.99, Ultra $129.99, and Unlimited $299.99 per month; Max $199.99 remains disabled. What approved renewal, refund/cancellation, tax, and trial terms will apply to each enabled plan?
4. Which adult-content categories/features are enabled at launch and which remain prohibited?
5. What Yoti methods are approved for each launch jurisdiction, and what non-biometric path is available?
6. What exact retention periods apply to each record category above?
7. What privacy-rights request and appeal process will UNBOUND operate?
8. What governing law, venue, dispute/arbitration approach, warranty/indemnity/liability provisions, and consumer-law disclosures are appropriate?
9. What international-transfer and processor/subprocessor terms apply to the final hosting/provider configuration?
10. What process will trigger a new policy version and renewed user acceptance after a material provider/data-flow change?

## Publication gate

The source defaults must remain draft until review is complete:

- `UNBOUND_TERMS_VERSION` and `UNBOUND_PRIVACY_VERSION` must not be changed to non-draft values prematurely.
- `UNBOUND_LEGAL_ACCEPTANCE_ENABLED` must remain off until the reviewed versions are published.
- `UNBOUND_LEGAL_ENFORCEMENT_ENABLED` must remain off until the final acceptance flow has been tested against those exact versions.
- The HTML drafts must retain `noindex, nofollow` and a visible draft warning until intentionally replaced with reviewed publication copies.
