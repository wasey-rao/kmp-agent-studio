---
name: kmp-play-billing
description: In-app purchases and subscriptions in a Kotlin Multiplatform app - the shared BillingRepository contract and entitlement model, Google Play Billing Library rules on Android (connection, product details, purchase flow, pending purchases, acknowledgement, restoring), StoreKit on iOS, and testing. Use when adding remove-ads purchases, consumables, subscriptions or a paywall, or reviewing purchase code.
---

# Purchases in a KMP app (Play Billing + StoreKit)

Billing SDKs are platform-specific. Shared code owns the **entitlement model** and the paywall logic; each platform owns the store conversation.

## Shared contract (`commonMain`)
```kotlin
data class StoreProduct(val id: String, val title: String, val price: String, val type: ProductType, val offerToken: String? = null)
enum class ProductType { OneTime, Consumable, Subscription }

data class Entitlements(val adsRemoved: Boolean = false, val premium: Boolean = false)

sealed interface PurchaseResult {
    data object Success : PurchaseResult
    data object Pending : PurchaseResult      // paid later (cash, approval); do not grant yet
    data object Cancelled : PurchaseResult
    data class Error(val message: String) : PurchaseResult
}

interface BillingRepository {
    val entitlements: StateFlow<Entitlements>             // single source of truth for "what is unlocked"
    suspend fun products(ids: List<String>): List<StoreProduct>
    suspend fun purchase(productId: String): PurchaseResult
    suspend fun refresh()                                 // re-read owned purchases from the store
}
```
- Features read `entitlements`; they never ask the store directly.
- Cache the last known entitlements locally (DataStore) so the app starts in the right state offline, then correct it from the store.
- The displayed price is always the formatted string from the store, never a hardcoded amount.

## Android: Play Billing Library rules
Use `com.android.billingclient:billing-ktx` at the latest stable version from `.studio/research.md`. Major versions remove APIs, so confirm signatures against the release notes for the version in the catalog.

1. **One `BillingClient`** for the app's lifetime, built with a `PurchasesUpdatedListener`, pending purchases enabled (`enablePendingPurchases(PendingPurchasesParams.newBuilder().enableOneTimeProducts().build())`), and automatic service reconnection enabled where the library version offers it. Without auto-reconnect, reconnect with backoff in `onBillingServiceDisconnected` and before each call.
2. **Query product details** with `QueryProductDetailsParams`, one product type per query (`INAPP` or `SUBS`). Subscriptions expose offers; the purchase needs the chosen offer's `offerToken`.
3. **Launch the flow** with `launchBillingFlow(activity, params)` from the current Activity, on the main thread. The result does not come back from this call; it arrives in `PurchasesUpdatedListener`.
4. **Handle every purchase state**: `PURCHASED` grants, `PENDING` does not grant yet, and the user may complete it hours later outside the app.
5. **Acknowledge or consume every purchase.** Non-consumables and subscriptions must be acknowledged; consumables are consumed. A purchase left unacknowledged for three days is refunded automatically by Google.
6. **Re-query owned purchases** with `queryPurchasesAsync` on app start and on every resume. Purchases can be made on another device, completed from pending, or refunded while the app was closed. This is also how "restore purchases" works on Android.
7. **Verify** before granting anything valuable. The robust way is a backend that checks the purchase token with the Play Developer API. For a small remove-ads purchase without a backend, at minimum check the purchase signature and state, and say in the report that there is no server verification.
8. **Map response codes** to user-meaningful results: `USER_CANCELED` is not an error, `ITEM_ALREADY_OWNED` means refresh and grant, `SERVICE_DISCONNECTED` and `BILLING_UNAVAILABLE` are retryable.
9. The listener may fire on any thread; update `entitlements` in a thread-safe way.

If Google's `play-billing-library-version-upgrade` skill is installed, use it when moving an existing project to a newer library version.

## iOS
Use StoreKit 2 from Swift: implement `BillingRepository` in `iosApp`, listen to `Transaction.updates` for the app's lifetime, finish every transaction, and compute entitlements from `Transaction.currentEntitlements`. Pass the implementation into shared code at startup (see `kmp-ios-integration`). iOS requires a visible "Restore purchases" action.

If the team wants one purchase codebase and server-side receipt checking without their own backend, a cross-platform purchases SDK with a KMP library is a reasonable alternative. That is an architecture decision for the architect to record, not something to adopt silently.

## Paywall rules (both stores)
- Show the price, the billing period and what renews, next to the purchase button.
- Provide restore, terms and privacy links on the paywall.
- Never unlock from a client-side flag alone that the user could set; unlock from `entitlements`.
- Handle the purchase button being tapped twice: disable it while a flow is in progress.

## Testing
- Android: add license testers in Play Console, upload a build to an internal testing track, and use the static test cards ("always approves", "always declines", "slow test card" for pending).
- Product IDs must exist in Play Console and App Store Connect before anything loads. An empty product list in development usually means console setup, not code. List the products the user must create in `.studio/setup-needed.md`.

## Review checklist
- [ ] No billing SDK type in `commonMain`.
- [ ] Pending purchases do not grant entitlement.
- [ ] Every purchase is acknowledged or consumed.
- [ ] Owned purchases are re-queried on start and resume.
- [ ] Entitlements survive process death and work offline.
- [ ] Cancelling a purchase shows no error.
