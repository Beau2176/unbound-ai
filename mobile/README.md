# UNBOUND AI Mobile

This directory contains the native mobile shell for UNBOUND AI using Capacitor.

## Current target

- Android package ID: `ai.unbound.app`
- iOS bundle ID: `ai.unbound.app`
- App name: `UNBOUND AI`
- Production web origin: `https://unbound-ai-app.onrender.com`

## First local setup

From the `mobile` directory:

```bash
npm install
npm run add:android
npm run add:ios
npm run prepare:native
```

Open the native projects with:

```bash
npm run android
npm run ios
```

Android builds require Android Studio. iOS/App Store builds require Xcode on macOS.

## Official native branding

`assets/logo.svg` is the committed native source mark for UNBOUND AI. It is a small-screen adaptation of the approved blue-and-gold infinity branding: symbol-only, dark-backed, self-contained, and free of small text that would be clipped by Android/iOS icon masks.

The asset workflow uses the recommended `@capacitor/assets` single-logo mode. `npm run assets` verifies the source and generates Android and iOS resources separately on the same `#030810` dark background. Platform-specific commands are also available as `npm run assets:android` and `npm run assets:ios`.

`mobile/scripts/verify-brand-assets.mjs` fails closed if the source is missing, replaced by a tiny placeholder, loses the approved dark/blue/gold identity, contains text, or introduces executable/external SVG references. Mobile Native CI runs this verification before generating either native scaffold.

The source mark is now prepared in-repo. Store submission still requires visual inspection of the generated icon/splash resources on real Android and iOS devices and in the respective store preview tooling.

## Camera and video capture

The hosted UNBOUND chat now exposes PHOTO and VIDEO controls. The web layer requests camera/microphone access only after the user taps one of those controls.

The current hosted/remote shell relies on normal browser/WebView media permission handling. When Capacitor generates the real native Android and iOS projects, verify the generated native applications explicitly include and correctly request the permissions needed for the features that are actually enabled:

- Android: camera permission for photo/video capture and microphone permission for video recording with audio.
- iOS: camera-use and microphone-use purpose strings that accurately describe UNBOUND's user-initiated capture feature.
- WebView/native container: permission prompts must be tied to a user action and denied permissions must fail safely without blocking normal chat.

Do not add broad background camera/microphone permissions. UNBOUND must not start recording automatically or while the capture UI is closed.

Photo capture can fall back to the device/browser image picker when direct camera access is unavailable. Recorded raw video currently remains local to the browser; UNBOUND extracts representative visual frames for Premium image-understanding analysis. Full motion/audio video AI understanding and AI video editing require a separately approved provider and are not yet claimed as active.

## Device Inspector

The local `@unbound/device-inspector` Capacitor plugin provides user-authorized Android device diagnostics to the web shell. It reports system resource totals, visible launcher apps, and processes Android allows the app to see. It does not request `QUERY_ALL_PACKAGES`, does not bypass Android sandboxing, and does not read another app's private files, passwords, tokens, cookies, or credentials.

Run `npm install` and `npm run sync` after plugin changes so Capacitor registers the native plugin.

## Deep-link routing boundary

The hosted native bridge already listens for Capacitor `appUrlOpen` events. App-side routing is intentionally fail-closed:

- HTTPS links are accepted only for the current UNBOUND web host / production UNBOUND host.
- The controlled `unbound:` custom scheme is accepted only for known aliases or explicitly allowed public routes.
- Public deep-link routes are limited to `/`, `/index.html`, `/terms.html`, `/privacy.html`, `/advertisers.html`, and `/connected-apps.html`.
- `/api/*`, admin pages, advertising-admin pages, external hosts, HTTP links, credential-bearing URLs, custom ports, traversal-style paths, and oversized URLs are rejected instead of being loaded inside the native WebView.
- Blocked links emit a local `unbound:deep-link-blocked` diagnostic event without exposing the rejected URL in the event payload.

This completes the app-side routing guard. It does **not** register Android intent filters, an iOS URL scheme, Universal Links, or Android App Links. Those platform declarations must be added and verified in the generated native projects before public store submission.

## Native session resume synchronization

The hosted native bridge now takes a non-sensitive snapshot of UI-relevant account state after startup and checks it again when the app returns to the foreground.

- A real `401` from `/api/auth/me` is treated as a confirmed signed-out state, so a session that expired or was revoked on another device is reflected when the app resumes.
- For signed-in accounts, the snapshot tracks identity/role, effective plan, subscription state, hard-18+ verification state, provider availability, and capability access that materially changes the visible UNBOUND interface.
- If that verified state changed while the app was backgrounded, the bridge performs one same-origin page reload. The normal UNBOUND page bootstrap then reloads the current user, access level, controls, and conversation scope through the existing web authentication flow.
- Temporary network failures, database/provider outages, malformed responses, or an unavailable `/api/account/access` response do not create a signed-out snapshot and do not force a reload.
- The bridge emits a local `unbound:native-session-changed` event containing only a generic reason before resynchronization; it does not place session tokens or account details in the diagnostic event.

This prepares the resume/session behavior in code, but real-device validation is still required for cookie persistence, password sign-in, passkeys, account revocation from another device, background/resume behavior, and provider-return flows on both Android and iOS.

## Store-readiness work still required

Before public submission, replace the remote-server development configuration with a production mobile bundle or approved native navigation strategy, visually validate the generated native icon/splash resources, register and verify Android/iOS deep-link declarations, validate authentication/session and passkey behavior on real devices, complete age-verification and privacy disclosures, configure subscription/payment handling for each store, verify camera/microphone permission prompts on real devices, and run device/store-review testing.

The existing web service remains separate from this folder so mobile development does not change Render's current start/build commands.
