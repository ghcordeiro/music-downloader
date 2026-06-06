const { runYtDlp } = require('../download/ytdlp.js');
const { InvalidUrlError } = require('../errors.js');

function parseSoundCloudUrl(rawUrl) {
  const url = (rawUrl || '').trim();
  try {
    const u = new URL(url);
    if (!u.hostname.endsWith('soundcloud.com')) throw new Error('not soundcloud');
    if (u.pathname.includes('/sets/')) return { type: 'playlist', url };
    if (u.pathname.split('/').filter(Boolean).length >= 2) return { type: 'track', url };
  } catch { /* fall through */ }
  throw new InvalidUrlError(url);
}

async function fetchPlaylistOrTrack(parsed) {
  if (parsed.type === 'track') {
    const out = await runYtDlp(['--dump-json', '--no-warnings', parsed.url]);
    const meta = JSON.parse(out.trim());
    return {
      playlistName: meta.title || 'Single track',
      coverUrl: meta.thumbnail || '',
      tracks: [{
        name: meta.title || '',
        artist: meta.uploader || 'Unknown',
        durationSec: Math.floor(meta.duration || 0),
        coverUrl: meta.thumbnail || '',
        isrc: '',
        year: '',
        label: '',
        directUrl: meta.webpage_url || parsed.url,
      }],
    };
  }
  const out = await runYtDlp(['--dump-json', '--flat-playlist', '--no-warnings', parsed.url]);
  const lines = out.trim().split('\n').filter(Boolean);
  let playlistName = 'SoundCloud Set';
  const tracks = [];
  for (const line of lines) {
    const item = JSON.parse(line);
    if (item._type === 'playlist' && item.title) {
      playlistName = item.title;
      continue;
    }
    if (item.id || item.url) {
      tracks.push({
        name: item.title || '',
        artist: item.uploader || 'Unknown',
        durationSec: Math.floor(item.duration || 0),
        coverUrl: item.thumbnails?.[0]?.url || '',
        isrc: '',
        year: '',
        label: '',
        directUrl: item.url,
      });
    }
  }
  return { playlistName, coverUrl: '', tracks };
}

module.exports = { parseSoundCloudUrl, fetchPlaylistOrTrack };
