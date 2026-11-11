---
name: kmp-firebase
description: Firebase in a Kotlin Multiplatform app - choosing between the GitLive multiplatform wrappers and native SDKs behind interfaces, Android and iOS project setup, Analytics, Crashlytics, Remote Config, Auth, Firestore and Cloud Messaging, and keeping config files out of source control. Use when adding or reviewing any Firebase product in a KMP or Compose Multiplatform app.
---

# Firebase in a KMP app

Firebase publishes native SDKs for Android and Apple platforms, not a Kotlin Multiplatform one. There are two ways to use it from shared code.

## Choose the route
| Route | How | Use when |
| --- | --- | --- |
| **A. GitLive wrappers** (`dev.gitlive:firebase-*`) | Kotlin-first API callable from `commonMain`, backed by the native SDKs on each platform | Analytics, Remote Config, Auth, Firestore, Crashlytics logging from shared code. The default. |
| **B. Interface + native SDK** | Interface in `commonMain`, Android implementation in `androidMain`, iOS implementation in Swift | A product or API the wrappers do not cover, or when the wrapper lags behind a feature you need |

With either route, wrap Firebase behind your own small interfaces (`Analytics`, `RemoteConfig`, `CrashReporter`). ViewModels depend on those, never on Firebase types, and tests use fakes. The researcher must confirm the wrapper version and which native Firebase version it expects.

## Setup
**Android (`androidApp`)**
- Apply the Google services Gradle plugin, and the Crashlytics Gradle plugin if Crashlytics is used.
- `google-services.json` goes in `androidApp/`. Its package name must match `applicationId`, including any debug suffix.
- With route B, add the Firebase BoM and the product libraries to `androidMain`.

**iOS (`iosApp`)**
- Add `firebase-ios-sdk` with Swift Package Manager in Xcode and select the same products you use on Android. The GitLive wrappers do not bundle the native frameworks; the app must link them.
- Add `GoogleService-Info.plist` to the app target.
- Call `FirebaseApp.configure()` in the Swift `App` initializer, before the shared code starts.
- Crashlytics needs the dSYM upload run script build phase.

**Both config files are secrets-adjacent and project-specific.** They are in `.gitignore`. If they are missing, do not invent them: add the step to `.studio/setup-needed.md`, and keep debug builds compiling where the plugin allows it. If Firebase MCP tools are available in the session, they can create the Firebase apps and fetch the SDK config, but only after the user approves, since that changes their Firebase project.

## Product rules
**Analytics**
- One `Analytics` interface with `logEvent(name, params)` and `setUserProperty`. Event names are constants in one file, snake_case, 40 characters or fewer.
- Log screen views from the navigation layer in one place, not in each screen.
- Never log personal data (email, name, free text the user typed).
- Respect consent: analytics collection is switched on only after the consent flow allows it.

**Crashlytics**
- Record non-fatal errors at the data-layer boundary where exceptions are mapped to `AppError`.
- Set custom keys for app state that helps triage; never include personal data.
- Disable collection in debug builds.

**Remote Config**
- Every key has an in-app default, so the app behaves correctly with no network on first launch.
- Fetch and activate at startup without blocking the first frame; apply new values on the next launch unless the spec needs live updates.
- Typical keys for this studio: interstitial frequency cap, which placements are enabled, paywall variant. Keep key names in one file.

**Auth and Firestore**
- Expose auth state as a `Flow` from a repository; map Firebase exceptions to `AppError`.
- Firestore DTOs live in the data layer and are mapped to domain models. Security rules are part of the feature: an open rule set is a blocking review finding.
- If the app has accounts, account deletion must be available in-app (store policy).

**Cloud Messaging**
- Android: a `FirebaseMessagingService` in `androidApp`, a notification channel, and the `POST_NOTIFICATIONS` runtime permission on Android 13 and later, requested in context rather than at launch.
- iOS: push capability, APNs key uploaded in the Firebase console, and permission requested from Swift.
- Token refresh goes through a shared repository if a backend needs the token.

## Review checklist
- [ ] No Firebase type in a ViewModel or in `domain`.
- [ ] Config files are ignored by git and documented in the setup guide.
- [ ] Collection for Analytics and Crashlytics follows consent and is off in debug.
- [ ] Remote Config has defaults for every key.
- [ ] No personal data in events, keys or logs.
