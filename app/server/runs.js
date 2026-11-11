// Runs the agent team through the Claude Agent SDK and turns the SDK's message
// stream into small events the UI can render: who is working, on what, with
// which model, and how many tokens each role has used.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { query } from '@anthropic-ai/claude-agent-sdk';
import { renderCommand, pluginName } from './plugin.js';
import { demoStream } from './demo.js';

export const isDemo = () => process.env.KMP_STUDIO_DEMO === '1';

const SIGN_IN_HINT =
  'Claude Code is not signed in on this computer. Open a terminal, run "claude auth login", finish the sign-in in the browser, and try again. ' +
  'Signing in to the Claude desktop app does not count. ' +
  'An ANTHROPIC_API_KEY or CLAUDE_CODE_OAUTH_TOKEN (from "claude setup-token") environment variable set before starting the app also works.';
const authHint = (text) => (/authenticat|oauth|log ?in|api key|unauthorized|401/i.test(String(text)) ? SIGN_IN_HINT : undefined);

/**
 * Environment for the Claude Code process the SDK starts. When this app is
 * itself launched from inside a Claude session (a terminal in Claude Code or
 * the desktop app), that session's own variables are inherited and point the
 * child at credentials it cannot use. They are removed so the child uses the
 * normal login on this computer.
 */
function sdkEnv() {
  const env = { ...process.env };
  const nested = env.CLAUDE_CODE_CHILD_SESSION || env.CLAUDE_CODE_HOST_SESSION_ID || env.CLAUDECODE;
  if (!nested) return env;
  // Provider switches and a token the user set themselves (`claude setup-token`) stay.
  const keep = /^CLAUDE_CODE_(USE_(BEDROCK|VERTEX|FOUNDRY)|OAUTH_TOKEN)$/;
  for (const key of Object.keys(env)) {
    if (keep.test(key)) continue;
    if (/^(CLAUDE_CODE_|CLAUDE_AGENT_SDK_|CLAUDE_PREVIEW_)/.test(key) || ['CLAUDECODE', 'CLAUDE_PID', 'CLAUDE_EFFORT', 'ANTHROPIC_BASE_URL'].includes(key)) {
      delete env[key];
    }
  }
  return env;
}

const MAX_EVENTS = 5000;
const MANAGER = 'manager';
const SUBAGENT_TOOLS = new Set(['Agent', 'Task']);

// Tools that only read or delegate. Everything else goes through canUseTool.
const PRE_APPROVED = ['Read', 'Glob', 'Grep', 'Skill', 'Agent', 'Task', 'TodoWrite', 'WebSearch', 'WebFetch'];

const MODE_COMMANDS = { build: 'build-app', feature: 'add-feature', fix: 'fix-bug' };

/** An async-iterable queue: lets the app push follow-up user messages into a live session. */
class MessageQueue {
  #items = [];
  #waiters = [];
  #closed = false;

  push(value) {
    if (this.#closed) return;
    const waiter = this.#waiters.shift();
    if (waiter) waiter({ value, done: false });
    else this.#items.push(value);
  }

  close() {
    this.#closed = true;
    for (const waiter of this.#waiters) waiter({ value: undefined, done: true });
    this.#waiters = [];
  }

  [Symbol.asyncIterator]() {
    return {
      next: () => {
        if (this.#items.length) return Promise.resolve({ value: this.#items.shift(), done: false });
        if (this.#closed) return Promise.resolve({ value: undefined, done: true });
        return new Promise((resolve) => this.#waiters.push(resolve));
      },
    };
  }
}

const userMessage = (text) => ({
  type: 'user',
  message: { role: 'user', content: text },
  parent_tool_use_id: null,
  session_id: '',
});

const clip = (text, max) => {
  const s = String(text ?? '').replace(/\s+/g, ' ').trim();
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
};

/**
 * A role's hand-back as the role wrote it. Claude Code wraps it for the manager
 * (a notice in front, an agent id and usage block behind, every line indented);
 * none of that is meant for the person reading the feed.
 */
function reportOf(content, max = 4000) {
  let text = textOf(content).replace(/\r\n/g, '\n');
  const marker = 'The report follows:';
  const at = text.indexOf(marker);
  if (at !== -1 && text.includes('[Subagent hand-back]')) text = text.slice(at + marker.length);
  text = text
    .replace(/<tools-used-before-summary>[\s\S]*?<\/tools-used-before-summary>/g, '')
    .replace(/\n?<usage>[\s\S]*?<\/usage>\s*$/, '')
    .replace(/\n?agentId: [^\n]*\s*$/, '');
  const lines = text.split('\n');
  const indents = lines.filter((l) => l.trim()).map((l) => l.match(/^ */)[0].length);
  const indent = indents.length ? Math.min(...indents) : 0;
  const clean = lines.map((l) => l.slice(indent).trimEnd()).join('\n').trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

function textOf(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.filter((b) => b?.type === 'text').map((b) => b.text).join('\n');
}

export class RunManager {
  /**
   * @param {{ pluginDir: string, getSettings: () => object, broadcast: (event: object) => void }} deps
   */
  constructor({ pluginDir, getSettings, broadcast }) {
    this.pluginDir = pluginDir;
    this.getSettings = getSettings;
    this.broadcast = broadcast;
    this.runs = new Map();
  }

  summaries() {
    return [...this.runs.values()].map((r) => r.summary()).sort((a, b) => b.startedAt - a.startedAt);
  }

  get(id) {
    const run = this.runs.get(id);
    if (!run) throw new Error('Run not found');
    return run;
  }

  start({ mode, prompt, projectDir }) {
    const text = String(prompt ?? '').trim();
    if (!text) throw new Error('Describe what the team should do.');
    const dir = path.resolve(String(projectDir ?? '').trim());
    if (!projectDir || !path.isAbsolute(String(projectDir).trim())) {
      throw new Error('Choose a project folder (an absolute path).');
    }
    fs.mkdirSync(dir, { recursive: true });
    if (!fs.statSync(dir).isDirectory()) throw new Error('The project path is not a folder.');

    const run = new Run({
      mode: MODE_COMMANDS[mode] || mode === 'chat' ? mode : 'chat',
      prompt: text,
      projectDir: dir,
      pluginDir: this.pluginDir,
      settings: this.getSettings(),
      broadcast: this.broadcast,
    });
    this.runs.set(run.id, run);
    run.begin();
    return run;
  }

  shutdown() {
    for (const run of this.runs.values()) run.end();
  }
}

class Run {
  constructor({ mode, prompt, projectDir, pluginDir, settings, broadcast }) {
    this.id = randomUUID();
    this.mode = mode;
    this.prompt = prompt;
    this.projectDir = projectDir;
    this.pluginDir = pluginDir;
    this.plugin = pluginName(pluginDir);
    this.settings = settings;
    this.broadcast = broadcast;

    this.status = 'starting'; // starting | running | idle | ended | error
    this.startedAt = Date.now();
    this.events = [];
    this.seq = 0;
    this.agents = new Map(); // tool_use id -> { role, description, status, ... }
    this.roleUsage = {}; // role -> token counters
    this.seenMessageIds = new Set();
    this.pending = new Map(); // permission request id -> resolver
    this.alwaysAllow = new Set();
    this.cost = null;
    this.modelUsage = null;
    this.sessionId = null;
    this.stderrTail = '';

    this.input = new MessageQueue();
    this.abort = new AbortController();
    this.query = null;
  }

  summary() {
    return {
      id: this.id,
      mode: this.mode,
      prompt: clip(this.prompt, 140),
      projectDir: this.projectDir,
      status: this.status,
      startedAt: this.startedAt,
      cost: this.cost,
    };
  }

  snapshot() {
    return { ...this.summary(), events: this.events, roleUsage: this.roleUsage, modelUsage: this.modelUsage };
  }

  emit(type, data = {}) {
    const event = { runId: this.id, seq: ++this.seq, at: Date.now(), type, ...data };
    this.events.push(event);
    if (this.events.length > MAX_EVENTS) this.events.splice(0, this.events.length - MAX_EVENTS);
    this.broadcast(event);
    return event;
  }

  setStatus(status) {
    if (this.status === status) return;
    this.status = status;
    this.emit('status', { status });
  }

  firstPrompt() {
    const command = MODE_COMMANDS[this.mode];
    if (command) return renderCommand(this.pluginDir, command, this.prompt);
    return [
      `You are the Engineering Manager of a mobile studio that builds Kotlin Multiplatform apps.`,
      `Specialist roles are available through the Agent tool as \`${this.plugin}:<role>\`.`,
      `Answer simple questions yourself. For work on the codebase, delegate to the cheapest role that can do it`,
      `and pass file paths rather than file contents.`,
      ``,
      this.prompt,
    ].join('\n');
  }

  begin() {
    this.emit('run-start', {
      mode: this.mode,
      prompt: this.prompt,
      projectDir: this.projectDir,
      managerModel: this.settings.managerModel,
      permission: this.settings.permission,
    });
    this.input.push(userMessage(this.firstPrompt()));

    try {
      this.query = isDemo() ? demoStream(this) : query({
        prompt: this.input,
        options: {
          cwd: this.projectDir,
          env: sdkEnv(),
          model: this.settings.managerModel,
          plugins: [{ type: 'local', path: this.pluginDir }],
          systemPrompt: { type: 'preset', preset: 'claude_code' },
          settingSources: this.settings.loadUserSettings ? ['user', 'project'] : ['project'],
          permissionMode: 'acceptEdits',
          allowedTools: PRE_APPROVED,
          // The team works from the request and records assumptions instead of
          // stopping for questions that the app has no dialog for.
          disallowedTools: ['AskUserQuestion'],
          canUseTool: (toolName, input, options) => this.decide(toolName, input, options),
          forwardSubagentText: true,
          abortController: this.abort,
          stderr: (chunk) => {
            this.stderrTail = (this.stderrTail + chunk).slice(-2000);
          },
        },
      });
    } catch (error) {
      this.fail(error);
      return;
    }
    this.setStatus('running');
    this.consume();
  }

  async consume() {
    try {
      for await (const message of this.query) this.handle(message);
      if (this.status !== 'error') this.setStatus('ended');
    } catch (error) {
      if (this.abort.signal.aborted) this.setStatus('ended');
      else this.fail(error);
    } finally {
      this.rejectPending('The session ended.');
    }
  }

  fail(error) {
    const detail = this.stderrTail.trim();
    this.emit('error', {
      message: String(error?.message || error),
      detail: detail ? clip(detail, 600) : undefined,
      hint: authHint(`${error?.message} ${detail}`),
    });
    this.setStatus('error');
  }

  // ---- SDK message handling -------------------------------------------------

  roleOf(parentToolUseId) {
    if (!parentToolUseId) return MANAGER;
    return this.agents.get(parentToolUseId)?.role || 'agent';
  }

  normalizeRole(subagentType) {
    const name = String(subagentType || 'general-purpose');
    const prefix = `${this.plugin}:`;
    return name.startsWith(prefix) ? name.slice(prefix.length) : name;
  }

  handle(message) {
    switch (message.type) {
      case 'system':
        if (message.subtype === 'init') {
          this.sessionId = message.session_id;
          this.emit('session', {
            model: message.model,
            claudeCodeVersion: message.claude_code_version,
            apiKeySource: message.apiKeySource,
            agents: (message.agents || []).filter((a) => a.startsWith(`${this.plugin}:`)).length,
            pluginLoaded: (message.agents || []).some((a) => a.startsWith(`${this.plugin}:`)),
          });
        }
        break;
      case 'assistant':
        this.handleAssistant(message);
        break;
      case 'user':
        this.handleUser(message);
        break;
      case 'result':
        this.handleResult(message);
        break;
      default:
        break;
    }
  }

  handleAssistant(message) {
    const parent = message.parent_tool_use_id || null;
    const role = this.roleOf(parent);
    const api = message.message || {};
    this.countUsage(role, api);

    if (message.error) {
      this.emit('error', { message: `Model request failed (${message.error})`, agentId: parent });
    }

    for (const block of api.content || []) {
      if (block.type === 'text' && block.text?.trim()) {
        this.emit('text', { agentId: parent, role, text: block.text });
      } else if (block.type === 'tool_use') {
        if (SUBAGENT_TOOLS.has(block.name)) {
          const agent = {
            id: block.id,
            role: this.normalizeRole(block.input?.subagent_type),
            description: clip(block.input?.description || block.input?.prompt, 160),
            parent,
            status: 'running',
            startedAt: Date.now(),
          };
          this.agents.set(block.id, agent);
          this.emit('agent-start', { agent });
        } else {
          this.emit('tool', { agentId: parent, role, name: block.name, summary: this.summarizeTool(block.name, block.input) });
        }
      }
    }
  }

  handleUser(message) {
    const content = message.message?.content;
    if (!Array.isArray(content)) return;
    for (const block of content) {
      if (block.type !== 'tool_result') continue;
      const agent = this.agents.get(block.tool_use_id);
      if (!agent || agent.status !== 'running') continue;
      agent.status = block.is_error ? 'failed' : 'done';
      agent.endedAt = Date.now();
      const totals = message.tool_use_result && typeof message.tool_use_result === 'object' ? message.tool_use_result : {};
      if (Number.isFinite(totals.totalTokens)) agent.totalTokens = totals.totalTokens;
      if (Number.isFinite(totals.totalToolUseCount)) agent.toolUses = totals.totalToolUseCount;
      this.emit('agent-end', { agent, report: reportOf(block.content) });
    }
  }

  handleResult(message) {
    this.cost = message.total_cost_usd ?? this.cost;
    this.modelUsage = message.modelUsage ?? this.modelUsage;
    // Anything still marked running when the turn ends was interrupted.
    for (const agent of this.agents.values()) {
      if (agent.status === 'running') {
        agent.status = 'stopped';
        this.emit('agent-end', { agent, report: '' });
      }
    }
    const ok = message.subtype === 'success' && !message.is_error;
    this.emit('result', {
      ok,
      hint: ok ? undefined : authHint(message.result),
      subtype: message.subtype,
      text: typeof message.result === 'string' ? message.result : '',
      cost: this.cost,
      modelUsage: this.modelUsage,
      turns: message.num_turns,
      durationMs: message.duration_ms,
    });
    this.setStatus('idle');
  }

  countUsage(role, api) {
    const usage = api.usage;
    // One API response is delivered as several SDK messages (one per content
    // block) that repeat the same usage; count each response once.
    if (!usage || !api.id || this.seenMessageIds.has(api.id)) return;
    this.seenMessageIds.add(api.id);
    const bucket = (this.roleUsage[role] ||= { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, requests: 0, model: '' });
    bucket.input += usage.input_tokens || 0;
    bucket.output += usage.output_tokens || 0;
    bucket.cacheRead += usage.cache_read_input_tokens || 0;
    bucket.cacheWrite += usage.cache_creation_input_tokens || 0;
    bucket.requests += 1;
    if (api.model) bucket.model = api.model;
    this.emit('usage', { role, usage: bucket });
  }

  summarizeTool(name, input = {}) {
    const rel = (p) => {
      if (typeof p !== 'string') return '';
      const r = path.relative(this.projectDir, p);
      return r && !r.startsWith('..') && !path.isAbsolute(r) ? r.split(path.sep).join('/') : p;
    };
    switch (name) {
      case 'Bash':
      case 'PowerShell':
        return clip(input.command, 200);
      case 'Read':
      case 'Write':
      case 'Edit':
      case 'NotebookEdit':
        return rel(input.file_path || input.notebook_path);
      case 'Glob':
      case 'Grep':
        return clip(input.pattern, 120);
      case 'Skill':
        return clip(input.skill, 80);
      case 'WebSearch':
        return clip(input.query, 120);
      case 'WebFetch':
        return clip(input.url, 160);
      default: {
        const first = Object.values(input).find((v) => typeof v === 'string');
        return clip(first, 120);
      }
    }
  }

  // ---- Permissions ----------------------------------------------------------

  allowKey(toolName, input) {
    if (toolName === 'Bash' || toolName === 'PowerShell') {
      const first = String(input?.command || '').trim().split(/\s+/)[0] || '';
      return `${toolName}:${first}`;
    }
    return toolName;
  }

  async decide(toolName, input, options = {}) {
    const allow = { behavior: 'allow', updatedInput: input };
    const outsideProject = Boolean(options.blockedPath);
    const key = this.allowKey(toolName, input);

    // Access outside the project folder is always put to the user, even on autopilot.
    if (!outsideProject) {
      if (this.settings.permission === 'autopilot') return allow;
      if (this.alwaysAllow.has(key)) return allow;
    }

    const requestId = randomUUID();
    const decision = await new Promise((resolve) => {
      this.pending.set(requestId, resolve);
      options.signal?.addEventListener('abort', () => resolve({ allow: false, aborted: true }), { once: true });
      this.emit('permission-request', {
        requestId,
        // The SDK's runtime agent id is not the Agent tool_use id, so a request
        // from a subagent is attributed to "a team member" rather than guessed.
        role: options.agentID ? 'agent' : MANAGER,
        toolName,
        summary: this.summarizeTool(toolName, input),
        blockedPath: options.blockedPath || null,
        alwaysLabel: key.includes(':') ? `${key.split(':')[1]} commands` : toolName,
        canAlways: !outsideProject && !key.endsWith(':'),
      });
    });
    this.pending.delete(requestId);
    this.emit('permission-resolved', { requestId, allowed: Boolean(decision.allow) });

    if (!decision.allow) {
      return { behavior: 'deny', message: decision.aborted ? 'Cancelled.' : 'The user declined this action.' };
    }
    if (decision.always && !outsideProject) this.alwaysAllow.add(key);
    return allow;
  }

  answerPermission(requestId, { allow, always }) {
    const resolve = this.pending.get(requestId);
    if (!resolve) throw new Error('That request is no longer waiting.');
    resolve({ allow: Boolean(allow), always: Boolean(always) });
  }

  rejectPending(reason) {
    for (const resolve of this.pending.values()) resolve({ allow: false, aborted: true, reason });
    this.pending.clear();
  }

  // ---- Controls -------------------------------------------------------------

  send(text) {
    const body = String(text ?? '').trim();
    if (!body) throw new Error('Type a message first.');
    if (this.status === 'ended' || this.status === 'error') throw new Error('This session has ended. Start a new run.');
    this.emit('user', { text: body });
    this.input.push(userMessage(body));
    this.setStatus('running');
  }

  async stop() {
    if (this.status !== 'running') return;
    this.rejectPending('Stopped.');
    try {
      await this.query?.interrupt();
    } catch {
      this.end();
    }
  }

  end() {
    this.rejectPending('The session ended.');
    this.input.close();
    this.abort.abort();
    if (this.status !== 'error') this.setStatus('ended');
  }

  // ---- Handoff files --------------------------------------------------------

  handoffFiles() {
    const dir = path.join(this.projectDir, '.studio');
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir)
      .filter((f) => f.endsWith('.md'))
      .map((f) => {
        const stat = fs.statSync(path.join(dir, f));
        return { name: f, size: stat.size, modifiedAt: stat.mtimeMs };
      })
      .sort((a, b) => a.modifiedAt - b.modifiedAt);
  }

  readHandoffFile(name) {
    const safe = path.basename(String(name));
    if (safe !== name || !safe.endsWith('.md')) throw new Error('Not a handoff file.');
    const file = path.join(this.projectDir, '.studio', safe);
    return fs.readFileSync(file, 'utf8').slice(0, 400_000);
  }
}

/** One cheap request to confirm the SDK can reach Claude with the current login. */
export async function checkConnection() {
  if (isDemo()) return { ok: true, claudeCodeVersion: 'demo', demo: true };
  const info = { ok: false };
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), 60_000);
  let stderr = '';
  try {
    const q = query({
      prompt: 'Reply with the single word: ready',
      options: {
        cwd: os.tmpdir(),
        model: 'haiku',
        maxTurns: 1,
        env: sdkEnv(),
        settingSources: [],
        allowedTools: [],
        abortController: abort,
        stderr: (chunk) => {
          stderr = (stderr + chunk).slice(-1500);
        },
      },
    });
    for await (const message of q) {
      if (message.type === 'system' && message.subtype === 'init') {
        info.claudeCodeVersion = message.claude_code_version;
        info.apiKeySource = message.apiKeySource;
        info.model = message.model;
      } else if (message.type === 'result') {
        info.ok = message.subtype === 'success' && !message.is_error;
        info.reply = typeof message.result === 'string' ? clip(message.result, 80) : '';
        info.cost = message.total_cost_usd;
        if (!info.ok) info.error = clip(message.result || message.subtype, 300);
      }
    }
  } catch (error) {
    info.error = clip(`${error?.message || error} ${stderr}`, 500);
  } finally {
    clearTimeout(timer);
  }
  if (!info.ok) info.hint = authHint(info.error);
  return info;
}
