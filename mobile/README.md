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
npm run sync
```

Open the native projects with:

```bash
npm run android
npm run ios
```

Android builds require Android Studio. iOS/App Store builds require Xcode on macOS.

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

## Store-readiness work still required

Before public submission, replace the remote-server development configuration with a production mobile bundle or approved native navigation strategy, add final icons and splash assets, register and verify Android/iOS deep-link declarations, verify authentication/session behavior in the native container, complete age-verification and privacy disclosures, configure subscription/payment handling for each store, verify camera/microphone permission prompts on real devices, and run device/store-review testing.

The existing web service remains separate from this folder so mobile development does not change Render's current start/build commands.
