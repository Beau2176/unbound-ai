# UNBOUND AI — Zero-Cost Launch Validation

This toolkit is for engineering validation that can be performed before UNBOUND purchases production infrastructure or activates paid external providers.

It does **not** replace banking approval, Segpay approval, Yoti onboarding, Amazon SES/domain setup, legal review, private ClamAV deployment, durable production infrastructure, or a real production backup/restore drill.

## Commands

Run these from the `app` directory.

### Configuration preflight

```bash
npm run launch-preflight
npm run launch-preflight -- --json
```

This reads configuration/readiness only. It does not send provider transactions or make account changes.

### Public smoke check

Local development:

```bash
npm run live-smoke
```

Specific deployment:

```bash
npm run live-smoke -- --origin=https://YOUR-UNBOUND-DOMAIN --require-ready
```

JSON output:

```bash
npm run live-smoke -- --origin=https://YOUR-UNBOUND-DOMAIN --require-ready --json
```

The smoke checker uses GET requests only. It checks the health/readiness endpoints, the public homepage, the Adult Mode passkey script, camera/video script, media shortcut script, Terms page, and Privacy page. It does not invoke AI chat, billing, age-verification sessions, email delivery, or provider webhooks.

### Bounded load probe

Local development is allowed by default:

```bash
npm run load-probe
```

A remote target is deliberately blocked unless `--allow-remote` is provided:

```bash
npm run load-probe -- \
  --origin=https://YOUR-UNBOUND-DOMAIN \
  --allow-remote \
  --path=/healthz \
  --requests=20 \
  --concurrency=2 \
  --delay-ms=100
```

Hard safety limits are enforced in code:

- maximum 200 requests per invocation;
- maximum concurrency 10;
- GET only;
- allowed paths only: `/healthz`, `/readyz`, `/api/system/status`, `/`;
- no AI chat/provider endpoints;
- no billing or age-verification provider calls;
- no mutating endpoints.

This is a small capacity probe, **not a stress test**. Do not use Free-plan results as final production sizing evidence.

### Combined validation report

Configuration only:

```bash
npm run launch-validate
```

Configuration plus live smoke test:

```bash
npm run launch-validate -- \
  --origin=https://YOUR-UNBOUND-DOMAIN \
  --require-ready
```

Add the bounded capacity probe only when explicitly intended:

```bash
npm run launch-validate -- \
  --origin=https://YOUR-UNBOUND-DOMAIN \
  --require-ready \
  --load \
  --allow-remote-load \
  --requests=20 \
  --concurrency=2 \
  --delay-ms=100
```

Save a machine-readable report inside the current working directory:

```bash
npm run launch-validate -- \
  --origin=https://YOUR-UNBOUND-DOMAIN \
  --require-ready \
  --json \
  --output=validation/unbound-launch-validation.json
```

The report intentionally separates:

1. `codeAndRuntimeChecksPassed` — whether the requested live engineering checks passed;
2. `externalPrerequisitesReady` — whether the existing fail-closed launch prerequisites are genuinely verified;
3. `launchReady` — true only when the prerequisites and required live checks are all satisfied.

A healthy website can therefore never override a blocked bank/provider/legal/infrastructure requirement.

## Recommended zero-cost workflow

Before spending money:

1. Keep `npm run ci` green.
2. Run the local smoke checker while developing.
3. Run a remote smoke check after each Render deployment.
4. Record low-impact Free-plan latency as a baseline only.
5. Keep the no-spend launch preflight truthful and blocked where external work is still required.
6. After production infrastructure is purchased, repeat the same measurements and compare them with the Free baseline before choosing larger capacity.

## Security boundary

These tools must remain read-only with respect to the running application. If future validation requires account creation, billing, age verification, uploads, or AI-provider requests, implement that as a separate explicitly authorized rehearsal tool rather than weakening these safety limits.
