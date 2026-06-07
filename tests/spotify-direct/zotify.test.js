import { describe, it, expect, vi } from 'vitest';
import fs from 'node:fs/promises';
import {
  downloadTrack,
  TrackNotFoundOnSpotify,
  AuthExpired,
} from '../../main/spotify-direct/zotify.js';

function fakeProc(stdout, stderr, exitCode) {
  const handlers = { stdout: [], stderr: [], close: [], error: [] };
  return {
    stdout: { on: (e, cb) => handlers.stdout.push(cb) },
    stderr: { on: (e, cb) => handlers.stderr.push(cb) },
    on: (e, cb) => {
      if (e === 'close') handlers.close.push(cb);
      else if (e === 'error') handlers.error.push(cb);
      setImmediate(() => {
        handlers.stdout.forEach((h) => h(Buffer.from(stdout)));
        handlers.stderr.forEach((h) => h(Buffer.from(stderr)));
        handlers.close.forEach((h) => h(exitCode));
      });
    },
    kill: () => {},
  };
}

describe('zotify downloadTrack', () => {
  it('resolves with codec and bitrate on exit 0', async () => {
    let call = 0;
    const mockSpawn = vi.fn().mockImplementation(() => {
      call++;
      if (call === 1) return fakeProc('{"ok":true}\n', '', 0);
      return fakeProc('Downloaded vorbis 320\n', '', 0);
    });
    const outputPath = '/tmp/zotify-test-ok.ogg';
    await fs.writeFile(outputPath, Buffer.from('ogg'));
    const result = await downloadTrack({
      accessToken: 'AT',
      refreshToken: 'RT',
      expiresIn: 3600,
      clientId: 'CID',
      trackUrl: 'https://open.spotify.com/track/X',
      outputPath,
      binaryPath: '/fake/zotify',
      _spawn: mockSpawn,
    });
    expect(result.ok).toBe(true);
    expect(result.sourceCodec).toBe('vorbis');
    expect(result.outputPath).toBe(outputPath);
    await fs.unlink(outputPath).catch(() => {});
  });

  it('throws TrackNotFoundOnSpotify when zotify reports a 404-style error', async () => {
    let call = 0;
    const mockSpawn = vi.fn().mockImplementation(() => {
      call++;
      if (call === 1) return fakeProc('{"ok":true}\n', '', 0);
      return fakeProc('', 'Track not found in catalog\n', 1);
    });
    await expect(downloadTrack({
      accessToken: 'AT',
      refreshToken: 'RT',
      expiresIn: 3600,
      clientId: 'CID',
      trackUrl: 'https://x',
      outputPath: '/tmp/zotify-test-404.ogg',
      binaryPath: '/fake/zotify',
      _spawn: mockSpawn,
    })).rejects.toBeInstanceOf(TrackNotFoundOnSpotify);
  });

  it('throws AuthExpired when zotify reports an auth error', async () => {
    let call = 0;
    const mockSpawn = vi.fn().mockImplementation(() => {
      call++;
      if (call === 1) return fakeProc('{"ok":true}\n', '', 0);
      return fakeProc('', 'Authentication failed: token expired\n', 1);
    });
    await expect(downloadTrack({
      accessToken: 'AT',
      refreshToken: 'RT',
      expiresIn: 3600,
      clientId: 'CID',
      trackUrl: 'https://x',
      outputPath: '/tmp/zotify-test-auth.ogg',
      binaryPath: '/fake/zotify',
      _spawn: mockSpawn,
    })).rejects.toBeInstanceOf(AuthExpired);
  });

  it('throws ZotifyBinaryMissing on spawn error', async () => {
    let call = 0;
    const mockSpawn = vi.fn().mockImplementation(() => {
      call++;
      if (call === 1) return fakeProc('{"ok":true}\n', '', 0);
      const ee = { stdout: { on: () => {} }, stderr: { on: () => {} }, kill: () => {} };
      ee.on = (e, cb) => { if (e === 'error') setImmediate(() => cb(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }))); };
      return ee;
    });
    await expect(downloadTrack({
      accessToken: 'AT',
      refreshToken: 'RT',
      expiresIn: 3600,
      clientId: 'CID',
      trackUrl: 'https://x',
      outputPath: '/tmp/zotify-test-missing.ogg',
      binaryPath: '/fake/zotify',
      _spawn: mockSpawn,
    })).rejects.toThrow(/binary/i);
  });
});
