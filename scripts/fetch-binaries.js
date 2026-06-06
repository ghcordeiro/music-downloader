#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const https = require('node:https');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const BIN = path.join(ROOT, 'binaries');

const YT_DLP_RELEASES = {
  'mac-arm64': 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_macos',
  'mac-x64':   'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_macos',
  'win-x64':   'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe',
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
        if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}`));
        res.pipe(file);
        file.on('finish', () => file.close(() => resolve()));
      }).on('error', reject);
    }
    get(url);
  });
}

async function fetchYtDlpFor(target) {
  const url = YT_DLP_RELEASES[target];
  if (!url) throw new Error(`no yt-dlp URL for ${target}`);
  const dir = path.join(BIN, target);
  ensureDir(dir);
  const dest = path.join(dir, target === 'win-x64' ? 'yt-dlp.exe' : 'yt-dlp');
  console.log(`downloading yt-dlp → ${dest}`);
  await download(url, dest);
  if (target !== 'win-x64') fs.chmodSync(dest, 0o755);
}

function copyHostFfmpeg(target) {
  const which = (name) => spawnSync('which', [name], { encoding: 'utf8' }).stdout.trim();
  const ffmpeg = which('ffmpeg');
  const ffprobe = which('ffprobe');
  if (!ffmpeg || !ffprobe) {
    console.warn('ffmpeg/ffprobe not found on PATH. Install with `brew install ffmpeg` (mac).');
    return;
  }
  const dir = path.join(BIN, target);
  ensureDir(dir);
  fs.copyFileSync(ffmpeg, path.join(dir, 'ffmpeg'));
  fs.copyFileSync(ffprobe, path.join(dir, 'ffprobe'));
  fs.chmodSync(path.join(dir, 'ffmpeg'), 0o755);
  fs.chmodSync(path.join(dir, 'ffprobe'), 0o755);
  console.log(`copied host ffmpeg/ffprobe into ${dir}`);
}

(async () => {
  const target =
    process.platform === 'darwin' && process.arch === 'arm64' ? 'mac-arm64' :
    process.platform === 'darwin' ? 'mac-x64' :
    process.platform === 'win32'   ? 'win-x64' : null;
  if (!target) throw new Error(`unsupported platform: ${process.platform}`);

  await fetchYtDlpFor(target);
  copyHostFfmpeg(target);
  console.log('done.');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
