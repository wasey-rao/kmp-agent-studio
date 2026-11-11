---
name: kmp-release-and-policy
description: Getting a Kotlin Multiplatform app ready for Google Play and the App Store - versioning, signing without committing secrets, R8 and keep rules for serialization and SDKs, release build verification, manifest and permission audit, Play policy points for ads, purchases and data, the Data safety form, and a release checklist. Use when preparing a release build, configuring signing or R8, or checking store policy compliance.
---

# Release and store policy for a KMP app

## Versioning
- `versionCode` (integer, always increasing) and `versionName` are defined once, in `gradle.properties` or the version catalog, and read by `androidApp`. Use the same marketing version for the iOS target.
- Every upload to Play needs a higher `versionCode` than any previous upload, including ones that were never rolled out.

## Signing
- Never create, commit or print keystores or passwords. The agent's job is configuration; the key belongs to the user.
- Read signing values from `local.properties` or environment variables, and skip the signing config when they are absent so debug builds and CI still work:
```kotlin
val keystoreProps = Properties().apply { rootProject.file("local.properties").takeIf { it.exists() }?.inputStream()?.use(::load) }
signingConfigs {
    create("release") {
        keystoreProps.getProperty("release.storeFile")?.let { storeFile = file(it) }
        storePassword = keystoreProps.getProperty("release.storePassword")
        keyAlias = keystoreProps.getProperty("release.keyAlias")
        keyPassword = keystoreProps.getProperty("release.keyPassword")
    }
}
```
- Provide `local.properties.example` with the key names and no values. Recommend Play App Signing so the upload key can be reset if lost.
- Upload format is an Android App Bundle: `./gradlew :androidApp:bundleRelease`.

## R8
- Release build type: `isMinifyEnabled = true`, `isShrinkResources = true`, with `proguard-android-optimize.txt` plus the app's own rules file.
- Most libraries ship consumer rules. Add rules only for a demonstrated need, and keep them narrow (a class or a package's serializers, never `-keep class com.example.** { *; }`).
- Things that usually need attention in this stack:
  - `kotlinx.serialization`: recent versions ship their own rules; classes found through reflection or `@Serializable` types referenced only by name still need a keep.
  - Navigation 3 keys are `@Serializable`; verify navigation and state restore in a release build.
  - Room, Ktor, Koin, Firebase, Play Billing and the ads SDK bundle their rules.
- A release build that was not launched has not been verified. After R8 changes, install the release build and walk the main flow, including a purchase screen and an ad load. If no device or keystore is available, say so.
- If Google's `r8-analyzer` skill is installed, use it to audit keep rules.

## Manifest and permissions
- Request only permissions the spec needs. The ads SDK adds `AD_ID`; remove it only if the app is child-directed, and say so.
- `android:exported` is set explicitly on every component and is `false` unless there is a reason.
- No cleartext traffic. `allowBackup` and data extraction rules are deliberate: purchases state and tokens are excluded from backup.
- `targetSdk` meets the current Play requirement (the researcher checks the current level).

## Policy points that get apps rejected
**Ads**
- No interstitial on launch, on exit, or interrupting a task. No ads that resemble app UI. No banner overlapping content or sitting where taps are accidental.
- A consent flow (UMP) runs before personalised ads where it is required.
- Apps aimed at children have separate, stricter ad rules; flag it if the spec suggests a young audience.

**Purchases**
- Digital goods use the store's billing system. The price, billing period and renewal terms are shown before purchase, with restore, terms and privacy links.
- Cancelling must be explained, and nothing is unlocked by a misleading free trial flow.

**Data and accounts**
- A privacy policy URL is required once the app uses ads, analytics or accounts.
- The Data safety form must match what the SDKs actually collect. Draft a table per SDK (data type, collected or shared, purpose, optional or required) from each SDK's published disclosure.
- Apps with account creation must offer account deletion in-app and through a web link.
- iOS: App Tracking Transparency prompt before any tracking, and privacy manifest entries for the SDKs in use.

If Google's `play-policy-insights` skill is installed, run it for a deeper audit.

## Release checklist (`.studio/release-checklist.md`)
**Build**
- [ ] Version code and name bumped
- [ ] Release bundle builds with R8 and resource shrinking
- [ ] Release build installed and main flow walked
- [ ] No debug logging, test ad IDs or debug menus reachable in release
- [ ] Crash reporting enabled in release, mapping file upload configured

**Monetization**
- [ ] Real ad unit IDs supplied through build config
- [ ] Consent flow verified with the UMP debug geography setting
- [ ] Products active in Play Console, purchase tested with a license tester
- [ ] Entitlements restored after reinstall

**Store**
- [ ] Privacy policy URL, Data safety form, content rating, ads declaration
- [ ] Listing text and screenshots
- [ ] Internal testing track upload before production

Sort each item into Done, Verified by reading only, or Needs the user. Publishing is always the user's action.
