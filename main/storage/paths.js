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

function resolveBinary(name, opts = {}) {
  const platform = opts.platform || process.platform;
  const arch = opts.arch || process.arch;
  const root = opts.root || path.resolve(__dirname, '..', '..');

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

module.exports = { sanitizeFilename, resolveBinary, revealInExplorer };
