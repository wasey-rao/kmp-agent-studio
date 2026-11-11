# KMP Agent Studio

A software-company style agent team for building Kotlin Multiplatform (Android + iOS, Compose Multiplatform) apps from a prompt. Each role runs on the Claude model that fits its work, so Opus is spent on design and code while lookups, searching and docs run on Haiku.

It has two parts:

| Folder | What it is |
| --- | --- |
| `kmp-studio/` | A Claude Code plugin: 12 role agents, 12 KMP skills, 3 pipeline commands. Works on its own inside Claude Code. |
| `app/` | A desktop app (Electron + Claude Agent SDK) that runs the same plugin and shows the team, live activity, approvals and token use per role. |

## Prerequisites

- Node.js 20 or newer
- Claude Code installed and **signed in from a terminal**: run `claude auth login` and finish the sign-in in the browser. `claude auth status` should then show `"loggedIn": true`. The studio uses that login. Signing in to the Claude desktop app alone is not enough. An `ANTHROPIC_API_KEY` environment variable also works, and so does `CLAUDE_CODE_OAUTH_TOKEN` set to the token from `claude setup-token`.
- For the apps the team builds: JDK 17, Android Studio and the Android SDK. iOS builds need a Mac with Xcode.

## Run the desktop app

The steps are the same on Windows and macOS. Run `npm install` on each machine; `node_modules` is platform-specific.

```bash
cd app
npm install
npm start
```

If `npm start` reports that Electron failed to install, fetch its binary once with `node node_modules/electron/install.js`.

Other commands:

| Command | What it does |
| --- | --- |
| `npm run demo` | Opens the app with a scripted run. No request is sent and no tokens are used. |
| `npm run web` | Serves the same UI at `http://127.0.0.1:4517` for a browser instead of the Electron window. |
| `npm run check` | Verifies the plugin files and sends one small Haiku request to confirm the login works. Add `-- --offline` to skip the request. |

### Using the app

1. Click **Check connection** once to confirm the login.
2. Pick the kind of work: **New app**, **Add feature**, **Fix bug** or **Ask the team**.
3. Choose the project folder (created if it does not exist) and describe what you want.
4. Watch the feed. Approve commands when asked, or turn on **Autopilot** in Settings.
5. When the team reports back, send follow-ups in the same session or start a new run.

Models are changed per role in the Team panel. A change rewrites the `model:` line of that role's file in `kmp-studio/agents/`, so the plugin in Claude Code uses the same setting. Changes apply to the next run.

Approvals: file edits inside the project folder are automatic. Shell commands ask first unless Autopilot is on. Anything reaching outside the project folder always asks.

## Use the plugin in Claude Code without the app

Try it for one session:

```bash
claude --plugin-dir "<path to this repo>/kmp-studio"
```

Or install it permanently from this repo's local marketplace:

```bash
claude plugin marketplace add "<path to this repo>"
```

```bash
claude plugin install kmp-studio@kmp-studio-local
```

Then, in a project folder:

| Command | Use |
| --- | --- |
| `/kmp-studio:build-app <idea>` | Full pipeline for a new app |
| `/kmp-studio:add-feature <feature>` | Feature on an existing project |
| `/kmp-studio:fix-bug <bug or error>` | Smallest team that can fix it |

## The team

| Role | Model | Does |
| --- | --- | --- |
| Engineering Manager | Sonnet | The coordinating session. Delegates, never writes code. Set in the app's Settings. |
| Product Manager | Sonnet | Turns the idea into `.studio/spec.md` |
| Researcher | Haiku | Verifies library versions and APIs from Maven metadata and official docs |
| Scout | Haiku | Read-only code search on existing projects |
| Architect | Opus | Module design, contracts, task breakdown into parallel waves |
| Build Engineer | Sonnet | Gradle, scaffolding, build fixes |
| KMP Developer | Opus | Shared domain, data and ViewModel code |
| UI Developer | Opus | Compose screens, Navigation 3, edge-to-edge |
| Platform Integrator | Opus | Ads, billing, Firebase, iOS bridge |
| QA Engineer | Sonnet | Tests and acceptance checks |
| Code Reviewer | Sonnet | Read-only review of the diff |
| Release Manager | Sonnet | Signing config, R8, policy and Data safety checks |
| Tech Writer | Haiku | README, changelog, store listing |

### How it keeps token use down

- **Work goes to the cheapest role that can do it.** Searching, version lookups and docs never touch Opus.
- **Roles hand off through files, not chat.** Each role reads its inputs from `.studio/` in the project and writes its output there, then replies in a few lines. The manager passes paths, not contents.
- **The manager stays small.** Its context is repeated on every handoff, so it runs on Sonnet and is told not to read or write code.
- **Skills load on demand.** A role loads only the skill for the SDK it is working on.
- **Independent tasks run in parallel.** The architect groups tasks into waves that share no files.

## Skills

`kmp-project-setup`, `kmp-clean-architecture`, `kmp-navigation-3`, `kmp-edge-to-edge`, `kmp-ads-next-gen`, `kmp-play-billing`, `kmp-firebase`, `kmp-data-layer`, `kmp-testing`, `kmp-release-and-policy`, `kmp-monetization`, `kmp-ios-integration`.

Each is a `SKILL.md` under `kmp-studio/skills/`. They hold rules, contracts and checklists rather than version numbers: the researcher looks up current versions at run time, because library versions change faster than any written guide. Edit them freely to match your own conventions. Skills you already have installed in Claude Code (for example Google's `navigation-3` or `edge-to-edge`) are also available to the team when "Load my Claude Code settings" is on.

## Limits

- iOS code can be written on Windows but only compiled on a Mac. The team reports iOS as not compiled when it runs on Windows.
- The team never creates signing keys, Firebase config files, ad unit IDs or store products. It lists those in `.studio/setup-needed.md` and `.studio/release-checklist.md` for you to do.
- Cost shown in the app is the API-rate figure reported by Claude Code for the session.

## License

[MIT](LICENSE)
