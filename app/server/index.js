// `npm run web`: serves the studio UI to a browser instead of the Electron window.
import { startServer } from './server.js';

if (process.argv.includes('--demo')) process.env.KMP_STUDIO_DEMO = '1';
const portArg = process.argv.find((a) => a.startsWith('--port='));
const port = Number(portArg?.split('=')[1]) || Number(process.env.PORT) || 4517;

try {
  const server = await startServer({ port, pluginDir: process.env.KMP_STUDIO_PLUGIN_DIR || undefined });
  console.log(`KMP Agent Studio is running at ${server.url}`);
  const stop = async () => {
    await server.close();
    process.exit(0);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
} catch (error) {
  console.error(`Could not start: ${error.message}`);
  process.exit(1);
}
