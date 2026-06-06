const { spawn } = require('node:child_process');
const { resolveBinary } = require('../storage/paths.js');

function runBinary(name, args, signal) {
  return new Promise((resolve, reject) => {
    const child = spawn(resolveBinary(name), args, { signal });
    let stderr = '';
    let stdout = '';
    child.stdout.on('data', (b) => { stdout += b.toString(); });
    child.stderr.on('data', (b) => { stderr += b.toString(); });
    child.on('close', (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(`${name} exited ${code}: ${stderr.trim()}`));
    });
    child.on('error', reject);
  });
}

async function probeBitrateKbps(filePath) {
  const out = await runBinary('ffprobe', [
    '-v', 'error',
    '-select_streams', 'a:0',
    '-show_entries', 'stream=bit_rate',
    '-of', 'default=noprint_wrappers=1:nokey=1',
    filePath,
  ]);
  const bps = parseInt(out.trim(), 10);
  if (!Number.isFinite(bps) || bps <= 0) return 192;
  return Math.round(bps / 1000);
}

async function convertToMp3(input, output, opts = {}) {
  const bitrate = opts.bitrateKbps || 192;
  await runBinary('ffmpeg', [
    '-y',
    '-i', input,
    '-c:a', 'libmp3lame',
    '-b:a', `${bitrate}k`,
    '-ar', '44100',
    '-ac', '2',
    output,
  ], opts.signal);
}

module.exports = { probeBitrateKbps, convertToMp3 };
