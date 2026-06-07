#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const https = require('node:https');
const { spawnSync } = require('node:child_process');
const os = require('node:os');

const ROOT = path.resolve(__dirname, '..');
const BIN = path.join(ROOT, 'binaries');

const YT_DLP = {
  'mac-arm64': 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_macos',
  'mac-x64':   'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_macos',
  'win-x64':   'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe',
};

// Static mac builds from osxexperts (ffmpeg only); ffprobe fetched separately.
const FFMPEG = {
  'mac-arm64': 'https://www.osxexperts.net/ffmpeg711arm.zip',
  'mac-x64':   'https://evermeet.cx/ffmpeg/getrelease/ffmpeg/zip',
  // Use the literal `latest` tag (which BtbN actively rotates and keeps
  // assets-complete) instead of GitHub's `releases/latest` redirect, which
  // can briefly resolve to an autobuild that hasn't uploaded all assets yet.
  'win-x64':   'https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip',
};

const FFPROBE = {
  'mac-arm64': 'https://www.osxexperts.net/ffprobe711arm.zip',
  'mac-x64':   'https://evermeet.cx/ffmpeg/getrelease/ffprobe/zip',
};

function ensureDir(d) { fs.mkdirSync(d, { recursive: true }); }

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function download(url, dest, attempts = 4) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      await downloadOnce(url, dest);
      return;
    } catch (err) {
      lastError = err;
      fs.rmSync(dest, { force: true });
      if (attempt === attempts) break;
      const delay = attempt * 2000;
      console.warn(`download failed (${err.message}); retrying in ${delay}ms`);
      await wait(delay);
    }
  }
  throw lastError;
}

function downloadOnce(url, dest) {
  return new Promise((resolve, reject) => {
    function get(u) {
      https.get(u, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          return get(res.headers.location);
        }
        if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode} for ${u}`));
        const file = fs.createWriteStream(dest);
        res.pipe(file);
        file.on('finish', () => file.close(() => resolve()));
        file.on('error', reject);
      }).on('error', reject);
    }
    get(url);
  });
}

async function fetchYtDlp(target) {
  const dir = path.join(BIN, target);
  ensureDir(dir);
  const dest = path.join(dir, target === 'win-x64' ? 'yt-dlp.exe' : 'yt-dlp');
  console.log(`downloading yt-dlp for ${target}`);
  await download(YT_DLP[target], dest);
  if (target !== 'win-x64') fs.chmodSync(dest, 0o755);
}

async function extractBinaryFromZip(zipPath, extractDir, binName, destPath, chmod) {
  ensureDir(extractDir);
  const r = spawnSync('unzip', ['-o', zipPath, '-d', extractDir], { stdio: 'inherit' });
  if (r.status !== 0) throw new Error('unzip failed; install unzip and retry');

  let found = false;
  function walk(d) {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name === binName && !found) {
        fs.copyFileSync(full, destPath);
        if (chmod) fs.chmodSync(destPath, 0o755);
        found = true;
      }
    }
  }
  walk(extractDir);
  return found;
}

async function fetchFfmpeg(target) {
  const dir = path.join(BIN, target);
  ensureDir(dir);
  const exeSuffix = target === 'win-x64' ? '.exe' : '';

  const tmp = path.join(os.tmpdir(), `ffmpeg-${target}-${Date.now()}.zip`);
  console.log(`downloading ffmpeg bundle for ${target}`);
  await download(FFMPEG[target], tmp);

  const extractDir = path.join(os.tmpdir(), `ffx-${target}-${Date.now()}`);
  const ffmpegDest = path.join(dir, `ffmpeg${exeSuffix}`);
  const ffprobeDest = path.join(dir, `ffprobe${exeSuffix}`);

  const copiedFfmpeg = await extractBinaryFromZip(
    tmp, extractDir, `ffmpeg${exeSuffix}`, ffmpegDest, target !== 'win-x64',
  );
  let copiedFfprobe = await extractBinaryFromZip(
    tmp, extractDir, `ffprobe${exeSuffix}`, ffprobeDest, target !== 'win-x64',
  );
  fs.unlinkSync(tmp);

  if (!copiedFfmpeg) throw new Error(`ffmpeg missing in archive for ${target}`);

  if (!copiedFfprobe && FFPROBE[target]) {
    const probeTmp = path.join(os.tmpdir(), `ffprobe-${target}-${Date.now()}.zip`);
    console.log(`downloading ffprobe for ${target}`);
    await download(FFPROBE[target], probeTmp);
    const probeExtract = path.join(os.tmpdir(), `ffp-${target}-${Date.now()}`);
    copiedFfprobe = await extractBinaryFromZip(
      probeTmp, probeExtract, `ffprobe${exeSuffix}`, ffprobeDest, target !== 'win-x64',
    );
    fs.unlinkSync(probeTmp);
  }

  if (!copiedFfprobe) {
    throw new Error(`ffmpeg or ffprobe missing in archive for ${target}`);
  }
}

function hostMatchesTarget(target) {
  if (target === 'mac-arm64') return process.platform === 'darwin' && process.arch === 'arm64';
  if (target === 'mac-x64') return process.platform === 'darwin' && process.arch === 'x64';
  if (target === 'win-x64') return process.platform === 'win32';
  return false;
}

function pythonMinor(py) {
  const r = spawnSync(py, ['-c', 'import sys; print(sys.version_info.minor)'], { encoding: 'utf8' });
  if (r.status !== 0) return null;
  const n = parseInt(r.stdout.trim(), 10);
  return Number.isFinite(n) ? n : null;
}

function resolveSystemPython() {
  if (process.platform === 'win32') return 'python';

  const candidates = [
    '/opt/homebrew/opt/python@3.12/bin/python3.12',
    '/opt/homebrew/bin/python3.12',
    '/usr/local/bin/python3.12',
    'python3.12',
    'python3.11',
    'python3.10',
  ];
  for (const py of candidates) {
    const exists = py.startsWith('/')
      ? fs.existsSync(py)
      : spawnSync('which', [py], { encoding: 'utf8' }).status === 0;
    if (!exists) continue;
    const minor = pythonMinor(py);
    if (minor !== null && minor >= 10 && minor <= 12) return py;
  }

  console.log('Python 3.10–3.12 not found; installing python@3.12 via Homebrew...');
  const brew = spawnSync('brew', ['install', 'python@3.12'], { stdio: 'inherit' });
  if (brew.status !== 0) throw new Error('failed to install python@3.12 (brew install python@3.12)');
  const brewed = '/opt/homebrew/opt/python@3.12/bin/python3.12';
  if (!fs.existsSync(brewed)) throw new Error(`python@3.12 missing at ${brewed}`);
  return brewed;
}

// librespot-python's ConnectionHolder.read() uses socket.recv(length), which
// can return fewer bytes than requested. During Session.connect() this truncates
// the APResponseMessage frame and raises "DecodeError: Wrong wire type in tag",
// causing intermittent Spotify download failures (fallback to YouTube ~128kbps).
// Patch read() to loop until the full length is read. Idempotent.
function patchLibrespotShortRead(venvDir, target) {
  const libDir = path.join(venvDir, 'lib');
  let coreFile = null;
  try {
    for (const entry of fs.readdirSync(libDir)) {
      const candidate = path.join(libDir, entry, 'site-packages', 'librespot', 'core.py');
      if (fs.existsSync(candidate)) { coreFile = candidate; break; }
    }
  } catch { /* fall through */ }
  if (target === 'win-x64' && !coreFile) {
    const candidate = path.join(venvDir, 'Lib', 'site-packages', 'librespot', 'core.py');
    if (fs.existsSync(candidate)) coreFile = candidate;
  }
  if (!coreFile) {
    console.warn('patchLibrespotShortRead: core.py not found; skipping (downloads may be flaky)');
    return;
  }

  const src = fs.readFileSync(coreFile, 'utf8');
  if (src.includes('PATCH: socket.recv may return fewer bytes')) {
    console.log('librespot short-read patch already applied');
    return;
  }

  const needle = '        def read(self, length: int) -> bytes:\n'
    + '            """Read data from socket\n\n'
    + '            :param length: int:\n'
    + '            :returns: Bytes data from socket\n\n'
    + '            """\n'
    + '            return self.__socket.recv(length)\n';

  const replacement = '        def read(self, length: int) -> bytes:\n'
    + '            """Read data from socket\n\n'
    + '            :param length: int:\n'
    + '            :returns: Bytes data from socket\n\n'
    + '            """\n'
    + '            # PATCH: socket.recv may return fewer bytes than requested; loop\n'
    + '            # until the full length is read to avoid truncated protobuf frames\n'
    + '            # (DecodeError: Wrong wire type in tag) during connect().\n'
    + '            if length <= 0:\n'
    + '                return b""\n'
    + '            buffer = bytearray()\n'
    + '            remaining = length\n'
    + '            while remaining > 0:\n'
    + '                chunk = self.__socket.recv(remaining)\n'
    + '                if chunk == b"":\n'
    + '                    raise ConnectionError("EOF")\n'
    + '                buffer.extend(chunk)\n'
    + '                remaining -= len(chunk)\n'
    + '            return bytes(buffer)\n';

  if (!src.includes(needle)) {
    console.warn('patchLibrespotShortRead: read() signature not found; skipping (librespot may have changed)');
    return;
  }

  fs.writeFileSync(coreFile, src.replace(needle, replacement), 'utf8');
  console.log('applied librespot short-read patch to', path.relative(BIN, coreFile));
}

async function fetchZotify(target) {
  if (!hostMatchesTarget(target)) {
    console.warn(`skipping zotify for ${target} (must build on matching host OS/arch)`);
    return;
  }

  const dir = path.join(BIN, target);
  ensureDir(dir);
  const venvDir = path.join(dir, 'zotify-venv');
  const pythonBin = path.join(venvDir, target === 'win-x64' ? 'Scripts/python.exe' : 'bin/python3');
  const launcher = path.join(dir, target === 'win-x64' ? 'zotify.bat' : 'zotify');
  const marker = path.join(venvDir, '.python-source');
  const systemPy = resolveSystemPython();
  const venvMinor = fs.existsSync(pythonBin) ? pythonMinor(pythonBin) : null;
  const markerPy = fs.existsSync(marker) ? fs.readFileSync(marker, 'utf8').trim() : '';
  const needsRecreate = !fs.existsSync(pythonBin)
    || markerPy !== systemPy
    || venvMinor === null
    || venvMinor > 12;

  if (needsRecreate && fs.existsSync(venvDir)) {
    console.log(`recreating zotify venv for ${target} (need Python 3.10–3.12, not 3.14)`);
    fs.rmSync(venvDir, { recursive: true, force: true });
  }

  if (!fs.existsSync(pythonBin)) {
    console.log(`creating zotify venv for ${target} with ${systemPy}`);
    const r = spawnSync(systemPy, ['-m', 'venv', venvDir], { stdio: 'inherit' });
    if (r.status !== 0) throw new Error('failed to create zotify venv');
    fs.writeFileSync(marker, systemPy);
    const pip = spawnSync(pythonBin, ['-m', 'pip', 'install', '--upgrade', 'pip'], { stdio: 'inherit' });
    if (pip.status !== 0) throw new Error('failed to upgrade pip in zotify venv');
  }

  // Maintained fork: Googolplexed0/zotify + librespot-python (Login5 / metadata fixes).
  console.log(`installing Googolplexed0 zotify for ${target}`);
  const install = spawnSync(
    pythonBin,
    ['-m', 'pip', 'install', '--upgrade', '--force-reinstall', 'git+https://github.com/Googolplexed0/zotify.git'],
    { stdio: 'inherit' },
  );
  if (install.status !== 0) throw new Error('failed to pip install Googolplexed0 zotify');

  patchLibrespotShortRead(venvDir, target);

  if (target === 'win-x64') {
    fs.writeFileSync(
      launcher,
      `@echo off\r\nset PROTOCOL_BUFFERS_PYTHON_IMPLEMENTATION=python\r\n"${pythonBin}" -m zotify %*\r\n`,
      'utf8',
    );
  } else {
    fs.writeFileSync(
      launcher,
      `#!/bin/sh\nexport PROTOCOL_BUFFERS_PYTHON_IMPLEMENTATION=python\nexec "${pythonBin}" -m zotify "$@"\n`,
      'utf8',
    );
    fs.chmodSync(launcher, 0o755);
  }
  console.log(`zotify launcher ready for ${target}`);
}

(async () => {
  const argv = process.argv.slice(2);
  const platformArg = argv.find(a => a.startsWith('--platform='))?.split('=')[1];
  const all = argv.includes('--all');

  let targets;
  if (all) {
    targets = ['mac-arm64', 'mac-x64', 'win-x64'];
  } else if (platformArg === 'mac') {
    targets = ['mac-arm64', 'mac-x64'];
  } else if (platformArg === 'win') {
    targets = ['win-x64'];
  } else if (platformArg) {
    console.error(`unknown --platform value: ${platformArg} (expected "mac" or "win")`);
    process.exit(1);
  } else {
    targets = [
      process.platform === 'darwin' && process.arch === 'arm64' ? 'mac-arm64' :
      process.platform === 'darwin' ? 'mac-x64' :
      process.platform === 'win32'  ? 'win-x64' : null,
    ].filter(Boolean);
    if (targets.length === 0) {
      console.error(`unsupported host platform: ${process.platform} (use --platform=mac, --platform=win, or --all)`);
      process.exit(1);
    }
  }

  console.log(`Targets: ${targets.join(', ')}`);

  for (const t of targets) {
    await fetchYtDlp(t);
    await fetchFfmpeg(t);
    await fetchZotify(t);
  }
  console.log('done.');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
