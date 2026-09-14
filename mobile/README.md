# UNBOUND AI Mobile

This directory contains the Capacitor-based Android and iOS shell for UNBOUND AI.

## Identity and origins

- Android package ID: `ai.unbound.app`
- iOS bundle ID: `ai.unbound.app`
- App name: `UNBOUND AI`
- Current hosted development/production web origin: `https://unbound-ai-app.onrender.com`

The native package identity is part of release validation. A copied shell using another package ID cannot produce valid UNBOUND release evidence or probe production API routes through the validation harness.

## Environments

`capacitor.config.ts` is environment-aware:

- `store` is the default and uses the generated local `www` bundle with no `server.url`/`allowNavigation` override.
- `remote-dev` explicitly loads the current Render origin for development only.

Use the explicit commands in `package.json`; do not turn the Render-backed remote shell into the store default.

## Local production-derived bundle

`npm run build:local-ui` builds `mobile/www` from the production web sources and writes a hashed manifest. `npm run verify:local-ui` verifies the generated pages, runtime scripts, mobile transformations, manifest hashes, native transport contract and native validation contract.

The local UI no longer depends on the old hosted-WebView shortcut for release. Native API/session transport is implemented by `runtime/native-api-bridge.js` and validated by `scripts/verify-native-api-transport.mjs`.

The transport contract preserves the existing authentication/session boundary instead of moving long-lived credentials into JavaScript-visible storage. Store release still requires real signed-device evidence proving the behavior works on actual Android and iOS builds.

## Native validation

`runtime/native-validation.js` and `native-validation.html` provide a local validation harness for signed-device testing.

Current report contract:

- report schema: `2`
- expected app ID: `ai.unbound.app`
- Android and iOS are both covered by contract tests
- non-native/web contexts fail closed
- wrong package identity fails closed
- wrong transport mode/origin fails before production API probing
- reports contain only safe app/build/status metadata and must not include account secrets, cookies, passwords, authorization headers or tokens

The validation harness checks native runtime, package identity, native API transport, API reachability, status/auth/session/account-access behavior and resume-related session behavior. Real-device evidence is still required; contract tests do not substitute for signed-device testing.

## Evidence-backed store release gate

The old editable HTML readiness marker is forbidden. `scripts/verify-store-shell.mjs` now uses evidence-backed validation.

Release evidence files are local and ignored by Git:

- `release-evidence/android.json`
- `release-evidence/ios.json`

Each evidence file must be tied to the exact generated bundle manifest SHA-256 and include a valid schema-v2 native validation report plus completed manual signed-device checks. Evidence expires after 30 days and the native validation report may not be more than 24 hours older than the manual evidence.

Required manual signed-device checks include password sign-in, session persistence, logout/revocation, passkeys, chat completion, account resume sync, checkout/provider return, age-verification provider return, failure recovery, custom-scheme deep linking, camera and microphone prompts, and permission-denial recovery.

Run:

```bash
npm run verify:release-evidence-contract
npm run verify:store-config
```

`verify:store-config` is expected to pass while confirming release remains blocked in CI. Normal `npm run verify:store-shell` and `npm run prepare:store` fail closed until both Android and iOS evidence are complete and valid for the exact bundle.

See `release-evidence/README.md` for the evidence schema and privacy rules.

## Branding, media and deep links

- `assets/logo.svg` is the committed native source mark.
- `npm run assets` generates Android/iOS branding assets after source verification.
- camera/microphone permissions are configured by `scripts/configure-media-permissions.mjs` and remain user-initiated only.
- the controlled custom scheme is `unbound:` and is configured by `scripts/configure-deep-links.mjs`.
- native deep-link routing rejects API/admin/external/credential-bearing/unsafe paths.

The camera permission is requested only when the user chooses a camera-dependent feature. The microphone permission is requested only when the user chooses a feature that records audio. UNBOUND must not start recording automatically, and denied/revoked permission paths must fail safely without blocking ordinary chat.

Verified HTTPS Universal Links / Android App Links still require the final production domain association plus final signing identities and real-device verification. That is external/signing work, not a repository shortcut.

## Native session resume

The native bridge compares safe UI-relevant account state at startup and when returning to the foreground. A confirmed `401` is treated as signed out; transient provider/network failures do not force sign-out. Material verified account/access changes trigger a same-origin reload so the existing authenticated web bootstrap can resynchronize the UI.

Real-device verification remains required for cookie persistence, password sign-in, passkeys, cross-device/session revocation, background/resume behavior and provider-return flows.

## Development commands

From `mobile/`:

```bash
npm install
npm run build:local-ui
npm run verify:local-ui
npm run verify:store-config
```

Remote-development native setup:

```bash
npm run add:android
npm run add:ios
npm run prepare:native
```

Store-safe generation after real evidence exists:

```bash
npm run prepare:store
```

Android builds require the Android toolchain. iOS/App Store builds require Xcode/macOS and the applicable Apple signing/store account.

## Current remaining mobile blockers

The code-side native transport, package-bound validation and evidence-backed release gate are implemented. The remaining store-release blockers are deliberately external/real-world: signed Android/iOS builds, real-device test evidence, final signing identities/store accounts, production provider-return testing, final privacy/store disclosures, and store review. Do not weaken the gate or invent evidence to make `prepare:store` pass.
