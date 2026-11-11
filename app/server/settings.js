// App settings, stored per user outside the project so they survive updates.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { MODELS } from './plugin.js';

const DIR = path.join(os.homedir(), '.kmp-agent-studio');
const FILE = path.join(DIR, 'settings.json');

const DEFAULTS = {
  // The manager session sees every handoff, so it is the most-repeated context
  // in a run. Sonnet keeps that cheap; design and code go to Opus roles.
  managerModel: 'sonnet',
  // 'ask': commands and out-of-project access need approval in the app.
  // 'autopilot': approve everything inside the project folder automatically.
  permission: 'ask',
  // Load ~/.claude settings so skills installed in Claude Code are available.
  loadUserSettings: true,
  recentProjects: [],
};

export function loadSettings() {
  try {
    return sanitize({ ...DEFAULTS, ...JSON.parse(fs.readFileSync(FILE, 'utf8')) });
  } catch {
    return { ...DEFAULTS };
  }
}

function sanitize(s) {
  return {
    managerModel: MODELS.includes(s.managerModel) ? s.managerModel : DEFAULTS.managerModel,
    permission: s.permission === 'autopilot' ? 'autopilot' : 'ask',
    loadUserSettings: s.loadUserSettings !== false,
    recentProjects: Array.isArray(s.recentProjects)
      ? s.recentProjects.filter((p) => typeof p === 'string').slice(0, 8)
      : [],
  };
}

export function saveSettings(patch) {
  const next = sanitize({ ...loadSettings(), ...patch });
  fs.mkdirSync(DIR, { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(next, null, 2), 'utf8');
  return next;
}

export function rememberProject(dir) {
  const current = loadSettings();
  const recentProjects = [dir, ...current.recentProjects.filter((p) => p !== dir)].slice(0, 8);
  return saveSettings({ recentProjects });
}
