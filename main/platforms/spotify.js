const axios = require('axios');
const {
  InvalidUrlError, SpotifyAuthError, PlaylistNotFoundError, NetworkError,
} = require('../errors.js');

const URL_PATTERN = /^https?:\/\/open\.spotify\.com\/(playlist|album|track)\/([A-Za-z0-9]+)/;

function parseSpotifyUrl(rawUrl) {
  const url = (rawUrl || '').trim();
  const match = url.match(URL_PATTERN);
  if (!match) throw new InvalidUrlError(url);
  return { type: match[1], id: match[2] };
}

function createSpotifyClient({ clientId, clientSecret }) {
  let cachedToken = null;
  let cachedTokenExpiresAt = 0;

  async function _getToken() {
    const now = Date.now();
    if (cachedToken && now < cachedTokenExpiresAt - 30_000) return cachedToken;

    const basic = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
    try {
      const resp = await axios.post(
        'https://accounts.spotify.com/api/token',
        'grant_type=client_credentials',
        {
          headers: {
            'Authorization': `Basic ${basic}`,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          timeout: 10_000,
        }
      );
      cachedToken = resp.data.access_token;
      cachedTokenExpiresAt = now + resp.data.expires_in * 1000;
      return cachedToken;
    } catch (err) {
      if (err.response) throw new SpotifyAuthError(`HTTP ${err.response.status}`);
      throw new NetworkError(err.message);
    }
  }

  async function _authedGet(url) {
    const token = await _getToken();
    try {
      const resp = await axios.get(url, {
        headers: { Authorization: `Bearer ${token}` },
        timeout: 15_000,
      });
      return resp.data;
    } catch (err) {
      if (err.response?.status === 404) throw new PlaylistNotFoundError(url);
      if (err.response?.status === 401) throw new SpotifyAuthError('token rejected');
      if (err.response) throw new NetworkError(`spotify HTTP ${err.response.status}`);
      throw new NetworkError(err.message);
    }
  }

  function _mapItem(item) {
    const t = item.track || item;
    if (!t) return null;
    return {
      name: t.name,
      artist: (t.artists || []).map(a => a.name).join(', '),
      durationSec: Math.floor((t.duration_ms || 0) / 1000),
      coverUrl: t.album?.images?.[0]?.url || '',
      isrc: t.external_ids?.isrc || '',
      year: (t.album?.release_date || '').slice(0, 4),
      albumId: t.album?.id || '',
    };
  }

  async function fetchPlaylist({ type, id }) {
    if (type !== 'playlist') {
      throw new InvalidUrlError(`only playlists supported in plan A: ${type}`);
    }
    const first = await _authedGet(`https://api.spotify.com/v1/playlists/${id}`);
    const tracks = (first.tracks.items || []).map(_mapItem).filter(Boolean);

    let nextUrl = first.tracks.next;
    while (nextUrl) {
      const page = await _authedGet(nextUrl);
      tracks.push(...(page.items || []).map(_mapItem).filter(Boolean));
      nextUrl = page.next;
    }

    return {
      playlistName: first.name,
      coverUrl: first.images?.[0]?.url || '',
      tracks,
    };
  }

  async function attachAlbumLabels(tracks) {
    const uniqueIds = [...new Set(tracks.map(t => t.albumId).filter(Boolean))];
    const idToLabel = new Map();

    for (let i = 0; i < uniqueIds.length; i += 20) {
      const slice = uniqueIds.slice(i, i + 20);
      const data = await _authedGet(
        `https://api.spotify.com/v1/albums?ids=${slice.join(',')}`
      );
      for (const album of data.albums || []) {
        if (album?.id) idToLabel.set(album.id, album.label || '');
      }
    }

    return tracks.map(t => ({ ...t, label: idToLabel.get(t.albumId) || '' }));
  }

  return { _getToken, fetchPlaylist, attachAlbumLabels };
}

module.exports = { parseSpotifyUrl, createSpotifyClient };
