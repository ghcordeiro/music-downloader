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

function download(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    function get(u) {
      https.get(u, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          return get(res.headers.location);
        }
        if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode} for ${u}`));
        res.pipe(file);
        file.on('finish', () => file.close(() => resolve()));
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

(async () => {
  const all = process.argv.includes('--all');
  let targets;
  if (all) {
    targets = ['mac-arm64', 'mac-x64', 'win-x64'];
  } else {
    targets = [
      process.platform === 'darwin' && process.arch === 'arm64' ? 'mac-arm64' :
      process.platform === 'darwin' ? 'mac-x64' :
      process.platform === 'win32'  ? 'win-x64' : null,
    ].filter(Boolean);
    if (targets.length === 0) {
      console.error(`unsupported host platform: ${process.platform}`);
      process.exit(1);
    }
  }

  for (const t of targets) {
    await fetchYtDlp(t);
    await fetchFfmpeg(t);
  }
  console.log('done.');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
