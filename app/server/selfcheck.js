// `npm run check`: verifies the plugin on disk and the connection to Claude.
// Pass --offline to skip the one small Haiku request.
import { DEFAULT_PLUGIN_DIR } from './server.js';
import { listAgents, listSkills, listCommands, renderCommand } from './plugin.js';
import { checkConnection } from './runs.js';

const pluginDir = process.env.KMP_STUDIO_PLUGIN_DIR || DEFAULT_PLUGIN_DIR;
let failed = false;
const fail = (message) => {
  failed = true;
  console.error(`  FAIL  ${message}`);
};

const agents = listAgents(pluginDir);
const skills = listSkills(pluginDir);
const commands = listCommands(pluginDir);

console.log(`Plugin: ${pluginDir}`);
console.log(`  ${agents.length} roles, ${skills.length} skills, ${commands.length} commands`);
for (const agent of agents) console.log(`  ${agent.model.padEnd(7)} ${agent.name}`);

if (!agents.length) fail('no role agents found');
if (!skills.length) fail('no skills found');
for (const agent of agents) if (!agent.description) fail(`${agent.name} has no description`);
for (const skill of skills) if (!skill.description) fail(`${skill.name} has no description`);
for (const name of ['build-app', 'add-feature', 'fix-bug']) {
  try {
    const prompt = renderCommand(pluginDir, name, 'TEST $& REQUEST');
    if (!prompt.includes('TEST $& REQUEST') || prompt.includes('$ARGUMENTS')) fail(`${name} did not substitute its arguments`);
  } catch (error) {
    fail(error.message);
  }
}

if (!process.argv.includes('--offline')) {
  console.log('Connection: sending one small Haiku request...');
  const result = await checkConnection();
  if (result.ok) {
    console.log(`  OK  Claude Code ${result.claudeCodeVersion}, model ${result.model}, credential source: ${result.apiKeySource}`);
  } else {
    fail(`could not reach Claude: ${result.error || 'unknown error'}`);
  }
}

console.log(failed ? 'Self-check failed.' : 'Self-check passed.');
process.exit(failed ? 1 : 0);
