import { describe, it, expect } from 'vitest';
import { parseSoundCloudUrl } from '../../main/platforms/soundcloud.js';

describe('parseSoundCloudUrl', () => {
  it('parses a track URL', () => {
    const u = 'https://soundcloud.com/artist/track-name';
    expect(parseSoundCloudUrl(u)).toEqual({ type: 'track', url: u });
  });

  it('parses a set (playlist) URL', () => {
    const u = 'https://soundcloud.com/artist/sets/album-name';
    expect(parseSoundCloudUrl(u)).toEqual({ type: 'playlist', url: u });
  });

  it('rejects non-SoundCloud URLs', () => {
    expect(() => parseSoundCloudUrl('https://example.com/x')).toThrow();
  });
});
