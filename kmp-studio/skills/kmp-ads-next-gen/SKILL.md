---
name: kmp-ads-next-gen
description: Integrating the Google Mobile Ads Next-Gen SDK (ads-mobile-sdk) into a Kotlin Multiplatform app - the shared AdsManager contract, Android implementation rules (initialization, background-thread callbacks, per-format requests, banners in Compose), the iOS side, test ad unit IDs and failure handling. Use when adding banner, interstitial, rewarded, native or app-open ads, or reviewing ad code. Not for the legacy play-services-ads SDK.
---

# Google Mobile Ads Next-Gen SDK in a KMP app

Use the Next-Gen SDK, `com.google.android.libraries.ads.mobile.sdk:ads-mobile-sdk`. Do not add the legacy `com.google.android.gms:play-services-ads`; if a mediation adapter pulls it in transitively, exclude `play-services-ads` and `play-services-ads-lite` to avoid duplicate classes.

The SDK is Android-only. Shared code sees an interface; the SDK lives in `androidMain`.

## Shared contract (`commonMain`)
```kotlin
enum class AdPlacement { HomeBanner, AfterSave, ExtraLives /* one per spot in the spec */ }

sealed interface AdShowResult { data object Shown : AdShowResult; data object NotReady : AdShowResult; data class Failed(val reason: String) : AdShowResult }

interface AdsManager {
    suspend fun initialize()                         // safe to call more than once
    fun preload(placement: AdPlacement)
    suspend fun showInterstitial(placement: AdPlacement): AdShowResult
    suspend fun showRewarded(placement: AdPlacement): Boolean   // true only if the reward was earned
}

@Composable expect fun BannerAd(placement: AdPlacement, modifier: Modifier = Modifier)
```
ViewModels call `AdsManager`; they never see an SDK type or an `Activity`. Placement to ad-unit-ID mapping lives in one Android file fed by build config.

## Android rules
1. **Manifest**: keep the `com.google.android.gms.ads.APPLICATION_ID` meta-data tag in `androidApp`. The Next-Gen SDK takes the app ID in code, but the tag is still needed by the UMP consent SDK.
2. **Initialize once, off the main thread**, before any other SDK call: `MobileAds.initialize(context, InitializationConfig.Builder(appId).build()) { }` from a background dispatcher. Put any `RequestConfiguration` (test devices, child-directed settings) into the `InitializationConfig` builder rather than setting it separately beforehand.
3. **Consent first**: initialize and request ads only after the consent flow says ads can be requested (see `kmp-monetization`).
4. **Requests are per format** and carry the ad unit ID: `AdRequest.Builder(adUnitId)` for interstitial, rewarded and app open, `BannerAdRequest.Builder(adUnitId, adSize)` for banners, `NativeAdRequest.Builder(...)` for native. `load()` does not take an `Activity`.
5. **Callbacks arrive on background threads.** Anything that touches UI, Compose state or a ViewModel must switch to the main dispatcher first. Skipping this crashes.
6. **Events**: set the format's `adEventCallback` (for example `InterstitialAdEventCallback`) before showing. Full-screen errors are `FullScreenContentError`.
7. **Showing needs an Activity**: keep a small `CurrentActivityProvider` in `androidMain` (registered with `ActivityLifecycleCallbacks`, holding a weak reference) and resolve it at show time. Never store an Activity in a singleton.
8. **One load at a time per placement.** A full-screen ad is single use: after it is dismissed or fails to show, drop it and preload the next one.
9. **Banner in Compose**: wrap the SDK's `banner.AdView` in `AndroidView`, use an anchored adaptive size computed from the available width, reserve that height before the ad loads, and call `destroy()` in `onRelease`.
10. **Never block the user on an ad.** `showInterstitial` returns `NotReady` immediately if nothing is loaded and the app continues.

The exact class and method names differ from the legacy SDK in many places. Before writing code, check the current guide at `developers.google.com/admob/android/next-gen` for the version in the catalog. If Google's `google-mobile-ads-android-migrate-to-next-gen` skill is installed, its mapping tables list every renamed class and signature.

## Test ad units (debug builds only)
| Format | Android test unit ID |
| --- | --- |
| App ID | `ca-app-pub-3940256099942544~3347511713` |
| Adaptive banner | `ca-app-pub-3940256099942544/9214589741` |
| Interstitial | `ca-app-pub-3940256099942544/1033173712` |
| Rewarded | `ca-app-pub-3940256099942544/5224354917` |
| Native | `ca-app-pub-3940256099942544/2247696110` |
| App open | `ca-app-pub-3940256099942544/9257395921` |

Debug builds use these through `BuildConfig` or a product flavor. Real IDs are supplied by the user and never hardcoded next to the test ones. Clicking your own live ads gets an AdMob account suspended.

## iOS
The iOS Google Mobile Ads SDK is a Swift/Objective-C library added to `iosApp` with Swift Package Manager. Implement `AdsManager` in Swift and pass it into the shared code at startup (see `kmp-ios-integration`); `BannerAd`'s iOS actual wraps the native banner view with `UIKitView`. If the architecture marks iOS ads as a stub for the MVP, provide a no-op `AdsManager` and an empty `BannerAd` so shared code is unchanged.

## Placement policy
- Interstitials only at natural breaks, never on app launch, on exit, or during a task. Apply a frequency cap from remote config.
- Banners never overlap content or navigation and never sit next to tappable controls where a mis-tap is likely.
- Rewarded ads are always opt-in with the reward stated up front.
- Users who bought "remove ads" get no ad requests at all: `AdsManager` checks entitlement before loading.

## Review checklist
- [ ] No SDK import outside `androidMain`.
- [ ] Initialization happens once, off the main thread, after consent.
- [ ] Every callback hops to the main dispatcher before touching state.
- [ ] Load failures are handled and never retried in a tight loop.
- [ ] Test IDs in debug, real IDs only from build config.
- [ ] Banner `AdView` is destroyed when it leaves composition.
