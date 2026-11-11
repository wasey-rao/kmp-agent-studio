// Reads and edits the kmp-studio plugin on disk: role agents, skills and commands.
// The plugin's markdown files are the single source of truth, so a model changed
// in the app is also what Claude Code uses when the plugin is loaded there.
import fs from 'node:fs';
import path from 'node:path';

export const MODELS = ['haiku', 'sonnet', 'opus', 'fable'];

// Pipeline order, used to sort the team roster.
const ROLE_ORDER = [
  'product-manager', 'researcher', 'scout', 'architect', 'build-engineer',
  'kmp-developer', 'ui-developer', 'platform-integrator',
  'qa-engineer', 'code-reviewer', 'release-manager', 'tech-writer',
];

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

export function parseFrontmatter(text) {
  const match = FRONTMATTER.exec(text);
  if (!match) return { data: {}, body: text };
  const data = {};
  for (const line of match[1].split(/\r?\n/)) {
    const kv = /^([A-Za-z][\w-]*):\s*(.*)$/.exec(line);
    if (kv) data[kv[1]] = kv[2].replace(/^["']|["']$/g, '').trim();
  }
  return { data, body: text.slice(match[0].length) };
}

function readMarkdownFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((f) => f.endsWith('.md'))
    .map((f) => ({ file: path.join(dir, f), base: f.slice(0, -3) }));
}

export function listAgents(pluginDir) {
  const agents = readMarkdownFiles(path.join(pluginDir, 'agents')).map(({ file, base }) => {
    const { data } = parseFrontmatter(fs.readFileSync(file, 'utf8'));
    return {
      name: data.name || base,
      description: data.description || '',
      model: data.model || 'inherit',
      color: data.color || '',
      readOnly: Boolean(data.tools) && !/\b(Write|Edit|Bash)\b/.test(data.tools),
      file,
    };
  });
  const rank = (name) => {
    const i = ROLE_ORDER.indexOf(name);
    return i === -1 ? ROLE_ORDER.length : i;
  };
  return agents.sort((a, b) => rank(a.name) - rank(b.name) || a.name.localeCompare(b.name));
}

export function setAgentModel(pluginDir, agentName, model) {
  if (!MODELS.includes(model)) throw new Error(`Unknown model "${model}"`);
  // Resolve through the listing so a crafted name can never address another path.
  const agent = listAgents(pluginDir).find((a) => a.name === agentName);
  if (!agent) throw new Error(`Unknown role "${agentName}"`);
  const text = fs.readFileSync(agent.file, 'utf8');
  const match = FRONTMATTER.exec(text);
  if (!match) throw new Error(`${path.basename(agent.file)} has no frontmatter`);
  const eol = match[0].includes('\r\n') ? '\r\n' : '\n';
  const lines = match[1].split(/\r?\n/);
  const index = lines.findIndex((l) => /^model:/.test(l));
  if (index === -1) lines.push(`model: ${model}`);
  else lines[index] = `model: ${model}`;
  const updated = `---${eol}${lines.join(eol)}${eol}---${eol}${text.slice(match[0].length)}`;
  fs.writeFileSync(agent.file, updated, 'utf8');
  return { ...agent, model };
}

export function listSkills(pluginDir) {
  const root = path.join(pluginDir, 'skills');
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root, { withFileTypes: true })
    .filter((d) => d.isDirectory() && fs.existsSync(path.join(root, d.name, 'SKILL.md')))
    .map((d) => {
      const { data } = parseFrontmatter(fs.readFileSync(path.join(root, d.name, 'SKILL.md'), 'utf8'));
      return { name: data.name || d.name, description: data.description || '' };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function listCommands(pluginDir) {
  return readMarkdownFiles(path.join(pluginDir, 'commands')).map(({ file, base }) => {
    const { data, body } = parseFrontmatter(fs.readFileSync(file, 'utf8'));
    return { name: base, description: data.description || '', hint: data['argument-hint'] || '', body };
  });
}

/** Returns the prompt for a pipeline command with the user's text substituted in. */
export function renderCommand(pluginDir, commandName, args) {
  const command = listCommands(pluginDir).find((c) => c.name === commandName);
  if (!command) throw new Error(`Unknown command "${commandName}"`);
  // A function replacement keeps `$` sequences in the user's text literal.
  return command.body.replace(/\$ARGUMENTS/g, () => args).trim();
}

export function pluginName(pluginDir) {
  try {
    const manifest = JSON.parse(fs.readFileSync(path.join(pluginDir, '.claude-plugin', 'plugin.json'), 'utf8'));
    return manifest.name || path.basename(pluginDir);
  } catch {
    return path.basename(pluginDir);
  }
}
