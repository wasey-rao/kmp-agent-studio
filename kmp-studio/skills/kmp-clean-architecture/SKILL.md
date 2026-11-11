---
name: kmp-clean-architecture
description: Clean architecture for Kotlin Multiplatform apps - layers and dependency direction, feature-first package layout, domain models and use cases, repository contracts, MVI-style ViewModels with a single UiState, error handling, coroutines rules and platform boundaries with expect/actual versus interfaces. Use when designing or writing shared domain, data or presentation code in commonMain, or reviewing it.
---

# Clean architecture for KMP

## Layers and direction
```
presentation  ->  domain  <-  data
(ViewModel, UiState)   (models, use cases,   (repository impls, remote,
                        repository interfaces)  local, mappers)
```
- `domain` depends on nothing: pure Kotlin, no Ktor, no Room, no Compose, no SDK types.
- `data` implements `domain` interfaces and owns DTOs, entities and mappers.
- `presentation` talks to `domain` only. UI talks to `presentation` only.
- Platform SDKs (ads, billing, Firebase) are data-layer details behind a domain interface.

## Package layout (feature-first, one shared module)
```
com.example.app
  core/        common (Result, DispatcherProvider), designsystem, navigation, di
  feature/<name>/
    domain/    model, <Name>Repository, usecase
    data/      <Name>RepositoryImpl, remote, local, mapper
    presentation/  <Name>ViewModel, <Name>UiState, <Name>Event
    ui/        <Name>Route, <Name>Screen, components
  platform/    interfaces for ads, billing, analytics; actuals in androidMain / iosMain
```
A feature may import `core` and `platform`, never another feature's `data` or `ui`. Shared models move to `core`.

## Domain
- Models are immutable `data class`es with domain meaning; no JSON or database annotations.
- A use case is one public `operator fun invoke`. Write one only when it holds logic or combines repositories; a ViewModel may call a repository directly for a plain read.
- Repository interfaces expose `Flow<T>` for observed data and `suspend` functions returning a result type for one-shot work.

## Errors
```kotlin
sealed interface AppResult<out T> {
    data class Success<T>(val value: T) : AppResult<T>
    data class Failure(val error: AppError) : AppResult<Nothing>
}
sealed interface AppError { data object Network : AppError; data object NotFound : AppError; data class Unknown(val cause: Throwable?) : AppError }
```
- The data layer catches, maps to `AppError`, and returns `Failure`. Nothing above it sees an exception.
- Always rethrow `CancellationException`; a `catch (e: Exception)` that swallows it breaks structured concurrency.

## Presentation (MVI-style)
```kotlin
data class HomeUiState(val isLoading: Boolean = true, val items: List<Item> = emptyList(), val error: AppError? = null)
sealed interface HomeEvent { data object Refresh : HomeEvent; data class Open(val id: String) : HomeEvent }
sealed interface HomeEffect { data class Navigate(val id: String) : HomeEffect }

class HomeViewModel(private val observeItems: ObserveItems) : ViewModel() {
    private val _state = MutableStateFlow(HomeUiState())
    val state: StateFlow<HomeUiState> = _state.asStateFlow()
    private val _effects = Channel<HomeEffect>(Channel.BUFFERED)
    val effects = _effects.receiveAsFlow()
    fun onEvent(event: HomeEvent) { /* when (event) ... _state.update { it.copy(...) } */ }
}
```
- One immutable state object per screen, changed only through `_state.update { }`.
- One entry point for UI input (`onEvent`). Navigation and snackbars are effects, not state.
- Use the multiplatform `ViewModel` and `viewModelScope` from the JetBrains lifecycle artifacts.
- No `Context`, `Activity`, `UIViewController` or SDK type in a ViewModel.

## Coroutines
- Inject a `DispatcherProvider` (`io`, `default`, `main`); never reference `Dispatchers.IO` inside a class.
- Repositories are main-safe: they switch dispatcher themselves.
- No `GlobalScope`, no `runBlocking` outside tests, no unscoped `launch`.
- Convert cold flows for the UI with `stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), initial)`.

## Platform boundary: interface first
Prefer an interface in `commonMain` with implementations registered through DI in `androidMain` and `iosMain`. It is testable with a fake and lets iOS be implemented in Swift.
Use `expect`/`actual` only for small leaf things without dependencies: a platform name, a `DatabaseBuilder` factory, a composable that wraps a native view.

## Review checklist
- [ ] Does anything in `domain` import a library other than kotlinx?
- [ ] Does any ViewModel or composable import from `data`?
- [ ] Is there exactly one `UiState` per screen, and is it immutable?
- [ ] Is `CancellationException` rethrown everywhere exceptions are caught?
- [ ] Can every repository and SDK wrapper be replaced by a fake in `commonTest`?
