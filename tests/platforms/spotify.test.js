import { describe, it, expect } from 'vitest';
import nock from 'nock';
import { parseSpotifyUrl, createSpotifyClient } from '../../main/platforms/spotify.js';

describe('parseSpotifyUrl', () => {
  it('parses playlist URLs', () => {
    expect(parseSpotifyUrl('https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M'))
      .toEqual({ type: 'playlist', id: '37i9dQZF1DXcBWIGoYBM5M' });
  });

  it('parses album URLs', () => {
    expect(parseSpotifyUrl('https://open.spotify.com/album/5MS3MvWHJ3lOZPLiMxzOU6'))
      .toEqual({ type: 'album', id: '5MS3MvWHJ3lOZPLiMxzOU6' });
  });

  it('parses track URLs', () => {
    expect(parseSpotifyUrl('https://open.spotify.com/track/11dFghVXANMlKmJXsNCbNl'))
      .toEqual({ type: 'track', id: '11dFghVXANMlKmJXsNCbNl' });
  });

  it('strips ?si=... share parameters', () => {
    expect(parseSpotifyUrl('https://open.spotify.com/playlist/abc?si=xyz'))
      .toEqual({ type: 'playlist', id: 'abc' });
  });

  it('throws InvalidUrlError on non-Spotify URLs', () => {
    expect(() => parseSpotifyUrl('https://youtube.com/x')).toThrow();
  });
});

describe('Spotify token flow', () => {
  it('requests a Client Credentials token and caches until expiry', async () => {
    const tokenScope = nock('https://accounts.spotify.com')
      .post('/api/token', (body) => {
        if (typeof body === 'string') return body.includes('grant_type=client_credentials');
        if (Buffer.isBuffer(body)) return body.toString().includes('grant_type=client_credentials');
        return body?.grant_type === 'client_credentials';
      })
      .reply(200, { access_token: 'tok-123', expires_in: 3600, token_type: 'Bearer' });

    const client = createSpotifyClient({ clientId: 'id', clientSecret: 'secret' });
    const tok1 = await client._getToken();
    const tok2 = await client._getToken();
    expect(tok1).toBe('tok-123');
    expect(tok2).toBe('tok-123');
    expect(tokenScope.isDone()).toBe(true);
  });

  it('throws SpotifyAuthError on 400/401 from token endpoint', async () => {
    nock('https://accounts.spotify.com')
      .post('/api/token')
      .reply(401, { error: 'invalid_client' });

    const client = createSpotifyClient({ clientId: 'bad', clientSecret: 'bad' });
    await expect(client._getToken()).rejects.toThrow(/Spotify/);
  });
});

describe('fetchPlaylist', () => {
  it('returns playlist name, cover, and tracks shape', async () => {
    nock('https://accounts.spotify.com')
      .post('/api/token')
      .reply(200, { access_token: 'tok', expires_in: 3600, token_type: 'Bearer' });

    nock('https://api.spotify.com')
      .get('/v1/playlists/abc')
      .reply(200, {
        name: 'My Playlist',
        images: [{ url: 'https://cover.example/img.jpg' }],
        tracks: {
          items: [
            {
              track: {
                name: 'Track One',
                artists: [{ name: 'Artist A' }],
                duration_ms: 180_000,
                external_ids: { isrc: 'ISRC123' },
                album: {
                  id: 'alb1',
                  release_date: '2024-01-01',
                  images: [{ url: 'https://cover.example/alb.jpg' }],
                },
              },
            },
          ],
          next: null,
        },
      });

    const client = createSpotifyClient({ clientId: 'id', clientSecret: 'secret' });
    const result = await client.fetchPlaylist({ type: 'playlist', id: 'abc' });
    expect(result.playlistName).toBe('My Playlist');
    expect(result.coverUrl).toBe('https://cover.example/img.jpg');
    expect(result.tracks).toHaveLength(1);
    expect(result.tracks[0]).toMatchObject({
      name: 'Track One',
      artist: 'Artist A',
      durationSec: 180,
      isrc: 'ISRC123',
      year: '2024',
      albumId: 'alb1',
    });
  });

  it('paginates `next` to fetch all tracks', async () => {
    nock('https://accounts.spotify.com')
      .post('/api/token')
      .reply(200, { access_token: 'tok', expires_in: 3600, token_type: 'Bearer' });

    nock('https://api.spotify.com')
      .get('/v1/playlists/multi')
      .reply(200, {
        name: 'P', images: [],
        tracks: {
          items: [{ track: makeTrack('T1') }],
          next: 'https://api.spotify.com/v1/playlists/multi/tracks?offset=100',
        },
      });

    nock('https://api.spotify.com')
      .get('/v1/playlists/multi/tracks')
      .query(true)
      .reply(200, {
        items: [{ track: makeTrack('T2') }],
        next: null,
      });

    const client = createSpotifyClient({ clientId: 'id', clientSecret: 'secret' });
    const result = await client.fetchPlaylist({ type: 'playlist', id: 'multi' });
    expect(result.tracks.map(t => t.name)).toEqual(['T1', 'T2']);
  });
});

describe('attachAlbumLabels', () => {
  it('batches /v1/albums?ids=... up to 20 IDs per call', async () => {
    nock('https://accounts.spotify.com')
      .post('/api/token')
      .reply(200, { access_token: 'tok', expires_in: 3600, token_type: 'Bearer' });

    const ids = Array.from({ length: 25 }, (_, i) => `alb${i}`);
    const tracks = ids.map((id, i) => ({
      name: `T${i}`, artist: 'A', durationSec: 60, coverUrl: '',
      isrc: '', year: '', albumId: id,
    }));

    nock('https://api.spotify.com')
      .get('/v1/albums')
      .query(q => q.ids && q.ids.split(',').length === 20)
      .reply(200, { albums: ids.slice(0, 20).map(id => ({ id, label: `Lbl-${id}` })) });

    nock('https://api.spotify.com')
      .get('/v1/albums')
      .query(q => q.ids && q.ids.split(',').length === 5)
      .reply(200, { albums: ids.slice(20).map(id => ({ id, label: `Lbl-${id}` })) });

    const client = createSpotifyClient({ clientId: 'id', clientSecret: 'secret' });
    const enriched = await client.attachAlbumLabels(tracks);
    expect(enriched[0].label).toBe('Lbl-alb0');
    expect(enriched[24].label).toBe('Lbl-alb24');
  });
});

function makeTrack(name) {
  return {
    name,
    artists: [{ name: 'X' }],
    duration_ms: 60_000,
    external_ids: {},
    album: { id: 'a', release_date: '2024-01-01', images: [] },
  };
}
