import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import NodeID3 from 'node-id3';
import { writeTags } from '../main/tagging.js';

function copyFixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mdtag-'));
  const dest = path.join(dir, 'song.mp3');
  fs.copyFileSync('tests/fixtures/silent.mp3', dest);
  return dest;
}

describe('writeTags', () => {
  it('writes title, artist, album, trackNumber, comment', async () => {
    const file = copyFixture();
    await writeTags(file, {
      title: 'Around the World',
      artist: 'Daft Punk',
      album: 'My Playlist',
      trackNumber: '3/10',
      comment: 'Source: YouTube',
    });
    const tags = NodeID3.read(file);
    expect(tags.title).toBe('Around the World');
    expect(tags.artist).toBe('Daft Punk');
    expect(tags.album).toBe('My Playlist');
    expect(tags.trackNumber).toBe('3/10');
    expect(tags.comment.text).toContain('YouTube');
  });
});
