// KMP Agent Studio UI. All dynamic text is set through textContent; nothing
// from a model or a file is ever inserted as HTML.

const $ = (id) => document.getElementById(id);

function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === null || value === undefined || value === false) continue;
    if (key === 'class') el.className = value;
    else if (key === 'text') el.textContent = value;
    else if (key.startsWith('on')) el.addEventListener(key.slice(2), value);
    else if (key in el) el[key] = value;
    else el.setAttribute(key, value);
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return el;
}

// Small Markdown renderer for what the team writes: headings, lists, code
// blocks, tables (kept as aligned text), inline code and bold. It only builds
// elements and sets text, so nothing in a reply can inject markup.
function inlineMd(text) {
  const out = [];
  const pattern = /(`[^`\n]+`)|(\*\*[^*\n]+\*\*)/g;
  let last = 0;
  let match;
  while ((match = pattern.exec(text))) {
    if (match.index > last) out.push(text.slice(last, match.index));
    out.push(match[1]
      ? h('code', { text: match[1].slice(1, -1) })
      : h('strong', {}, ...inlineMd(match[2].slice(2, -2))));
    last = pattern.lastIndex;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

function markdown(text, extraClass = '') {
  const root = h('div', { class: `md ${extraClass}`.trim() });
  let list = null; // open <ul>/<ol>
  let block = null; // open <p> or <li> that a following line continues
  let code = null; // lines of an open ``` block
  let table = null; // lines of an open | table |
  const flushPre = () => {
    const lines = code || table;
    if (lines) root.append(h('pre', {}, h('code', { text: lines.join('\n') })));
    code = null;
    table = null;
  };

  for (const line of String(text ?? '').replace(/\r\n/g, '\n').split('\n')) {
    if (code) {
      if (/^\s*```/.test(line)) flushPre();
      else code.push(line);
      continue;
    }
    if (/^\s*```/.test(line)) {
      flushPre();
      list = block = null;
      code = [];
      continue;
    }
    if (/^\s*\|/.test(line)) {
      list = block = null;
      (table ||= []).push(line.trim());
      continue;
    }
    if (table) flushPre();

    if (!line.trim()) {
      list = block = null;
      continue;
    }
    const heading = line.match(/^\s{0,3}#{1,6}\s+(.*)$/);
    if (heading) {
      list = block = null;
      root.append(h('div', { class: 'md-h' }, ...inlineMd(heading[1])));
      continue;
    }
    const item = line.match(/^(\s*)([-*•]|\d+[.)])\s+(.*)$/);
    if (item) {
      const tag = /\d/.test(item[2]) ? 'OL' : 'UL';
      if (!list || list.tagName !== tag) {
        list = h(tag.toLowerCase());
        root.append(list);
      }
      block = h('li', { class: item[1].length >= 2 ? 'sub' : null }, ...inlineMd(item[3]));
      list.append(block);
      continue;
    }
    if (block) {
      block.append(' ', ...inlineMd(line.trim()));
    } else {
      list = null;
      block = h('p', {}, ...inlineMd(line.trim()));
      root.append(block);
    }
  }
  flushPre();
  return root;
}

async function api(path, body) {
  const res = await fetch(path, body === undefined ? {} : {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

// ---- Formatting -------------------------------------------------------------

const MANAGER = 'manager';
const titleCase = (name) => name === 'kmp-developer' ? 'KMP Developer'
  : name === 'ui-developer' ? 'UI Developer'
  : name === 'qa-engineer' ? 'QA Engineer'
  : name.split('-').map((w) => w[0].toUpperCase() + w.slice(1)).join(' ');
const roleLabel = (role) => role === MANAGER ? 'Engineering Manager' : role === 'agent' ? 'A team member' : titleCase(role);

function fmtTokens(n) {
  if (!n) return '0';
  if (n >= 1e6) return `${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(n >= 1e4 ? 0 : 1)}k`;
  return String(n);
}
const fmtCost = (usd) => usd === null || usd === undefined ? '–' : `$${usd < 1 ? usd.toFixed(3) : usd.toFixed(2)}`;
function fmtDuration(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`;
}
const fmtSize = (bytes) => bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} kB`;
const tierOf = (model) => ['haiku', 'sonnet', 'opus', 'fable'].find((t) => String(model || '').includes(t)) || '';
const shortModel = (id) => String(id).replace(/^claude-/, '').replace(/-\d{8}$/, '').replace(/\[.*\]$/, '');
const totalTokens = (u) => (u.input || 0) + (u.output || 0) + (u.cacheRead || 0) + (u.cacheWrite || 0);

// ---- State ------------------------------------------------------------------

let app = null;
let run = null; // { id, status, projectDir, lastSeq, agents: Map, roleUsage, cost, modelUsage }
const agentCards = new Map();
const permCards = new Map();

const MODES = {
  build: { label: 'Describe the app', hint: 'Full pipeline: spec, research, architecture, scaffold, implementation, QA, review and release prep.' },
  feature: { label: 'Describe the feature', hint: 'For an existing project: maps the code, designs the change, implements, tests and reviews it.' },
  fix: { label: 'Describe the bug or paste the error', hint: 'The smallest team that can do it: locate, fix at the root cause, confirm with a test.' },
  chat: { label: 'Your question or request', hint: 'The manager answers directly and brings in a role only when the work needs one.' },
};

// ---- Team roster ------------------------------------------------------------

function modelSelect(value, onChange, label) {
  const select = h('select', { class: `model-${value}`, 'aria-label': label },
    app.models.map((m) => h('option', { value: m, text: m, selected: m === value })));
  select.addEventListener('change', async () => {
    const next = select.value;
    select.disabled = true;
    try {
      await onChange(next);
      select.className = `model-${next}`;
    } catch (error) {
      select.value = value;
      alert(error.message);
    } finally {
      select.disabled = false;
    }
  });
  return select;
}

function renderRoster() {
  const roster = $('roster');
  roster.replaceChildren();
  const card = (role, description, select) => h('div', { class: 'role', 'data-role': role, title: description },
    h('div', { class: 'role-name' }, h('i', { class: 'dot' }), h('span', { text: roleLabel(role) })),
    select,
    h('div', { class: 'role-desc', text: description }),
    h('div', { class: 'role-foot' }, h('span', { class: 'role-state' }), h('span', { class: 'role-tokens' })));

  roster.append(card(MANAGER, 'Coordinates the roles, passes work between them and reports back to you.',
    modelSelect(app.settings.managerModel, async (model) => {
      app.settings = (await api('/api/settings', { managerModel: model })).settings;
    }, 'Model for Engineering Manager')));

  for (const agent of app.agents) {
    roster.append(card(agent.name, agent.description,
      modelSelect(agent.model, async (model) => {
        agent.model = (await api('/api/agents/model', { name: agent.name, model })).agent.model;
      }, `Model for ${roleLabel(agent.name)}`)));
  }
  updateRoster();
}

function updateRoster() {
  const working = {};
  const done = {};
  if (run) {
    for (const agent of run.agents.values()) {
      if (agent.status === 'running') working[agent.role] = (working[agent.role] || 0) + 1;
      else done[agent.role] = (done[agent.role] || 0) + 1;
    }
    if (run.status === 'running' || run.status === 'starting') working[MANAGER] = 1;
  }
  for (const el of $('roster').children) {
    const role = el.dataset.role;
    const usage = run?.roleUsage[role];
    el.classList.toggle('working', Boolean(working[role]));
    el.classList.toggle('done', !working[role] && Boolean(done[role]));
    el.querySelector('.role-state').textContent = working[role]
      ? (role === MANAGER ? 'Coordinating' : working[role] > 1 ? `Working on ${working[role]} tasks` : 'Working')
      : done[role] ? `${done[role]} task${done[role] > 1 ? 's' : ''} finished` : '';
    el.querySelector('.role-tokens').textContent = usage ? `${fmtTokens(totalTokens(usage))} tokens` : '';
  }
}

// ---- Usage panel ------------------------------------------------------------

function renderUsage() {
  $('total-cost').textContent = fmtCost(run?.cost);
  $('cost-note').textContent = run?.cost == null ? 'Cost appears when a turn finishes.' : 'API-rate cost of this session so far.';

  const models = $('model-usage');
  models.replaceChildren();
  if (run?.modelUsage && Object.keys(run.modelUsage).length) {
    models.append(h('table', { class: 'models' },
      h('thead', {}, h('tr', {}, ['Model', 'In', 'Out', 'Cost'].map((t) => h('th', { text: t })))),
      h('tbody', {}, Object.entries(run.modelUsage)
        .sort((a, b) => (b[1].costUSD || 0) - (a[1].costUSD || 0))
        .map(([id, u]) => h('tr', {},
          h('td', {}, h('span', { class: `badge model-${tierOf(id)}`, text: shortModel(id) })),
          h('td', { text: fmtTokens((u.inputTokens || 0) + (u.cacheReadInputTokens || 0) + (u.cacheCreationInputTokens || 0)) }),
          h('td', { text: fmtTokens(u.outputTokens || 0) }),
          h('td', { text: fmtCost(u.costUSD) }))))));
  }

  const roles = $('role-usage');
  roles.replaceChildren();
  const entries = Object.entries(run?.roleUsage || {}).sort((a, b) => totalTokens(b[1]) - totalTokens(a[1]));
  if (!entries.length) {
    roles.append(h('p', { class: 'hint', text: run ? 'Waiting for the first response.' : 'No run yet.' }));
    return;
  }
  const max = totalTokens(entries[0][1]) || 1;
  for (const [role, usage] of entries) {
    const fill = h('i', { class: `model-${tierOf(usage.model)}` });
    fill.style.width = `${Math.max(2, Math.round((totalTokens(usage) / max) * 100))}%`;
    roles.append(h('div', { class: 'usage-row', title: `${shortModel(usage.model)} · ${usage.requests} requests · cached input ${fmtTokens(usage.cacheRead)}` },
      h('span', { class: 'name', text: roleLabel(role) }),
      h('span', { class: 'num', text: `in ${fmtTokens(usage.input + usage.cacheRead + usage.cacheWrite)} · out ${fmtTokens(usage.output)}` }),
      h('div', { class: 'bar' }, fill)));
  }
}

// ---- Handoff files ----------------------------------------------------------

let handoffTimer = null;
function refreshHandoffSoon() {
  clearTimeout(handoffTimer);
  handoffTimer = setTimeout(refreshHandoff, 400);
}

async function refreshHandoff() {
  if (!run) return;
  const runId = run.id;
  try {
    const { files } = await api(`/api/runs/${runId}/files`);
    if (run?.id !== runId) return;
    const box = $('handoff');
    box.replaceChildren();
    if (!files.length) {
      box.append(h('p', { class: 'hint' }, 'Roles pass work through files in ', h('code', { text: '.studio/' }), '.'));
      return;
    }
    for (const file of files) {
      box.append(h('button', { type: 'button', class: 'file-link', onclick: () => openFile(runId, file.name) },
        h('span', { text: file.name }), h('span', { text: fmtSize(file.size) })));
    }
  } catch { /* the folder may not exist yet */ }
}

async function openFile(runId, name) {
  try {
    const { content } = await api(`/api/runs/${runId}/file?name=${encodeURIComponent(name)}`);
    $('file-title').textContent = `.studio/${name}`;
    $('file-content').textContent = content;
    $('file-dialog').showModal();
  } catch (error) {
    alert(error.message);
  }
}

// ---- Activity feed ----------------------------------------------------------

function addToFeed(el) {
  const feed = $('feed');
  const pinned = feed.scrollHeight - feed.scrollTop - feed.clientHeight < 80;
  feed.append(el);
  if (pinned) feed.scrollTop = feed.scrollHeight;
}

function agentMeta(card, agent) {
  const parts = [];
  if (card.tools) parts.push(`${card.tools} action${card.tools > 1 ? 's' : ''}`);
  if (agent.endedAt) parts.push(fmtDuration(agent.endedAt - agent.startedAt));
  if (agent.totalTokens) parts.push(`${fmtTokens(agent.totalTokens)} tokens`);
  card.meta.textContent = parts.join(' · ');
}

function applyEvent(ev) {
  if (!run || ev.runId !== run.id || ev.seq <= run.lastSeq) return;
  run.lastSeq = ev.seq;

  switch (ev.type) {
    case 'run-start':
      addToFeed(h('div', { class: 'item user' },
        h('div', { class: 'item-head' }, h('span', { class: 'item-title', text: 'Your request' })),
        h('div', { class: 'item-body', text: ev.prompt })));
      break;

    case 'user':
      addToFeed(h('div', { class: 'item user' },
        h('div', { class: 'item-head' }, h('span', { class: 'item-title', text: 'You' })),
        h('div', { class: 'item-body', text: ev.text })));
      break;

    case 'session':
      addToFeed(h('div', { class: 'line' },
        h('span', { class: 'tool', text: 'Session started' }),
        h('span', { class: 'what', text: `manager on ${shortModel(ev.model)} · Claude Code ${ev.claudeCodeVersion} · ${ev.agents} roles loaded` })));
      if (!ev.pluginLoaded) {
        addToFeed(h('div', { class: 'item error' },
          h('div', { class: 'item-body', text: 'The role plugin did not load, so the manager cannot delegate to the team. Check that the kmp-studio folder sits next to the app folder.' })));
      }
      break;

    case 'status':
      run.status = ev.status;
      renderRunBar();
      updateRoster();
      break;

    case 'text':
      if (ev.agentId && agentCards.has(ev.agentId)) {
        agentCards.get(ev.agentId).now.textContent = ev.text.replace(/\s+/g, ' ').trim();
      } else {
        if (ev.role === MANAGER) run.lastManagerText = ev.text.trim();
        addToFeed(h('div', { class: 'item' },
          h('div', { class: 'item-head' }, h('span', { class: 'item-title', text: roleLabel(ev.role) })),
          markdown(ev.text, 'item-body')));
      }
      break;

    case 'tool':
      if (ev.agentId && agentCards.has(ev.agentId)) {
        const card = agentCards.get(ev.agentId);
        card.tools += 1;
        card.now.textContent = `${ev.name}  ${ev.summary}`;
        agentMeta(card, run.agents.get(ev.agentId));
      } else {
        addToFeed(h('div', { class: 'line' },
          h('span', { text: roleLabel(ev.role) }),
          h('span', { class: 'tool', text: ev.name }),
          h('span', { class: 'what', text: ev.summary, title: ev.summary })));
      }
      break;

    case 'agent-start': {
      const agent = ev.agent;
      run.agents.set(agent.id, agent);
      const model = app.agents.find((a) => a.name === agent.role)?.model || '';
      const status = h('span', { class: 'spinner', role: 'img', 'aria-label': 'Working' });
      const meta = h('span', { class: 'item-meta' });
      const now = h('div', { class: 'agent-now', text: 'Starting…' });
      const el = h('div', { class: `item agent${agent.parent ? ' nested' : ''}` },
        h('div', { class: 'item-head' },
          status,
          h('span', { class: 'item-title', text: roleLabel(agent.role) }),
          model && h('span', { class: `badge model-${tierOf(model)}`, text: model }),
          meta),
        h('div', { class: 'agent-task', text: agent.description }),
        now);
      agentCards.set(agent.id, { el, status, meta, now, tools: 0 });
      addToFeed(el);
      updateRoster();
      break;
    }

    case 'agent-end': {
      const agent = ev.agent;
      run.agents.set(agent.id, agent);
      const card = agentCards.get(agent.id);
      if (card) {
        const ok = agent.status === 'done';
        card.status.replaceWith(h('span', {
          class: ok ? 'check' : 'cross',
          text: ok ? '✓' : '✕',
          title: ok ? 'Finished' : agent.status === 'stopped' ? 'Stopped' : 'Failed',
        }));
        card.now.remove();
        agentMeta(card, agent);
        if (ev.report) {
          card.el.append(h('details', { class: 'report' }, h('summary', { text: 'Report' }), markdown(ev.report)));
        }
      }
      updateRoster();
      refreshHandoffSoon();
      break;
    }

    case 'usage':
      run.roleUsage[ev.role] = ev.usage;
      updateRoster();
      renderUsage();
      break;

    case 'permission-request': {
      const answer = async (allow, always) => {
        try {
          await api(`/api/runs/${run.id}/permission`, { requestId: ev.requestId, allow, always });
        } catch (error) {
          alert(error.message);
        }
      };
      const actions = h('div', { class: 'perm-actions' },
        h('button', { type: 'button', class: 'btn primary small', text: 'Allow once', onclick: () => answer(true, false) }),
        ev.canAlways && h('button', { type: 'button', class: 'btn small', text: `Always allow ${ev.alwaysLabel}`, onclick: () => answer(true, true) }),
        h('button', { type: 'button', class: 'btn danger small', text: 'Deny', onclick: () => answer(false, false) }));
      const el = h('div', { class: 'item permission' },
        h('div', { class: 'item-head' },
          h('span', { class: 'item-title', text: `${roleLabel(ev.role)} wants to use ${ev.toolName}` }),
          h('span', { class: 'item-meta', text: 'Needs your approval' })),
        h('div', { class: 'item-body' }, h('code', { text: ev.summary })),
        ev.blockedPath && h('div', { class: 'hint', text: `This reaches outside the project folder: ${ev.blockedPath}` }),
        actions);
      permCards.set(ev.requestId, { el, actions, meta: el.querySelector('.item-meta') });
      addToFeed(el);
      break;
    }

    case 'permission-resolved': {
      const card = permCards.get(ev.requestId);
      if (card) {
        card.actions.remove();
        card.meta.textContent = ev.allowed ? 'Allowed' : 'Denied';
        card.el.classList.add('resolved');
      }
      break;
    }

    case 'result': {
      run.cost = ev.cost ?? run.cost;
      if (ev.modelUsage && Object.keys(ev.modelUsage).length) run.modelUsage = ev.modelUsage;
      // The SDK's result text is the manager's last message, which is already in the feed.
      const repeated = ev.ok && ev.text.trim() === run.lastManagerText;
      addToFeed(h('div', { class: `item result${ev.ok ? '' : ' failed'}` },
        h('div', { class: 'item-head' },
          h('span', { class: 'item-title', text: !ev.ok ? 'The turn ended early' : repeated ? 'Turn finished' : 'Team report' }),
          h('span', { class: 'item-meta', text: [ev.durationMs && fmtDuration(ev.durationMs), fmtCost(ev.cost)].filter(Boolean).join(' · ') })),
        !repeated && markdown(ev.text || (ev.ok ? 'Done.' : `Stopped (${ev.subtype}).`), 'item-body'),
        ev.hint && h('div', { class: 'hint', text: ev.hint })));
      renderUsage();
      refreshHandoffSoon();
      break;
    }

    case 'error':
      addToFeed(h('div', { class: 'item error' },
        h('div', { class: 'item-head' }, h('span', { class: 'item-title', text: 'Something went wrong' })),
        h('div', { class: 'item-body', text: ev.message }),
        ev.detail && h('div', { class: 'hint', text: ev.detail }),
        ev.hint && h('div', { class: 'hint', text: ev.hint })));
      break;

    default:
      break;
  }
}

// ---- Run view ---------------------------------------------------------------

const STATUS_TEXT = { starting: 'Starting', running: 'Working', idle: 'Waiting for you', ended: 'Ended', error: 'Error' };

function renderRunBar() {
  const pill = $('run-status');
  pill.textContent = STATUS_TEXT[run.status] || run.status;
  pill.className = `status-pill ${run.status}`;
  $('run-project').textContent = run.projectDir;
  $('run-project').title = run.projectDir;
  $('stop-btn').disabled = run.status !== 'running';
  const over = run.status === 'ended' || run.status === 'error';
  $('followup-input').disabled = over;
  $('followup').querySelector('button').disabled = over;
  $('followup-input').placeholder = over ? 'This session has ended. Start a new run.' : 'Send a follow-up to the team';
}

function showRun(summary) {
  run = { ...summary, lastSeq: 0, agents: new Map(), roleUsage: {}, cost: summary.cost ?? null, modelUsage: null };
  agentCards.clear();
  permCards.clear();
  $('feed').replaceChildren();
  $('composer').hidden = true;
  $('run-view').hidden = false;
  $('open-folder-btn').hidden = !window.studioNative;
  renderRunBar();
  updateRoster();
  renderUsage();
  refreshHandoff();
}

function showComposer() {
  run = null;
  $('run-view').hidden = true;
  $('composer').hidden = false;
  $('handoff').replaceChildren(h('p', { class: 'hint' }, 'Roles pass work through files in ', h('code', { text: '.studio/' }), '.'));
  updateRoster();
  renderUsage();
}

/** Loads everything the server has for the current run and applies what is new. */
async function syncRun() {
  if (!run) return;
  const snapshot = await api(`/api/runs/${run.id}`);
  for (const ev of snapshot.events) applyEvent(ev);
  run.status = snapshot.status;
  renderRunBar();
  updateRoster();
  renderUsage();
}

// ---- Wiring -----------------------------------------------------------------

function applyMode() {
  const mode = new FormData($('composer')).get('mode');
  $('prompt-label').textContent = MODES[mode].label;
  $('mode-hint').textContent = MODES[mode].hint;
}

function renderStatic() {
  renderRoster();
  $('skills').replaceChildren(...app.skills.map((s) => h('li', { text: s.name, title: s.description })));
  $('recent-projects').replaceChildren(...app.settings.recentProjects.map((p) => h('option', { value: p })));
  if (!$('project-dir').value && app.settings.recentProjects[0]) $('project-dir').value = app.settings.recentProjects[0];
  $('browse-btn').hidden = !window.studioNative;
  $('demo-badge').hidden = !app.demo;
  applyMode();
}

$('composer').addEventListener('change', applyMode);

$('composer').addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = $('start-btn');
  $('composer-error').textContent = '';
  button.disabled = true;
  try {
    const { run: summary } = await api('/api/runs', {
      mode: new FormData($('composer')).get('mode'),
      prompt: $('prompt').value,
      projectDir: $('project-dir').value,
    });
    showRun(summary);
    await syncRun();
    $('prompt').value = '';
  } catch (error) {
    $('composer-error').textContent = error.message;
  } finally {
    button.disabled = false;
  }
});

$('browse-btn').addEventListener('click', async () => {
  const dir = await window.studioNative.pickFolder();
  if (dir) $('project-dir').value = dir;
});

$('open-folder-btn').addEventListener('click', () => window.studioNative.openFolder(run.projectDir));

$('followup').addEventListener('submit', async (event) => {
  event.preventDefault();
  const input = $('followup-input');
  if (!input.value.trim()) return;
  try {
    await api(`/api/runs/${run.id}/message`, { text: input.value });
    input.value = '';
  } catch (error) {
    alert(error.message);
  }
});

$('stop-btn').addEventListener('click', async () => {
  try {
    await api(`/api/runs/${run.id}/stop`, {});
  } catch (error) {
    alert(error.message);
  }
});

$('new-run-btn').addEventListener('click', async () => {
  if (run.status === 'running' && !confirm('The team is still working. End this session and start a new run?')) return;
  if (run.status !== 'ended' && run.status !== 'error') {
    try {
      await api(`/api/runs/${run.id}/end`, {});
    } catch { /* already gone */ }
  }
  app = await api('/api/state');
  renderStatic();
  showComposer();
});

$('check-btn').addEventListener('click', async () => {
  const chip = $('connection');
  const button = $('check-btn');
  button.disabled = true;
  chip.className = 'connection';
  chip.textContent = 'Checking…';
  try {
    const result = await api('/api/check', {});
    chip.className = `connection ${result.ok ? 'ok' : 'bad'}`;
    chip.textContent = result.ok
      ? `Connected · Claude Code ${result.claudeCodeVersion}`
      : `Not connected: ${result.error || 'unknown error'}`;
    chip.title = chip.textContent;
    $('notice').hidden = result.ok || !result.hint;
    $('notice').textContent = result.hint || '';
  } catch (error) {
    chip.className = 'connection bad';
    chip.textContent = error.message;
  } finally {
    button.disabled = false;
  }
});

$('settings-btn').addEventListener('click', () => {
  $('manager-model').replaceChildren(...app.models.map((m) => h('option', { value: m, text: m, selected: m === app.settings.managerModel })));
  for (const radio of document.querySelectorAll('input[name="permission"]')) radio.checked = radio.value === app.settings.permission;
  $('load-user-settings').checked = app.settings.loadUserSettings;
  $('settings-dialog').showModal();
});
$('settings-cancel').addEventListener('click', () => $('settings-dialog').close());
$('settings-form').addEventListener('submit', async () => {
  try {
    app.settings = (await api('/api/settings', {
      managerModel: $('manager-model').value,
      permission: document.querySelector('input[name="permission"]:checked')?.value,
      loadUserSettings: $('load-user-settings').checked,
    })).settings;
    renderRoster();
  } catch (error) {
    alert(error.message);
  }
});
$('file-close').addEventListener('click', () => $('file-dialog').close());

async function init() {
  app = await api('/api/state');
  renderStatic();
  renderUsage();

  // Reattach to a session that is still alive (after a reload, for example).
  const live = app.runs.find((r) => r.status !== 'ended' && r.status !== 'error');
  if (live) showRun(live);

  const events = new EventSource('/api/events');
  events.onmessage = (message) => applyEvent(JSON.parse(message.data));
  // Runs on first connect and on every reconnect, so nothing is missed in between.
  events.onopen = () => syncRun().catch(() => {});
}

init().catch((error) => {
  document.body.replaceChildren(h('p', { class: 'error-text', text: `Could not load the studio: ${error.message}` }));
});
