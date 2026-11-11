---
name: kmp-project-setup
description: Project structure and Gradle setup for a Kotlin Multiplatform + Compose Multiplatform app targeting Android and iOS - module layout under AGP 9, version catalog, source sets, iOS framework config, gradle.properties, and the rule for choosing dependency versions. Use when scaffolding a new KMP project, adding a module or target, or fixing Gradle sync and build configuration.
---

# KMP project setup (Android + iOS, Compose Multiplatform)

## Versions are looked up, never recalled
Library versions move faster than any model's memory. Every version in `gradle/libs.versions.toml` must come from `.studio/research.md` or from repository metadata checked in this session:

- Google Maven: `https://dl.google.com/dl/android/maven2/<group/path>/<artifact>/maven-metadata.xml`
- Maven Central: `https://repo1.maven.org/maven2/<group/path>/<artifact>/maven-metadata.xml`

Pick versions as a compatible set: Compose Multiplatform pins a Kotlin range, AGP pins Gradle and JDK, KSP must match Kotlin, and Room and Navigation 3 pin their own minimums. Check the Compose Multiplatform and Kotlin compatibility tables when in doubt.

## Module layout
Under AGP 9 the Android application plugin and the Kotlin Multiplatform plugin can no longer live in the same module. The app module and the shared module are separate:

```
<project>/
  settings.gradle.kts
  build.gradle.kts              plugins declared with `apply false`
  gradle.properties
  gradle/libs.versions.toml
  composeApp/                   KMP library: shared UI and logic
    src/commonMain/kotlin       almost everything lives here
    src/commonMain/composeResources
    src/androidMain/kotlin      Android actuals and SDK implementations
    src/iosMain/kotlin          iOS actuals, MainViewController
    src/commonTest/kotlin
  androidApp/                   com.android.application: Application, MainActivity,
                                manifest, google-services.json, signing, R8 rules
  iosApp/                       Xcode project that embeds the shared framework
```

Start with one shared module. Split it into feature or core Gradle modules only when the architecture document says so; for an MVP, packages give the same boundaries with far less build configuration.

## Shared module build script
- Plugins: Kotlin Multiplatform, the Android KMP library plugin (`com.android.kotlin.multiplatform.library`), Compose Multiplatform, the Compose compiler plugin, and Kotlin serialization. Add KSP only if Room or another processor needs it.
- The Android target is configured inside the `kotlin { }` block (`androidLibrary { namespace, compileSdk, minSdk }`; newer plugin versions name the block `android { }`). There is no top-level `android { }` block in this module. Enable Android resources there if Compose resources are used.
- iOS targets: `iosArm64()` and `iosSimulatorArm64()`. Add `iosX64()` only if Intel Macs must run the simulator. Give each a framework with `baseName = "ComposeApp"` and `isStatic = true`.
- Dependencies go in `sourceSets`: shared ones in `commonMain.dependencies`, SDKs in `androidMain.dependencies`. `iosMain` is created by the default hierarchy template; do not wire it by hand.
- No version literals in build scripts. Everything goes through the catalog (`libs.…`), including plugins.

## Android app module
- Plain `com.android.application` module with AGP's built-in Kotlin; it depends on `projects.composeApp`.
- Holds what only an app can hold: `Application` class, `MainActivity`, manifest, launcher icons, `google-services.json`, signing configs, R8 rules, the ads app ID meta-data.
- `minSdk` 24 or higher (the Next-Gen ads SDK requires 24), `compileSdk` and `targetSdk` at the level Google Play currently requires. Java and Kotlin target JVM 17.

## gradle.properties
```
org.gradle.jvmargs=-Xmx4g -Dfile.encoding=UTF-8
org.gradle.caching=true
org.gradle.configuration-cache=true
org.gradle.parallel=true
kotlin.code.style=official
android.useAndroidX=true
android.nonTransitiveRClass=true
kotlin.native.ignoreDisabledTargets=true
```
The last line silences the warning on Windows and Linux, where iOS targets are skipped.

## Host limits
- iOS targets compile and link only on macOS with Xcode. On Windows and Linux, verify `commonMain` and Android, and report iOS as not compiled.
- Use `./gradlew` (Git Bash, macOS) or `gradlew.bat` (cmd, PowerShell). Always pass `--console=plain`.

## Scaffold checklist
1. Wrapper, settings (with `enableFeaturePreview("TYPESAFE_PROJECT_ACCESSORS")`), catalog, root build script.
2. `composeApp` with an `App()` composable in `commonMain` showing one themed screen.
3. `androidApp` with an edge-to-edge `MainActivity` calling `App()`.
4. `iosMain` `MainViewController()` and the `iosApp` Xcode project.
5. `.gitignore` covering `build/`, `.gradle/`, `local.properties`, `*.keystore`, `*.jks`, `google-services.json`, `GoogleService-Info.plist`, `xcuserdata/`.
6. Prove it: shared metadata compiles, `:androidApp:assembleDebug` passes.
