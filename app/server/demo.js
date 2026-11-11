// Demo mode (`npm run demo`): replays a scripted team run through the same
// message handler the real SDK stream uses. No request is sent and no tokens
// are spent. It exists to try the UI and to test the event pipeline.

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const MODEL = {
  manager: 'claude-sonnet-5-5',
  'product-manager': 'claude-sonnet-5-5',
  researcher: 'claude-haiku-5-5',
  architect: 'claude-opus-5-5',
  'build-engineer': 'claude-sonnet-5-5',
  'kmp-developer': 'claude-opus-5-5',
  'ui-developer': 'claude-opus-5-5',
  'qa-engineer': 'claude-sonnet-5-5',
};

export async function* demoStream(run) {
  const plugin = run.plugin;
  let counter = 0;
  const nextId = (prefix) => `${prefix}_demo_${++counter}`;

  const assistant = (role, parent, content, usage) => ({
    type: 'assistant',
    parent_tool_use_id: parent,
    message: {
      id: nextId('msg'),
      model: MODEL[role],
      content,
      usage: { input_tokens: usage[0], output_tokens: usage[1], cache_read_input_tokens: usage[2] || 0, cache_creation_input_tokens: usage[3] || 0 },
    },
  });
  const text = (value) => ({ type: 'text', text: value });
  const tool = (name, input, id = nextId('toolu')) => ({ type: 'tool_use', id, name, input });
  const finished = (toolUseId, report, totalTokens, toolUses) => ({
    type: 'user',
    parent_tool_use_id: null,
    message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: toolUseId, content: [{ type: 'text', text: report }] }] },
    tool_use_result: { totalTokens, totalToolUseCount: toolUses },
  });

  // One delegated task: the manager spawns a role, the role works, then reports.
  async function* delegate(role, description, steps, report, totalTokens) {
    const id = nextId('toolu');
    yield assistant('manager', null, [tool('Agent', { subagent_type: `${plugin}:${role}`, description, prompt: description }, id)], [900, 60, 5200]);
    for (const [name, input] of steps) {
      await wait(450);
      yield assistant(role, id, [tool(name, input)], [1800, 240, 9000, 600]);
    }
    await wait(450);
    yield finished(id, report, totalTokens, steps.length);
  }

  yield {
    type: 'system',
    subtype: 'init',
    session_id: 'demo-session',
    model: MODEL.manager,
    claude_code_version: 'demo',
    apiKeySource: 'none',
    agents: Object.keys(MODEL).filter((r) => r !== 'manager').map((r) => `${plugin}:${r}`),
  };

  let first = true;
  for await (const _message of run.input) {
    if (!first) {
      await wait(500);
      yield assistant('manager', null, [text('This is demo mode, so follow-ups get a canned reply. Start the app without --demo to talk to the real team.')], [700, 40, 5200]);
      yield { type: 'result', subtype: 'success', is_error: false, result: 'Demo reply.', total_cost_usd: 0, num_turns: 1, duration_ms: 500 };
      continue;
    }
    first = false;
    const started = Date.now();

    yield assistant('manager', null, [text('Starting the pipeline: spec first, then research and architecture.')], [1200, 50, 0, 5200]);

    yield* delegate('product-manager', 'Write the product spec', [
      ['Write', { file_path: `${run.projectDir}/.studio/spec.md` }],
    ], 'Wrote .studio/spec.md: 4 screens, 6 MVP features.\nAssumption: remove-ads is a one-time purchase.', 14200);

    yield* delegate('researcher', 'Verify library versions for the stack', [
      ['WebFetch', { url: 'https://dl.google.com/dl/android/maven2/androidx/navigation3/navigation3-ui/maven-metadata.xml' }],
      ['WebSearch', { query: 'Compose Multiplatform Kotlin compatibility table' }],
      ['Write', { file_path: `${run.projectDir}/.studio/research.md` }],
    ], 'Wrote .studio/research.md: 14 versions verified, 0 unverified.', 21800);

    yield* delegate('architect', 'Design the architecture and task list', [
      ['Skill', { skill: `${plugin}:kmp-clean-architecture` }],
      ['Read', { file_path: `${run.projectDir}/.studio/spec.md` }],
      ['Write', { file_path: `${run.projectDir}/.studio/architecture.md` }],
      ['Write', { file_path: `${run.projectDir}/.studio/tasks.md` }],
    ], 'Wrote .studio/architecture.md and .studio/tasks.md: 9 tasks in 3 waves.', 48600);

    // A wave: two developers working at the same time.
    const shared = nextId('toolu');
    const ui = nextId('toolu');
    yield assistant('manager', null, [
      text('Wave 2: shared logic and UI can run in parallel.'),
      tool('Agent', { subagent_type: `${plugin}:kmp-developer`, description: 'Task 4: notes repository and use cases' }, shared),
      tool('Agent', { subagent_type: `${plugin}:ui-developer`, description: 'Task 5: home screen and navigation' }, ui),
    ], [1500, 130, 9800]);
    await wait(500);
    yield assistant('kmp-developer', shared, [tool('Skill', { skill: `${plugin}:kmp-data-layer` })], [2400, 90, 12000, 800]);
    yield assistant('ui-developer', ui, [tool('Skill', { skill: `${plugin}:kmp-navigation-3` })], [2300, 80, 11000, 800]);
    await wait(500);
    yield assistant('kmp-developer', shared, [tool('Write', { file_path: `${run.projectDir}/composeApp/src/commonMain/kotlin/feature/notes/data/NotesRepositoryImpl.kt` })], [3100, 1900, 14000]);
    yield assistant('ui-developer', ui, [tool('Write', { file_path: `${run.projectDir}/composeApp/src/commonMain/kotlin/feature/home/ui/HomeScreen.kt` })], [2900, 2200, 13000]);
    await wait(500);
    yield finished(ui, 'Task 5 done: HomeRoute, HomeScreen, AppNavigation. Shared metadata compiles.', 61200, 2);
    await wait(300);
    yield finished(shared, 'Task 4 done: NotesRepositoryImpl, ObserveNotes, AddNote. Shared metadata compiles.', 58900, 2);

    // A command that needs approval, to show the permission flow.
    const build = nextId('toolu');
    yield assistant('manager', null, [tool('Agent', { subagent_type: `${plugin}:build-engineer`, description: 'Run the Android debug build' }, build)], [1100, 60, 11000]);
    await wait(400);
    const command = './gradlew :androidApp:assembleDebug --console=plain -q';
    const decision = await run.decide('Bash', { command }, { signal: run.abort.signal });
    if (decision.behavior === 'allow') {
      yield assistant('build-engineer', build, [tool('Bash', { command })], [2600, 110, 8000]);
      await wait(800);
      yield finished(build, 'assembleDebug passed. iOS targets were not compiled on this host.', 19400, 1);
    } else {
      yield finished(build, 'The build command was not approved, so the build was not run.', 6100, 0);
    }

    yield* delegate('qa-engineer', 'Test the notes feature against the acceptance criteria', [
      ['Skill', { skill: `${plugin}:kmp-testing` }],
      ['Write', { file_path: `${run.projectDir}/composeApp/src/commonTest/kotlin/NotesViewModelTest.kt` }],
      ['Write', { file_path: `${run.projectDir}/.studio/qa-report.md` }],
    ], '6 tests added, 6 passed. 7 of 8 acceptance criteria verified, 1 not verifiable here (iOS).', 33700);

    await wait(400);
    const summary = [
      'Demo run finished. Nothing was actually built and no tokens were spent.',
      '',
      'In a real run this report lists what was built, how to run it, what was verified,',
      'what was not (iOS cannot be compiled on Windows), and the manual steps left for you.',
    ].join('\n');
    yield assistant('manager', null, [text(summary)], [1900, 210, 14000]);
    yield {
      type: 'result',
      subtype: 'success',
      is_error: false,
      result: summary,
      total_cost_usd: 0,
      num_turns: 14,
      duration_ms: Date.now() - started,
      modelUsage: {
        'claude-opus-5-5': { inputTokens: 13000, outputTokens: 4300, cacheReadInputTokens: 50000, cacheCreationInputTokens: 2200, costUSD: 0 },
        'claude-sonnet-5-5': { inputTokens: 16800, outputTokens: 1500, cacheReadInputTokens: 96000, cacheCreationInputTokens: 7600, costUSD: 0 },
        'claude-haiku-5-5': { inputTokens: 5400, outputTokens: 720, cacheReadInputTokens: 27000, cacheCreationInputTokens: 1800, costUSD: 0 },
      },
    };
  }
}
