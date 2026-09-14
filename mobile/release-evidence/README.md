# UNBOUND AI mobile release evidence

`prepare:store` is intentionally fail-closed until both `android.json` and `ios.json` contain fresh evidence from signed real-device builds that match the exact generated `www/unbound-local-bundle-manifest.json`.

The two evidence JSON files are local release artifacts and are ignored by Git. Do not commit account data, credentials, cookies, authorization headers, tokens, email addresses, screenshots, or provider payloads.

Each platform evidence file must contain only:

```json
{
  "schemaVersion": 1,
  "platform": "android",
  "signedBuild": true,
  "testedAt": "2026-09-14T00:00:00.000Z",
  "bundleManifestSha256": "<sha256 of www/unbound-local-bundle-manifest.json>",
  "validationReport": "<the safe report copied from native-validation.html>",
  "manualChecks": {
    "passwordSignIn": true,
    "sessionPersistence": true,
    "logoutRevocation": true,
    "passkeyAuthentication": true,
    "chatCompletion": true,
    "accountResumeSync": true,
    "checkoutProviderReturn": true,
    "ageVerificationProviderReturn": true,
    "failureRecovery": true,
    "customSchemeDeepLink": true,
    "cameraPermissionPrompt": true,
    "microphonePermissionPrompt": true,
    "permissionDenialRecovery": true
  }
}
```

For iOS, set `platform` to `ios`. `validationReport` is the JSON object copied from the packaged Native Validation page, not a string. The report must use schema v2, identify `ai.unbound.app`, be signed in, have `overall: "pass"`, and show every required native/session check as `pass`.

Evidence expires after 30 days and is rejected if it targets a different generated bundle, package ID, platform, API origin, or validation schema. The native report must be no more than 24 hours older than the manual evidence completion time.

The old `<meta name="unbound-production-bundle" content="ready">` shortcut is forbidden and no longer unlocks store preparation.
