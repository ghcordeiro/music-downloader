const path = require('path');
const { exec } = require('child_process');

const FORBIDDEN_FILENAME_CHARS = /[<>:"/\\|?*\x00-\x1F]/g;
const MAX_FILENAME_LENGTH = 200;

function sanitizeFilename(name) {
  if (typeof name !== 'string') return 'untitled';
  const cleaned = name
    .replace(FORBIDDEN_FILENAME_CHARS, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (cleaned.length === 0) return 'untitled';
  return cleaned.length > MAX_FILENAME_LENGTH
    ? cleaned.slice(0, MAX_FILENAME_LENGTH).trim()
    : cleaned;
}

function getBinaryRoot(opts = {}) {
  if (opts.root) return opts.root;
  try {
    const { app } = require('electron');
    if (app.isPackaged) return process.resourcesPath;
  } catch { /* tests / non-electron */ }
  return path.resolve(__dirname, '..', '..');
}

function resolveBinary(name, opts = {}) {
  const platform = opts.platform || process.platform;
  const arch = opts.arch || process.arch;
  const root = getBinaryRoot(opts);

  let dir;
  let binName = name;
  if (platform === 'darwin' && arch === 'arm64') dir = 'mac-arm64';
  else if (platform === 'darwin' && arch === 'x64') dir = 'mac-x64';
  else if (platform === 'win32' && arch === 'x64') {
    dir = 'win-x64';
    binName = `${name}.exe`;
  } else {
    throw new Error(`unsupported platform/arch: ${platform}/${arch}`);
  }
  return path.join(root, 'binaries', dir, binName);
}

function revealInExplorer(targetPath) {
  const platform = process.platform;
  if (platform === 'darwin') {
    exec(`open "${targetPath.replace(/"/g, '\\"')}"`);
  } else if (platform === 'win32') {
    exec(`explorer "${targetPath.replace(/"/g, '\\"')}"`);
  } else {
    throw new Error(`unsupported platform for revealInExplorer: ${platform}`);
  }
}

function truncateForOS(fullPath, opts = {}) {
  const platform = opts.platform || process.platform;
  if (platform !== 'win32') return fullPath;
  const MAX = 259;
  if (fullPath.length <= MAX) return fullPath;

  const ext = path.extname(fullPath);
  const dir = path.dirname(fullPath);
  const base = path.basename(fullPath, ext);
  const overflow = fullPath.length - MAX;
  const newBase = base.slice(0, Math.max(1, base.length - overflow));
  return path.join(dir, newBase + ext);
}

module.exports = { sanitizeFilename, resolveBinary, revealInExplorer, truncateForOS, getBinaryRoot };
