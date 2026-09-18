# UNBOUND AI

UNBOUND AI is an adults-only (18+) AI/SaaS platform with fast Casual Mode, deeper Work Mode, user-selectable modes, voice/media features, connected-app tooling, native Android/iOS shells, and explicit fail-closed launch controls.

The repository is intentionally conservative about launch claims. Code, mocks, credentials, or a healthy web process do not by themselves make a paid provider, bank, legal review, production backup, or mobile store release ready.

## Repository layout

- `app/` — Node/Express application, web UI, AI/chat, account/session, passkeys, age verification, billing, email, advertising, file/image/voice features, operational readiness and security controls.
- `mobile/` — Capacitor Android/iOS shell, production-derived local UI bundle, native API/session transport, media/deep-link setup, signed-device validation and evidence-backed store release gate.
- `docs/` — launch, provider, legal/data-flow, security, recovery and operations runbooks.
- `.github/workflows/` — production and native-mobile CI.

## Core validation

From `app/`:

```bash
npm install
npm run ci
npm run launch-preflight
npm run no-spend-complete
npm run launch-validate
```

`npm run ci` runs source, security, regression, backup and dependency-audit checks.

`npm run launch-preflight` reports the real commercial prerequisites and remains blocked until external dependencies are genuinely ready.

`npm run no-spend-complete` is the repository-side completion boundary. It fails if required free engineering/preparation artifacts or validation commands are missing. A green result means the remaining known launch blockers are external/provider/paid work; it does **not** mean the product is commercially launch-ready.

See:

- `docs/NO_SPEND_LAUNCH_PREP.md`
- `docs/NO_SPEND_COMPLETION.md`
- `docs/PROVIDER_APPLICATION_PACKET.md`
- `docs/ZERO_COST_LAUNCH_VALIDATION.md`
- `docs/LAUNCH_READINESS.md`
- `docs/LAUNCH_REHEARSAL.md`

## AI provider and Research Mode routing

Normal chat uses `AI_PROVIDER` (`openai`, `anthropic`, `google`, or `local`).

Research Mode may optionally use a separate sourced provider by setting:

```bash
AI_RESEARCH_PROVIDER=anthropic
ANTHROPIC_API_KEY=...
ANTHROPIC_MODEL_RESEARCH=claude-sonnet-5
```

or:

```bash
AI_RESEARCH_PROVIDER=openai
OPENAI_API_KEY=...
OPENAI_RESEARCH_MODEL=...
```

When `AI_RESEARCH_PROVIDER` is unset, Research Mode stays on the active provider and is available only when that provider natively supports UNBOUND's sourced-research contract. The route fails closed if the selected research provider is unsupported, lacks Research Mode capability, or is not configured.

Research routing does not change standard, Creative, Work, Adult, or streaming chat-provider selection. Cross-provider Research Mode also uses the research provider's own model configuration instead of reusing another provider's model ID.

Google Gemini chat and reasoning are supported, but Google-native Search grounding remains disabled until UNBOUND implements the required Google Search Suggestions display and associated storage/handling rules. Do not enable it by merely changing a capability flag.

### Optional transient provider failover

Normal non-Research chat can use an explicit backup provider:

```bash
AI_FALLBACK_PROVIDER=anthropic
ANTHROPIC_API_KEY=...
ANTHROPIC_MODEL_FALLBACK=claude-sonnet-5
```

Failover is attempted only for transient failures such as connection/time-out failures, rate limits, overloads, and provider-side 5xx responses. It does not activate for authentication/authorization failures, bad requests, unsupported capabilities, or configuration errors. Streaming failover is allowed only before any primary-provider output has reached the user; once visible output starts, UNBOUND preserves that stream and surfaces the error rather than restarting with a different provider.

Research Mode does not use this general failover path. It follows the explicit sourced-provider routing described above.

### Provider circuit breaker

When an explicit fallback provider is configured, UNBOUND also enables a bounded in-memory circuit breaker by default. Three consecutive transient primary-provider failures open the circuit for 60 seconds; requests during that cooldown route directly to the configured fallback. After cooldown, one half-open primary probe is allowed. A successful probe closes the circuit; another transient failure reopens it.

Optional tuning:

```bash
AI_PROVIDER_CIRCUIT_BREAKER_ENABLED=true
AI_PROVIDER_CIRCUIT_BREAKER_FAILURES=3
AI_PROVIDER_CIRCUIT_BREAKER_COOLDOWN_MS=60000
```

Failure thresholds are bounded to 1–10 and cooldowns to 10–300 seconds. Non-transient client/configuration/auth errors never open the circuit. Circuit state contains only availability metadata such as counts, timestamps, and sanitized error codes—never prompts, responses, credentials, or raw provider error text.

### Provider routing telemetry

UNBOUND keeps process-local, privacy-minimized AI routing telemetry for operations. It records aggregate provider attempts, successes, failures, retryable failures, latency buckets, failover counts, and circuit-bypass counts. It does not record prompts, response text, user identifiers, credentials, or raw provider error messages.

Detailed telemetry is exposed only through the admin operational status snapshot; public health/readiness responses keep provider telemetry out. The counters reset whenever the application process restarts. This is operational diagnostics, not billing or user analytics.

### Provider request deadlines

UNBOUND applies one total deadline to each provider operation so a hung upstream cannot block chat indefinitely before failover/circuit logic runs.

Defaults:

- ordinary chat: 45 seconds
- streaming: 120 seconds
- Research Mode: 180 seconds
- file analysis: 180 seconds

Optional tuning:

```bash
AI_PROVIDER_TIMEOUT_MS=45000
AI_PROVIDER_STREAM_TIMEOUT_MS=120000
AI_RESEARCH_TIMEOUT_MS=180000
AI_FILE_ANALYSIS_TIMEOUT_MS=180000
```

All values are bounded to 5–300 seconds. Fetch-based providers receive an abort signal for the full operation, including stream/body reading and Anthropic research continuations. OpenAI requests use the same UNBOUND deadline and set SDK retries to zero so transient failures reach UNBOUND's failover/circuit layer without hidden retry delays.

### Provider concurrency bulkheads

UNBOUND isolates provider capacity with a separate in-memory bulkhead for each AI provider. By default, each provider allows up to 16 in-flight operations and a queue of up to 64 waiting operations. A queued request waits no longer than 2.5 seconds before it is rejected locally.

Generic tuning:

```bash
AI_PROVIDER_MAX_CONCURRENT=16
AI_PROVIDER_MAX_QUEUE=64
AI_PROVIDER_QUEUE_TIMEOUT_MS=2500
```

Provider-specific overrides use `OPENAI_`, `ANTHROPIC_`, `GEMINI_`, or `LOCAL_AI_` with the same suffixes, for example `OPENAI_MAX_CONCURRENT=24`. Concurrency is bounded to 1–128, queue size to 0–512, and queue wait to 100–30000 ms.

Bulkhead saturation is treated as local admission pressure, not proof that the upstream provider is unhealthy. Normal chat may fail over to a configured fallback when the primary bulkhead rejects or times out, but those local events do not increment the provider circuit breaker. Live active/queued counts are exposed only in admin operational diagnostics.

## Mobile

From `mobile/`:

```bash
npm install
npm run build:local-ui
npm run verify:local-ui
npm run verify:store-config
```

The store-safe bundle uses local production-derived assets and native API/session transport. Release remains fail-closed until real signed Android and iOS evidence for the exact generated bundle is present and valid. See `mobile/README.md` and `mobile/release-evidence/README.md`.

## Current launch boundary

Repository-side preparation includes integrations and contract coverage for production infrastructure/recovery, Segpay, Yoti hard-18+ verification, Amazon SES, legal/data-flow review, ClamAV, and native mobile release validation.

The remaining commercial-release blockers must stay truthful: real production infrastructure and backups, business-bank/provider approvals, production credentials/configuration and end-to-end verification, qualified legal/compliance review, private malware-scanning infrastructure, and real signed-device/store evidence.

Do not bypass these gates by hard-coding ready states, inventing timestamps/evidence, committing secrets, weakening age verification, or publishing draft legal text as final.
