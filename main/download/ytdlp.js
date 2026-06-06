const { spawn } = require('node:child_process');
const { resolveBinary } = require('../storage/paths.js');

function runYtDlp(args, opts = {}) {
  const binaryPath = opts.binaryPath || resolveBinary('yt-dlp');
  const signal = opts.signal;
  const spawnFn = opts._spawn || spawn;

  return new Promise((resolve, reject) => {
    const child = spawnFn(binaryPath, args, { signal });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (b) => { stdout += b.toString(); });
    child.stderr.on('data', (b) => { stderr += b.toString(); });
    child.on('close', (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(`yt-dlp exited ${code}: ${stderr.trim()}`));
    });
    child.on('error', (err) => reject(err));
  });
}

async function searchYouTubeForTrack({ artist, title }, opts = {}) {
  const query = `ytsearch1:${artist} - ${title}`;
  const out = await runYtDlp(['--dump-json', '--no-warnings', query], opts);
  const firstLine = out.trim().split('\n')[0];
  if (!firstLine) return null;
  const json = JSON.parse(firstLine);
  return { url: json.webpage_url || json.original_url || json.url, title: json.title };
}

async function downloadAudio(url, outputTemplate, opts = {}) {
  const args = [
    '-f', 'bestaudio',
    '-o', outputTemplate,
    '--no-warnings',
    '--no-playlist',
    url,
  ];
  await runYtDlp(args, opts);
}

module.exports = { runYtDlp, searchYouTubeForTrack, downloadAudio };
