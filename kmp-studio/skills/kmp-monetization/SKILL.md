---
name: kmp-monetization
description: Monetization logic for a Kotlin Multiplatform app that sits above the ad and billing SDKs - the UMP consent flow and its ordering with ads initialization, remote-config-driven ad placement and frequency caps, entitlement-aware ad gating, paywall and subscription patterns, and the analytics events that measure them. Use when wiring consent, deciding when ads show, building a paywall, or adding monetization analytics.
---

# Monetization patterns for a KMP app

The SDK integrations are covered by `kmp-ads-next-gen` and `kmp-play-billing`. This skill covers the shared logic that decides **when** to show ads and **what** the user has paid for. Almost all of it belongs in `commonMain` and is unit-testable.

## Startup order
```
App start
  -> load cached entitlements (DataStore)          instant, offline
  -> if ads are not removed: run consent flow      may show a form
       -> when ads can be requested: initialize ads SDK, preload first placements
  -> refresh entitlements from the store           corrects the cache
  -> fetch Remote Config                           never blocks the first frame
```
Nothing in this chain may delay the first screen. Each step is failure-tolerant and independent.

## Consent (UMP)
Shared contract:
```kotlin
interface ConsentManager {
    suspend fun gatherConsent(): Boolean        // true when ads can be requested
    val privacyOptionsRequired: Boolean         // show a "Privacy settings" entry if true
    suspend fun showPrivacyOptions()
}
```
Android implementation (`com.google.android.ump:user-messaging-platform`), on every app launch:
1. `consentInformation.requestConsentInfoUpdate(activity, params, onSuccess, onFailure)`
2. on success, `UserMessagingPlatform.loadAndShowConsentFormIfRequired(activity) { ... }`
3. then check `consentInformation.canRequestAds()`; initialize and load ads only when it is true.

Rules:
- Also check `canRequestAds()` right away using the consent stored from the previous session, so returning users are not delayed by the network call.
- Initialize the ads SDK once, guarded by an atomic flag, since both paths can reach it.
- If `privacyOptionsRequirementStatus` is `REQUIRED`, the settings screen must offer the privacy options form.
- A consent error is not a reason to block the app; continue without ads for that session if ads cannot be requested.
- Test with the UMP debug settings (debug geography and a test device hash), in debug builds only.
- iOS uses the UMP iOS SDK plus the App Tracking Transparency prompt, implemented in Swift behind the same interface.

## Ad gating in one place
```kotlin
class AdPolicy(
    private val entitlements: StateFlow<Entitlements>,
    private val config: MonetizationConfig,       // from Remote Config, with defaults
    private val clock: Clock,
) {
    private var lastInterstitialAt: Instant? = null
    private var actionsSinceLast = 0

    fun bannersEnabled(placement: AdPlacement) = !entitlements.value.adsRemoved && placement in config.enabledPlacements

    fun shouldShowInterstitial(placement: AdPlacement): Boolean {
        if (entitlements.value.adsRemoved || placement !in config.enabledPlacements) return false
        actionsSinceLast++
        val cooledDown = lastInterstitialAt?.let { clock.now() - it >= config.interstitialCooldown } ?: true
        return cooledDown && actionsSinceLast >= config.actionsBetweenInterstitials
    }
    fun onInterstitialShown() { lastInterstitialAt = clock.now(); actionsSinceLast = 0 }
}
```
- ViewModels ask `AdPolicy`, then call `AdsManager`. No screen contains frequency logic.
- When `adsRemoved` becomes true, banners disappear immediately because the UI observes `entitlements`, and no further ad requests are made.
- New users get a grace period: no interstitial in the first session or before the first completed task.

## Remote Config keys (all with in-app defaults)
| Key | Type | Default | Meaning |
| --- | --- | --- | --- |
| `ads_enabled_placements` | string list | all spec placements | Kill switch per placement |
| `interstitial_cooldown_sec` | long | 60 | Minimum time between interstitials |
| `interstitial_action_interval` | long | 3 | Completed actions between interstitials |
| `app_open_ad_enabled` | boolean | false | App-open ads on warm start |
| `paywall_variant` | string | `default` | Which paywall layout to show |

Defaults are conservative: fewer ads, not more.

## Paywall
- A paywall is an ordinary screen with its own ViewModel: state holds products (with store-formatted prices), the selected product, and a `purchasing` flag.
- Triggers: tapping a locked feature, a "Remove ads" entry in settings, and at most one soft prompt after a meaningful success moment. Never on first launch before the user has seen the app.
- Required on screen: what is unlocked, price and period per product, renewal terms for subscriptions, restore, terms, privacy, and an obvious way to close.
- After a successful purchase the paywall closes itself by observing `entitlements`, not by trusting the purchase callback alone.
- A pending purchase shows a "waiting for payment" message and unlocks nothing.

## Analytics events (names in one constants file)
| Event | Parameters |
| --- | --- |
| `ad_impression_custom` | `placement`, `format` |
| `ad_load_failed` | `placement`, `format`, `error_code` |
| `rewarded_completed` | `placement` |
| `paywall_view` | `source`, `variant` |
| `purchase_start` | `product_id`, `source` |
| `purchase_success` | `product_id`, `source` |
| `purchase_cancel` | `product_id` |
| `purchase_error` | `product_id`, `error_code` |
| `consent_result` | `can_request_ads` |

No personal data in parameters. The stores and SDKs report revenue themselves; these events exist to explain funnels.

## Tests to write
`AdPolicy` is pure logic: cover the cooldown, the action interval, disabled placements, the ads-removed case and the new-user grace period with a fake clock. Cover paywall ViewModel states for success, cancel, pending and error with a fake `BillingRepository`.
