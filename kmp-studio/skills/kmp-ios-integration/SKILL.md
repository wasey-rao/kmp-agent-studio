---
name: kmp-ios-integration
description: The iOS side of a Compose Multiplatform app - the shared framework and MainViewController entry point, the SwiftUI host, implementing Kotlin interfaces in Swift for native SDKs (ads, StoreKit, Firebase) and passing them into shared code, Kotlin to Swift interop rules, native dependencies through Swift Package Manager, and what can and cannot be verified on Windows. Use when writing iosMain code, Swift bridge code, or wiring iOS SDKs into shared interfaces.
---

# iOS integration for a KMP app

## How the pieces fit
```
iosApp (Xcode, Swift)                    composeApp (Kotlin)
  iOSApp.swift   ── starts DI ──────────▶ initKoin(adsManager:, billing:, ...)
  ContentView    ── hosts ──────────────▶ MainViewController()  ->  App()
  Swift SDK wrappers ── implement ──────▶ interfaces from commonMain
```
The shared module builds a static framework (`ComposeApp`). Xcode builds it through a run-script phase that calls the Gradle `embedAndSignAppleFrameworkForXcode` task.

## Entry point (`iosMain`)
```kotlin
fun MainViewController(): UIViewController = ComposeUIViewController { App() }
```
SwiftUI host:
```swift
struct ComposeView: UIViewControllerRepresentable {
    func makeUIViewController(context: Context) -> UIViewController { MainViewControllerKt.MainViewController() }
    func updateUIViewController(_ uiViewController: UIViewController, context: Context) {}
}
struct ContentView: View {
    var body: some View { ComposeView().ignoresSafeArea() }   // Compose owns the insets
}
```

## Native SDKs: implement the Kotlin interface in Swift
Native iOS SDKs for ads, purchases and Firebase are Swift/Objective-C libraries. The simplest reliable pattern is:
1. Define the interface in `commonMain` (`AdsManager`, `BillingRepository`, `ConsentManager`).
2. Add the SDK to `iosApp` with Swift Package Manager in Xcode.
3. Write a Swift class that conforms to the Kotlin interface (it appears in Swift as a protocol from the `ComposeApp` framework).
4. Pass instances into shared code at startup and register them in DI:
```kotlin
// iosMain
fun initKoinIos(adsManager: AdsManager, billing: BillingRepository) =
    initKoin { modules(module { single { adsManager }; single { billing } }) }
```
```swift
@main struct iOSApp: App {
    init() {
        FirebaseApp.configure()
        KoinIosKt.doInitKoinIos(adsManager: IosAdsManager(), billing: IosBillingRepository())
    }
    var body: some Scene { WindowGroup { ContentView() } }
}
```
This avoids cinterop and CocoaPods configuration, keeps SDK code in the language its documentation uses, and leaves shared code unchanged. Prefer it over calling SDKs from Kotlin through cinterop unless the architecture says otherwise.

## Interop rules to design for
- Kotlin `suspend` functions appear in Swift as async functions (or completion handlers) and must be called from the main thread unless the Kotlin side says otherwise. Keep bridge interfaces small.
- `Flow` and `StateFlow` are awkward to consume from Swift. For bridge interfaces, prefer `suspend` functions and callbacks, and let the Kotlin side turn them into flows. If Swift must observe flows, the SKIE Gradle plugin makes them Swift `AsyncSequence`s; adopting it is an architect decision.
- Sealed classes do not become Swift enums without SKIE; exhaustive `switch` is not available. Keep types crossing the bridge simple: data classes, enums, primitives.
- Top-level Kotlin functions in `Foo.kt` are called as `FooKt.function()` from Swift. Functions named `init...` get a `do` prefix (`doInitKoin`).
- Kotlin exceptions crossing into Swift crash unless the function is annotated `@Throws`. Bridge functions return result types instead of throwing.
- Default arguments are not available from Swift; provide explicit overloads where needed.

## Native UI inside Compose
Wrap a native view (a banner ad view, a map) with `UIKitView` in an `iosMain` `actual` composable. Give it an explicit size, and create the native view through a factory passed in from Swift when the view type comes from a Swift-only SDK.

## Platform files and setup
- `Info.plist` entries the SDKs need: `GADApplicationIdentifier` and `SKAdNetworkItems` for ads, `NSUserTrackingUsageDescription` for App Tracking Transparency, URL schemes for sign-in.
- `GoogleService-Info.plist` added to the app target and ignored by git.
- Capabilities: In-App Purchase, Push Notifications if used.
- Set `CADisableMinimumFrameDurationOnPhone` to `true` in `Info.plist` for high refresh rate displays.

## Stubs for an Android-first MVP
When the architecture marks an iOS capability as a stub, write a Kotlin no-op in `iosMain` (`NoOpAdsManager`, a `BillingRepository` that reports no products and no entitlements) and register it in the iOS platform module. The app runs on iOS with the feature absent, and the real Swift implementation can replace the stub later without touching shared code.

## Verifying
- iOS targets and Swift code can be compiled only on macOS with Xcode. On Windows or Linux: write the code carefully, keep `commonMain` and Android compiling, and report the iOS side as **not compiled**. Never claim an iOS build passed without running it.
- On macOS: `./gradlew :composeApp:linkDebugFrameworkIosSimulatorArm64` checks the Kotlin side; `xcodebuild -project iosApp/iosApp.xcodeproj -scheme iosApp -sdk iphonesimulator build` checks the whole app.

## Common mistakes
- Forgetting `.ignoresSafeArea()` on the Compose host (content is double-inset or letterboxed).
- Adding a native SDK in Gradle only; the iOS app must link it in Xcode.
- A dynamic framework with static native SDKs (duplicate symbols); keep `isStatic = true`.
- Collecting a Kotlin flow from Swift without cancelling it (leak).
