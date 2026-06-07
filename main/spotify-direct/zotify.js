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
class ZotifyTimeoutError extends Error {
  constructor() { super('zotify timed out'); this.code = 'ZOTIFY_TIMEOUT'; }
}
class CredentialsBridgeError extends Error {
  constructor(detail) {
    super(`credentials bridge failed: ${detail}`);
    this.code = 'CREDENTIALS_BRIDGE_FAILED';
  }
}

function spawnEnv() {
  const env = { ...process.env };
  for (const key of ['HTTP_PROXY', 'HTTPS_PROXY', 'http_proxy', 'https_proxy', 'ALL_PROXY', 'all_proxy']) {
    delete env[key];
  }
  env.NO_PROXY = '*';
  env.PROTOCOL_BUFFERS_PYTHON_IMPLEMENTATION = 'python';
  return env;
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
    ], { stdio: ['ignore', 'pipe', 'pipe'], env: spawnEnv() });
    let stderr = '';
    child.stderr.on('data', (b) => { stderr += b.toString(); });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new CredentialsBridgeError(stderr.trim() || `exit ${code}`));
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
  credPath: suppliedCredPath,
  _spawn = spawn,
}) {
  let credPath = suppliedCredPath;
  let ownsCred = false;
  if (!credPath) {
    credPath = path.join(os.tmpdir(), `mdzcred-${Date.now()}.json`);
    ownsCred = true;
    await writeCredentialsFile({
      accessToken,
      refreshToken,
      expiresIn,
      clientId,
      credPath,
      _spawn,
    });
  }

  const exe = binaryPath || resolveZotifyBinary();
  const outDir = path.dirname(outputPath);
  const outName = path.basename(outputPath, path.extname(outputPath));

  const ZOTIFY_TIMEOUT_MS = 180_000;

  return new Promise((resolve, reject) => {
    const child = _spawn(exe, [
      '--credentials-location', credPath,
      '--root-path', outDir,
      '--output', `${outName}.{ext}`,
      '--download-format', 'vorbis',
      '--download-quality', 'very_high',
      trackUrl,
    ], { signal, env: spawnEnv() });

    let stdout = '';
    let stderr = '';
    let settled = false;
    const finish = (fn) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn();
    };

    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      finish(() => reject(new ZotifyTimeoutError()));
    }, ZOTIFY_TIMEOUT_MS);

    child.stdout.on('data', (b) => { stdout += b.toString(); });
    child.stderr.on('data', (b) => { stderr += b.toString(); });
    child.on('error', (err) => {
      finish(() => {
        if (err.code === 'ENOENT') reject(new ZotifyBinaryMissing());
        else reject(err);
      });
    });
    child.on('close', async (code) => {
      if (ownsCred) await fsp.unlink(credPath).catch(() => {});
      finish(async () => {
        if (code === 0) {
          try {
            const exists = await fsp.access(outputPath).then(() => true).catch(() => false);
            const finalPath = exists ? outputPath : await findOutputFile(outDir, outName);
            const codec = (stdout.match(/vorbis|opus|aac/i) || ['vorbis'])[0].toLowerCase();
            const bitrate = parseInt((stdout.match(/(\d{2,3})\s*kbps/i) || [])[1] || '320', 10);
            resolve({ ok: true, outputPath: finalPath, sourceCodec: codec, sourceBitrateKbps: bitrate });
          } catch (err) {
            reject(Object.assign(err, { code: 'ZOTIFY_UNRECOGNIZED' }));
          }
        } else {
          reject(classifyStderr(stderr));
        }
      });
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
  ZotifyTimeoutError,
  CredentialsBridgeError,
};
