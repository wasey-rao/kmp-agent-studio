---
name: kmp-navigation-3
description: Navigation 3 in Compose Multiplatform - NavKey destinations, a back stack you own, NavDisplay with entryProvider, the polymorphic serialization setup that iOS requires, ViewModel scoping per entry, bottom-bar tabs with separate back stacks, passing arguments and results, and back handling. Use when adding or changing navigation in a KMP or Compose Multiplatform app.
---

# Navigation 3 in Compose Multiplatform

Navigation 3 has no NavController and no graph. The back stack is a list of keys that you own; `NavDisplay` renders the top of it. Navigating is adding to or removing from the list.

## Dependencies
In `commonMain` use the JetBrains multiplatform builds, not the `androidx.navigation3` Android-only coordinates:
- `org.jetbrains.androidx.navigation3:navigation3-ui`
- `org.jetbrains.androidx.lifecycle:lifecycle-viewmodel-navigation3` (ViewModels scoped to an entry)
- `kotlinx-serialization` plugin and core library (keys are `@Serializable`)

Take versions from `.studio/research.md`; they are tied to the Compose Multiplatform version.

## Keys
```kotlin
@Serializable data object Home : NavKey
@Serializable data class Detail(val id: String) : NavKey
```
Keys carry only small identifiers, never objects. The destination loads its own data from the id.

## Back stack and display
```kotlin
// Required off Android: iOS has no reflection, so NavKey subclasses must be registered.
private val navConfig = SavedStateConfiguration {
    serializersModule = SerializersModule {
        polymorphic(NavKey::class) {
            subclass(Home::class, Home.serializer())
            subclass(Detail::class, Detail.serializer())
        }
    }
}

@Composable
fun AppNavigation() {
    val backStack = rememberNavBackStack(navConfig, Home)
    NavDisplay(
        backStack = backStack,
        onBack = { if (backStack.size > 1) backStack.removeLastOrNull() },
        entryDecorators = listOf(
            rememberSaveableStateHolderNavEntryDecorator(),
            rememberViewModelStoreNavEntryDecorator(),
        ),
        entryProvider = entryProvider {
            entry<Home> { HomeRoute(onOpen = { id -> backStack.add(Detail(id)) }) }
            entry<Detail> { key -> DetailRoute(id = key.id, onBack = { backStack.removeLastOrNull() }) }
        },
    )
}
```
- Every new key must be added to the `polymorphic` block. Forgetting it compiles and works on Android, then crashes on iOS when state is saved.
- Keep both decorators: without them `rememberSaveable` state and ViewModels are not scoped to the entry.
- Never remove the last key; an empty back stack is an error. Let the system handle back at the root.

## Rules
- Screens never see the back stack. Routes receive lambdas (`onOpen`, `onBack`); only the navigation file mutates the list.
- ViewModel arguments come from the key: `koinViewModel { parametersOf(key.id) }` inside the entry.
- Navigation triggered by logic is a one-off effect from the ViewModel, collected in the Route, which calls the lambda.
- Avoid duplicates on fast taps: add a key only if it is not already on top.
- Replace instead of stacking for flows that should not be returned to (splash, onboarding, login): remove the old key, then add the new one.

## Bottom bar with a back stack per tab
Keep one back stack per top-level key and show the selected one:
- a `TopLevelBackStack` state holder with `stacks: Map<NavKey, SnapshotStateList<NavKey>>` and `selected: NavKey`;
- `NavDisplay` receives the flattened list for the selected tab;
- selecting the current tab again pops it to its root; back on a tab root returns to the start tab, then exits.
Put the `NavigationBar` in a `Scaffold` outside `NavDisplay` and hide it for full-screen destinations by checking the top key.

## Results
To return a value, hold it in a shared state object scoped above both entries (a ViewModel on the parent entry or a small result store provided by DI), set it before popping, and consume it once in the caller.

## Dialogs, bottom sheets, adaptive panes
These are Scenes: mark an entry with scene metadata and pass a `sceneStrategy` to `NavDisplay`. Check the current official Navigation 3 docs for the exact API of the version in the catalog before writing a custom Scene; if the `navigation-3` skill from Google is installed, its recipes cover each case.

## Common mistakes
- Using the `androidx.navigation3` coordinates in `commonMain` (Android-only artifact).
- A missing `subclass(...)` registration (iOS crash).
- Passing the back stack or a `navigate` function deep into screens.
- Keeping screen state in the key instead of in the ViewModel.
