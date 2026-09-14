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

## Device Inspector

The local `@unbound/device-inspector` Capacitor plugin provides user-authorized Android device diagnostics to the web shell. It reports system resource totals, visible launcher apps, and processes Android allows the app to see. It does not request `QUERY_ALL_PACKAGES`, does not bypass Android sandboxing, and does not read another app's private files, passwords, tokens, cookies, or credentials.

Run `npm install` and `npm run sync` after plugin changes so Capacitor registers the native plugin.

## Store-readiness work still required

Before public submission, replace the remote-server development configuration with a production mobile bundle or approved native navigation strategy, add final icons and splash assets, configure deep links, verify authentication/session behavior in the native container, complete age-verification and privacy disclosures, configure subscription/payment handling for each store, and run device/store-review testing.

The existing web service remains separate from this folder so mobile development does not change Render's current start/build commands.
