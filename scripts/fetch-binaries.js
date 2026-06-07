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
  'win-x64':   'https://github.com/BtbN/FFmpeg-Builds/releases/latest/download/ffmpeg-master-latest-win64-gpl.zip',
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

  if (!fs.existsSync(pythonBin)) {
    console.log(`creating zotify venv for ${target}`);
    const py = process.platform === 'win32' ? 'python' : 'python3';
    const r = spawnSync(py, ['-m', 'venv', venvDir], { stdio: 'inherit' });
    if (r.status !== 0) throw new Error('failed to create zotify venv');
    const pip = spawnSync(pythonBin, ['-m', 'pip', 'install', '--upgrade', 'pip'], { stdio: 'inherit' });
    if (pip.status !== 0) throw new Error('failed to upgrade pip in zotify venv');
    const install = spawnSync(
      pythonBin,
      ['-m', 'pip', 'install', 'git+https://github.com/zotify-dev/zotify.git'],
      { stdio: 'inherit' },
    );
    if (install.status !== 0) throw new Error('failed to pip install zotify');
  }

  if (target === 'win-x64') {
    fs.writeFileSync(launcher, `@echo off\r\n"${pythonBin}" -m zotify %*\r\n`, 'utf8');
  } else {
    fs.writeFileSync(launcher, `#!/bin/sh\nexec "${pythonBin}" -m zotify "$@"\n`, 'utf8');
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
