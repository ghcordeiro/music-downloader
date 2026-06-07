const { spawn } = require('node:child_process');
const fsp = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { getBinaryRoot } = require('../storage/paths.js');

function resolveZotifyBinary() {
  const platform = process.platform;
  const arch = process.arch;
  const root = getBinaryRoot();
  let dir;
  let name = 'zotify';
  if (platform === 'darwin' && arch === 'arm64') dir = 'mac-arm64';
  else if (platform === 'darwin') dir = 'mac-x64';
  else if (platform === 'win32') { dir = 'win-x64'; name = 'zotify.bat'; }
  else throw new Error(`unsupported platform for zotify: ${platform}`);
  return path.join(root, 'binaries', dir, name);
}

class TrackNotFoundOnSpotify extends Error {
  constructor() { super('track not found on Spotify'); this.code = 'TRACK_NOT_FOUND_SPOTIFY'; }
}
class AuthExpired extends Error {
  constructor() { super('Spotify auth expired'); this.code = 'AUTH_EXPIRED'; }
}
class RegionLocked extends Error {
  constructor() { super('track region-locked'); this.code = 'REGION_LOCKED'; }
}
class PremiumRequired extends Error {
  constructor() { super('track requires Premium'); this.code = 'PREMIUM_REQUIRED'; }
}
class ZotifyBinaryMissing extends Error {
  constructor() { super('zotify binary missing'); this.code = 'ZOTIFY_BINARY_MISSING'; }
}
class ZotifyUnrecognizedError extends Error {
  constructor(stderr) { super(`zotify failed: ${stderr}`); this.code = 'ZOTIFY_UNRECOGNIZED'; }
}

function bridgeScriptPath() {
  return path.join(__dirname, 'credentials-bridge.py');
}

function resolvePythonForBridge() {
  const target = process.platform === 'darwin' && process.arch === 'arm64' ? 'mac-arm64'
    : process.platform === 'darwin' ? 'mac-x64'
      : process.platform === 'win32' ? 'win-x64' : null;
  if (target) {
    const bundled = path.join(__dirname, '..', '..', 'binaries', target, 'zotify-venv', 'bin',
      process.platform === 'win32' ? 'python.exe' : 'python3');
    try {
      require('node:fs').accessSync(bundled);
      return bundled;
    } catch { /* fall through */ }
  }
  if (process.env.ZOTIFY_PYTHON) return process.env.ZOTIFY_PYTHON;
  const homeVenv = path.join(os.homedir(), '.zotify-venv', 'bin',
    process.platform === 'win32' ? 'python.exe' : 'python3');
  try {
    require('node:fs').accessSync(homeVenv);
    return homeVenv;
  } catch {
    return process.platform === 'win32' ? 'python' : 'python3';
  }
}

async function writeCredentialsFile({ accessToken, refreshToken, expiresIn, clientId, credPath, _spawn = spawn }) {
  const python = resolvePythonForBridge();
  const script = bridgeScriptPath();
  await new Promise((resolve, reject) => {
    const child = _spawn(python, [
      script,
      clientId,
      accessToken,
      refreshToken,
      String(expiresIn || 3600),
      credPath,
    ], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (b) => { stderr += b.toString(); });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`credentials bridge failed (${code}): ${stderr.trim()}`));
    });
  });
}

function classifyStderr(stderr) {
  const s = stderr.toLowerCase();
  if (/auth(entication)? (failed|expired)/.test(s) || /token expired/.test(s)) return new AuthExpired();
  if (/not found|404/.test(s)) return new TrackNotFoundOnSpotify();
  if (/region/.test(s)) return new RegionLocked();
  if (/premium/.test(s)) return new PremiumRequired();
  return new ZotifyUnrecognizedError(stderr.trim());
}

async function downloadTrack({
  accessToken,
  refreshToken,
  expiresIn,
  clientId,
  trackUrl,
  outputPath,
  signal,
  binaryPath,
  _spawn = spawn,
}) {
  const credPath = path.join(os.tmpdir(), `mdzcred-${Date.now()}.json`);
  await writeCredentialsFile({
    accessToken,
    refreshToken,
    expiresIn,
    clientId,
    credPath,
    _spawn,
  });

  const exe = binaryPath || resolveZotifyBinary();
  const outDir = path.dirname(outputPath);
  const outName = path.basename(outputPath, path.extname(outputPath));

  return new Promise((resolve, reject) => {
    const child = _spawn(exe, [
      '--credentials-location', credPath,
      '--root-path', outDir,
      '--output', `${outName}.{ext}`,
      '--download-format', 'vorbis',
      '--print-download-progress', 'False',
      '--print-errors', 'True',
      trackUrl,
    ], { signal });

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (b) => { stdout += b.toString(); });
    child.stderr.on('data', (b) => { stderr += b.toString(); });
    child.on('error', (err) => {
      if (err.code === 'ENOENT') reject(new ZotifyBinaryMissing());
      else reject(err);
    });
    child.on('close', async (code) => {
      await fsp.unlink(credPath).catch(() => {});
      if (code === 0) {
        const exists = await fsp.access(outputPath).then(() => true).catch(() => false);
        const finalPath = exists ? outputPath : await findOutputFile(outDir, outName);
        const codec = (stdout.match(/vorbis|opus|aac/i) || ['vorbis'])[0].toLowerCase();
        const bitrate = parseInt((stdout.match(/(\d{2,3})\s*kbps/i) || [])[1] || '320', 10);
        resolve({ ok: true, outputPath: finalPath, sourceCodec: codec, sourceBitrateKbps: bitrate });
      } else {
        reject(classifyStderr(stderr));
      }
    });
  });
}

async function findOutputFile(dir, prefix) {
  const entries = await fsp.readdir(dir);
  const match = entries.find((e) => e.startsWith(prefix));
  if (!match) throw new Error(`zotify output not found in ${dir}`);
  return path.join(dir, match);
}

module.exports = {
  downloadTrack,
  writeCredentialsFile,
  TrackNotFoundOnSpotify,
  AuthExpired,
  RegionLocked,
  PremiumRequired,
  ZotifyBinaryMissing,
  ZotifyUnrecognizedError,
};
