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

function pickBitrateFromProbeJson(json) {
  const streamBitrate = parseInt(json?.streams?.[0]?.bit_rate, 10);
  if (Number.isFinite(streamBitrate) && streamBitrate > 0) return streamBitrate;

  const formatBitrate = parseInt(json?.format?.bit_rate, 10);
  if (Number.isFinite(formatBitrate) && formatBitrate > 0) return formatBitrate;

  const size = parseInt(json?.format?.size, 10);
  const duration = parseFloat(json?.format?.duration);
  if (Number.isFinite(size) && size > 0 && Number.isFinite(duration) && duration > 0) {
    return Math.round((size * 8) / duration);
  }

  return null;
}

async function probeBitrateKbps(filePath) {
  const out = await runBinary('ffprobe', [
    '-v', 'error',
    '-select_streams', 'a:0',
    '-show_entries', 'stream=bit_rate:format=bit_rate,duration,size',
    '-of', 'json',
    filePath,
  ]);

  let json;
  try { json = JSON.parse(out); } catch { json = null; }

  const bps = pickBitrateFromProbeJson(json);
  if (bps === null) return 192;
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

module.exports = { probeBitrateKbps, convertToMp3, pickBitrateFromProbeJson };
