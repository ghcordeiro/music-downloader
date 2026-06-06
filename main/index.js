const { app, BrowserWindow } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
try {
  const envPath = path.join(__dirname, '..', '.env');
  if (fs.existsSync(envPath)) {
    for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.+)\s*$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"|"$/g, '');
    }
  }
} catch { /* env loading is best-effort */ }
const { createConfig } = require('./storage/config.js');
const { registerIpc } = require('./ipc.js');

let mainWindow = null;

function createWindow(config) {
  mainWindow = new BrowserWindow({
    width: 760,
    height: 580,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  return mainWindow;
}

app.whenReady().then(() => {
  const config = createConfig(app.getPath('userData'));
  const window = createWindow(config);
  registerIpc({ config, window });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow(config);
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
