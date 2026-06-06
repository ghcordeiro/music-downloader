import { describe, it, expect } from 'vitest';
import { parseYouTubeUrl } from '../../main/platforms/youtube.js';

describe('parseYouTubeUrl', () => {
  it('parses a watch URL', () => {
    expect(parseYouTubeUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ'))
      .toEqual({ type: 'video', id: 'dQw4w9WgXcQ', url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' });
  });

  it('parses youtu.be short URLs', () => {
    expect(parseYouTubeUrl('https://youtu.be/dQw4w9WgXcQ'))
      .toMatchObject({ type: 'video', id: 'dQw4w9WgXcQ' });
  });

  it('parses playlist URLs', () => {
    const u = 'https://www.youtube.com/playlist?list=PLxxxx';
    expect(parseYouTubeUrl(u)).toEqual({ type: 'playlist', id: 'PLxxxx', url: u });
  });

  it('rejects channel URLs in MVP', () => {
    expect(() => parseYouTubeUrl('https://www.youtube.com/@channel'))
      .toThrow();
  });

  it('rejects non-YouTube URLs', () => {
    expect(() => parseYouTubeUrl('https://example.com/x')).toThrow();
  });
});
