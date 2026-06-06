const { runYtDlp } = require('../download/ytdlp.js');
const { InvalidUrlError } = require('../errors.js');

function parseYouTubeUrl(rawUrl) {
  const url = (rawUrl || '').trim();
  try {
    const u = new URL(url);
    if (u.hostname === 'youtu.be') {
      const id = u.pathname.replace(/^\//, '');
      if (id) return { type: 'video', id, url };
    }
    if (u.hostname.endsWith('youtube.com') || u.hostname.endsWith('youtube-nocookie.com')) {
      if (u.pathname === '/watch' && u.searchParams.get('v')) {
        return { type: 'video', id: u.searchParams.get('v'), url };
      }
      if (u.pathname === '/playlist' && u.searchParams.get('list')) {
        return { type: 'playlist', id: u.searchParams.get('list'), url };
      }
    }
  } catch { /* fall through */ }
  throw new InvalidUrlError(url);
}

async function fetchPlaylistOrVideo(parsed) {
  if (parsed.type === 'video') {
    const out = await runYtDlp(['--dump-json', '--no-warnings', '--no-playlist', parsed.url]);
    const meta = JSON.parse(out.trim());
    return {
      playlistName: meta.title || 'Single track',
      coverUrl: meta.thumbnail || '',
      tracks: [{
        name: meta.title || '',
        artist: meta.uploader || meta.channel || 'Unknown',
        durationSec: Math.floor(meta.duration || 0),
        coverUrl: meta.thumbnail || '',
        isrc: '',
        year: '',
        label: '',
        directUrl: meta.webpage_url || parsed.url,
      }],
    };
  }
  const out = await runYtDlp([
    '--dump-json', '--flat-playlist', '--no-warnings', parsed.url,
  ]);
  const lines = out.trim().split('\n').filter(Boolean);
  if (lines.length === 0) {
    return { playlistName: 'Playlist', coverUrl: '', tracks: [] };
  }
  let playlistName = 'Playlist';
  const tracks = [];
  for (const line of lines) {
    const item = JSON.parse(line);
    if (item._type === 'playlist' && item.title) {
      playlistName = item.title;
      continue;
    }
    if (item.id) {
      tracks.push({
        name: item.title || '',
        artist: item.uploader || item.channel || 'Unknown',
        durationSec: Math.floor(item.duration || 0),
        coverUrl: item.thumbnails?.[0]?.url || '',
        isrc: '',
        year: '',
        label: '',
        directUrl: item.url || `https://www.youtube.com/watch?v=${item.id}`,
      });
    }
  }
  return { playlistName, coverUrl: '', tracks };
}

module.exports = { parseYouTubeUrl, fetchPlaylistOrVideo };
