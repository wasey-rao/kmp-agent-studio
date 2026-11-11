// Local HTTP server for the studio UI. Electron opens a window on it; `npm run web`
// serves the same UI to a browser. It listens on loopback only.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MODELS, listAgents, listSkills, listCommands, setAgentModel, pluginName } from './plugin.js';
import { loadSettings, saveSettings, rememberProject } from './settings.js';
import { RunManager, checkConnection, isDemo } from './runs.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(HERE, '..', 'public');
export const DEFAULT_PLUGIN_DIR = path.resolve(HERE, '..', '..', 'kmp-studio');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
};

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > 1_000_000) {
        reject(new HttpError(413, 'Request too large'));
        req.destroy();
      } else chunks.push(chunk);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(new HttpError(400, 'Invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}

/**
 * Starts the studio server.
 * @param {{ port?: number, pluginDir?: string }} [options]
 * @returns {Promise<{ url: string, port: number, close: () => Promise<void> }>}
 */
export async function startServer({ port = 0, pluginDir = DEFAULT_PLUGIN_DIR } = {}) {
  if (!fs.existsSync(path.join(pluginDir, 'agents'))) {
    throw new Error(`Plugin not found at ${pluginDir}`);
  }

  const clients = new Set();
  const broadcast = (event) => {
    const frame = `data: ${JSON.stringify(event)}\n\n`;
    for (const res of clients) res.write(frame);
  };
  const runs = new RunManager({ pluginDir, getSettings: loadSettings, broadcast });

  const state = () => ({
    platform: process.platform,
    demo: isDemo(),
    plugin: { name: pluginName(pluginDir), dir: pluginDir },
    models: MODELS,
    settings: loadSettings(),
    agents: listAgents(pluginDir).map(({ file, ...agent }) => agent),
    skills: listSkills(pluginDir),
    commands: listCommands(pluginDir).map(({ body, ...command }) => command),
    runs: runs.summaries(),
  });

  let allowedHosts = new Set();

  // Only this app's own page may call the API. A page on another site cannot
  // pass these checks: its Origin differs, a JSON POST needs a CORS preflight
  // that is never granted, and a rebound DNS name fails the Host check.
  function guard(req) {
    if (!allowedHosts.has(req.headers.host)) throw new HttpError(403, 'Forbidden host');
    const origin = req.headers.origin;
    if (origin && !allowedHosts.has(origin.replace(/^https?:\/\//, ''))) throw new HttpError(403, 'Forbidden origin');
    if (req.method === 'POST' && !String(req.headers['content-type'] || '').startsWith('application/json')) {
      throw new HttpError(415, 'JSON required');
    }
  }

  async function api(req, res, url) {
    const send = (body, status = 200) => {
      res.writeHead(status, { 'Content-Type': MIME['.json'], 'Cache-Control': 'no-store' });
      res.end(JSON.stringify(body));
    };
    const route = `${req.method} ${url.pathname}`;
    const runMatch = /^\/api\/runs\/([0-9a-f-]{36})(?:\/(\w+))?$/.exec(url.pathname);

    if (route === 'GET /api/state') return send(state());

    if (route === 'GET /api/events') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-store',
        Connection: 'keep-alive',
      });
      res.write(': connected\n\n');
      clients.add(res);
      req.on('close', () => clients.delete(res));
      return;
    }

    if (route === 'POST /api/settings') {
      const body = await readJson(req);
      return send({ settings: saveSettings(body) });
    }

    if (route === 'POST /api/agents/model') {
      const { name, model } = await readJson(req);
      const { file, ...agent } = setAgentModel(pluginDir, String(name), String(model));
      return send({ agent });
    }

    if (route === 'POST /api/check') return send(await checkConnection());

    if (route === 'POST /api/runs') {
      const body = await readJson(req);
      const run = runs.start(body);
      rememberProject(run.projectDir);
      return send({ run: run.summary() });
    }

    if (runMatch) {
      const run = runs.get(runMatch[1]);
      const action = runMatch[2];
      if (req.method === 'GET' && !action) return send(run.snapshot());
      if (req.method === 'GET' && action === 'files') return send({ files: run.handoffFiles() });
      if (req.method === 'GET' && action === 'file') {
        return send({ name: url.searchParams.get('name'), content: run.readHandoffFile(url.searchParams.get('name')) });
      }
      if (req.method === 'POST') {
        const body = await readJson(req);
        if (action === 'message') run.send(body.text);
        else if (action === 'stop') await run.stop();
        else if (action === 'end') run.end();
        else if (action === 'permission') run.answerPermission(String(body.requestId), body);
        else throw new HttpError(404, 'Not found');
        return send({ run: run.summary() });
      }
    }

    throw new HttpError(404, 'Not found');
  }

  function serveStatic(res, url) {
    const name = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname.slice(1));
    const file = path.resolve(PUBLIC_DIR, name);
    const inside = path.relative(PUBLIC_DIR, file);
    if (inside.startsWith('..') || path.isAbsolute(inside) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
      throw new HttpError(404, 'Not found');
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
      'Cache-Control': 'no-store',
      'Content-Security-Policy': "default-src 'self'; style-src 'self'; script-src 'self'; img-src 'self' data:",
      'X-Content-Type-Options': 'nosniff',
    });
    fs.createReadStream(file).pipe(res);
  }

  const server = http.createServer(async (req, res) => {
    try {
      guard(req);
      const url = new URL(req.url, 'http://localhost');
      if (url.pathname.startsWith('/api/')) await api(req, res, url);
      else if (req.method === 'GET') serveStatic(res, url);
      else throw new HttpError(405, 'Method not allowed');
    } catch (error) {
      const status = error instanceof HttpError ? error.status : 400;
      if (!res.headersSent) res.writeHead(status, { 'Content-Type': MIME['.json'] });
      res.end(JSON.stringify({ error: String(error?.message || error) }));
    }
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
  const actualPort = server.address().port;
  allowedHosts = new Set([`127.0.0.1:${actualPort}`, `localhost:${actualPort}`]);

  return {
    url: `http://127.0.0.1:${actualPort}`,
    port: actualPort,
    close: () =>
      new Promise((resolve) => {
        runs.shutdown();
        for (const res of clients) res.end();
        server.close(() => resolve());
        server.closeAllConnections?.();
      }),
  };
}
