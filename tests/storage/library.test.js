import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createLibrary, hashPlaylist, hashTrack } from '../../main/storage/library.js';

function tmp() { return fs.mkdtempSync(path.join(os.tmpdir(), 'lib-')); }

describe('library', () => {
  let dir;
  beforeEach(() => { dir = tmp(); });

  it('returns false for unseen tracks', async () => {
    const lib = createLibrary(dir);
    expect(await lib.has('pl1', 't1')).toBe(false);
  });

  it('registers a track then reports has=true', async () => {
    const lib = createLibrary(dir);
    await lib.register('pl1', 't1');
    expect(await lib.has('pl1', 't1')).toBe(true);
  });

  it('persists across instances', async () => {
    const a = createLibrary(dir);
    await a.register('pl1', 't1');
    const b = createLibrary(dir);
    expect(await b.has('pl1', 't1')).toBe(true);
  });

  it('hashes are stable', () => {
    expect(hashTrack({ artist: 'Daft Punk', title: 'Around the World' }))
      .toBe(hashTrack({ artist: 'Daft Punk', title: 'Around the World' }));
    expect(hashPlaylist({ platform: 'spotify', sourceId: 'abc' }))
      .toBe(hashPlaylist({ platform: 'spotify', sourceId: 'abc' }));
  });
});
