// Electron shell: starts the local studio server and opens a window on it.
import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer } from '../server/server.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
if (process.argv.includes('--demo')) process.env.KMP_STUDIO_DEMO = '1';
let server = null;
let window = null;

async function createWindow() {
  window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 640,
    title: 'KMP Agent Studio',
    backgroundColor: '#0f1115',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(HERE, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  // The window only ever shows the local UI; anything else opens in the browser.
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  window.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(server.url)) event.preventDefault();
  });

  await window.loadURL(server.url);
  window.on('closed', () => {
    window = null;
  });
}

ipcMain.handle('pick-folder', async () => {
  const result = await dialog.showOpenDialog(window, {
    title: 'Choose the project folder',
    properties: ['openDirectory', 'createDirectory'],
  });
  return result.canceled ? null : result.filePaths[0];
});

ipcMain.handle('open-folder', async (_event, dir) => {
  if (typeof dir === 'string' && path.isAbsolute(dir)) await shell.openPath(dir);
});

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (window) {
      if (window.isMinimized()) window.restore();
      window.focus();
    }
  });

  app.whenReady().then(async () => {
    try {
      server = await startServer({ port: 0, pluginDir: process.env.KMP_STUDIO_PLUGIN_DIR || undefined });
      await createWindow();
    } catch (error) {
      dialog.showErrorBox('KMP Agent Studio could not start', String(error?.message || error));
      app.quit();
    }
  });

  app.on('activate', () => {
    if (!window && server) createWindow();
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });

  app.on('before-quit', () => {
    server?.close();
  });
}
