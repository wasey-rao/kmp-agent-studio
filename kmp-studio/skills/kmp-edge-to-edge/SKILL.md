---
name: kmp-edge-to-edge
description: Edge-to-edge layout in Compose Multiplatform for Android and iOS - enabling it per platform, WindowInsets with Scaffold, lists, bottom bars, keyboards (IME), display cutouts, system bar icon contrast, and ad banners at screen edges. Use when building any screen scaffold, fixing content hidden behind the status bar, navigation bar, notch or keyboard, or targeting Android 15 and later.
---

# Edge-to-edge in Compose Multiplatform

Android enforces edge-to-edge for apps targeting SDK 35 and later, and the opt-out is gone at 36. iOS apps are expected to draw under the status bar and home indicator. Build every screen edge-to-edge from the start.

The rule: **backgrounds draw behind system bars; content and controls are padded by insets.**

## Enable it
**Android** (`MainActivity` in `androidApp`), before `setContent`:
```kotlin
override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
    setContent { App() }
}
```
In the manifest set `android:windowSoftInputMode="adjustResize"` on the activity so IME insets reach Compose.

**iOS** (`ContentView.swift`): let Compose own the whole screen, otherwise SwiftUI applies safe areas first and Compose sees zero insets.
```swift
ComposeView().ignoresSafeArea()
```

## Scaffold does most of the work
```kotlin
Scaffold(
    topBar = { TopAppBar(title = { Text(title) }) },          // pads itself for the status bar
    bottomBar = { NavigationBar { /* ... */ } },              // pads itself for the nav bar
) { innerPadding ->
    LazyColumn(
        contentPadding = innerPadding,                         // content scrolls under the bars
        modifier = Modifier.fillMaxSize(),
    ) { /* items */ }
}
```
- Always use `innerPadding`. For lists pass it as `contentPadding` so items scroll behind translucent bars; for non-scrolling content use `Modifier.padding(innerPadding)`.
- Material 3 bars consume their own insets. Do not add `statusBarsPadding()` on top of a `TopAppBar`.
- Nested scaffolds double the padding. Give the inner one `contentWindowInsets = WindowInsets(0)` or apply `consumeWindowInsets(innerPadding)` on the outer content.

## Screens without a Scaffold
```kotlin
Box(Modifier.fillMaxSize().background(MaterialTheme.colorScheme.background)) {   // background fills the screen
    Column(Modifier.fillMaxSize().windowInsetsPadding(WindowInsets.safeDrawing)) { /* content */ }
}
```
`WindowInsets.safeDrawing` covers status bar, navigation bar, display cutout and keyboard. Use `safeContent` when gestures matter. Apply inset padding once, at the level that owns the content, never on both parent and child.

## Keyboard
- Input screens: `Modifier.imePadding()` on the scrolling container, or `safeDrawing` which already includes the IME.
- A bottom button that must sit above the keyboard: put it in the scaffold `bottomBar` with `Modifier.imePadding()`, or use `WindowInsets.ime.union(WindowInsets.navigationBars)`.
- Make the content scrollable so a focused field can come into view.

## Full-bleed content
Images, maps, video and camera previews should ignore insets and fill the screen. Overlay controls on top and pad only the controls with `WindowInsets.safeDrawing`.

## System bar contrast
Bars are transparent, so icon contrast is your job. On Android, `enableEdgeToEdge()` chooses light or dark icons from the system theme; if the app has its own theme switch, call it again with matching `SystemBarStyle`s when the theme changes. Under three-button navigation Android adds a translucent scrim; keep it unless the bottom bar already provides a solid background.

## Ad banners
A bottom banner goes inside the scaffold `bottomBar` slot, above the navigation bar inset, with its height reserved so content does not jump. Never let a banner sit under the gesture bar or overlap navigation controls; that is both a layout bug and an ads policy problem.

## Checklist for every screen
- [ ] Background reaches the top and bottom physical edges.
- [ ] No text or control under the status bar, cutout, navigation bar or home indicator.
- [ ] The last list item can scroll fully above the bottom bar.
- [ ] Focused text fields stay visible with the keyboard open.
- [ ] Looks right in landscape (cutout on the side) and in dark theme.
- [ ] Insets are applied once, not doubled.

If Google's `edge-to-edge` skill is installed, use it for Android-specific troubleshooting beyond this.
