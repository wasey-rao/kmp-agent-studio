---
name: kmp-testing
description: Testing a Kotlin Multiplatform app - what to test in commonTest, coroutine and Flow testing with kotlinx-coroutines-test and Turbine, hand-written fakes, ViewModel state tests, Compose Multiplatform UI tests, which Gradle test tasks to run on which host, and how to report results. Use when writing or running tests for shared or UI code, or setting up test infrastructure.
---

# Testing a KMP app

## Where tests go
| Source set | What | Runs on |
| --- | --- | --- |
| `commonTest` | Use cases, repositories with fakes, ViewModels, mappers. The bulk of the tests. | Every target |
| Android host test source set | Android-specific implementations that do not need a device | JVM |
| Android device test source set | SDK wrappers, Room on device, end-to-end flows | Emulator or device |
| `iosTest` | iOS actuals | macOS only |

Put a test in `commonTest` unless it needs a platform API.

## Dependencies (`commonTest`)
`kotlin("test")`, `kotlinx-coroutines-test`, and Turbine (`app.cash.turbine:turbine`) for flows. Versions from `.studio/research.md`. Avoid JVM-only mocking libraries in shared tests; they do not run on iOS.

## Fakes over mocks
```kotlin
class FakeNotesRepository : NotesRepository {
    private val notes = MutableStateFlow<List<Note>>(emptyList())
    var failNext: AppError? = null
    override fun observe(): Flow<List<Note>> = notes
    override suspend fun add(note: Note): AppResult<Unit> =
        failNext?.let { failNext = null; AppResult.Failure(it) } ?: run { notes.update { it + note }; AppResult.Success(Unit) }
}
```
A fake is a small working implementation with a way to inject failure. Keep fakes in `commonTest` next to the tests, and reuse them across ViewModel and use-case tests.

## ViewModel tests
```kotlin
class NotesViewModelTest {
    private val dispatcher = StandardTestDispatcher()
    @BeforeTest fun setUp() = Dispatchers.setMain(dispatcher)
    @AfterTest fun tearDown() = Dispatchers.resetMain()

    @Test fun addingNoteShowsItInState() = runTest(dispatcher) {
        val repo = FakeNotesRepository()
        val vm = NotesViewModel(ObserveNotes(repo), AddNote(repo))
        vm.state.test {
            assertTrue(awaitItem().isLoading)
            assertEquals(emptyList(), awaitItem().notes)
            vm.onEvent(NotesEvent.Add("Milk"))
            assertEquals(listOf("Milk"), awaitItem().notes.map { it.title })
            cancelAndIgnoreRemainingEvents()
        }
    }
}
```
- `Dispatchers.setMain` is required because `viewModelScope` uses Main.
- Assert on emitted states in order; test the error path and the empty path, not only success.
- For each screen cover: initial load, success, failure, retry, and each event that changes state.

## What to test first
1. Logic with branches: use cases, validation, mapping, entitlement and ad-frequency rules.
2. ViewModel state transitions for every acceptance criterion in the spec.
3. Repository behavior with a fake remote and fake local source: caching, error mapping, refresh.
Skip tests that restate the implementation, such as getters or DI wiring.

## Determinism
- Inject `DispatcherProvider` and a clock; no `delay` with real time, no `Thread.sleep`, no real network, no real ads or billing.
- Use `advanceUntilIdle()` or `advanceTimeBy()` for time-based logic such as frequency caps.

## Compose UI tests
Compose Multiplatform has a common UI test API (`runComposeUiTest`) that needs the `compose.uiTest` dependency and is still marked experimental; confirm the setup for the Compose version in the catalog before adding it.
- Test stateless `XxxScreen(state, onEvent)` composables: given a state, the right content is shown; clicking a control sends the right event.
- Find nodes by text or content description from resources, and by `testTag` only for things with no text.

## Running
Find the real task names first: `./gradlew :composeApp:tasks --group verification --console=plain`. They depend on the Android KMP plugin in use (for example `testAndroidHostTest` with the new library plugin, `testDebugUnitTest` with the older one).
- Any host: the Android host test task for the shared module.
- macOS: also `iosSimulatorArm64Test`.
- `allTests` runs every target that the host supports.
Add `--console=plain -q`, and on failure read the report for the failing test only.

## Reporting
State what ran and what did not. "Tests written but not executed because no JDK was found" is a valid report; "all tests pass" without a run is not. Include the command and the pass and fail counts in `.studio/qa-report.md`.
