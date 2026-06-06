import { describe, it, expect, vi } from 'vitest';
import { runYtDlp } from '../../main/download/ytdlp.js';

describe('runYtDlp', () => {
  it('spawns the binary with the supplied args and resolves with stdout', async () => {
    const fakeStdout = JSON.stringify({ id: 'abc', title: 'Track' }) + '\n';
    const mockSpawn = vi.fn().mockImplementation(() => fakeProc(fakeStdout, '', 0));
    const out = await runYtDlp(['--dump-json', 'https://example.com/v'], {
      binaryPath: '/fake/yt-dlp',
      _spawn: mockSpawn,
    });
    expect(out.trim()).toContain('Track');
    expect(mockSpawn).toHaveBeenCalledWith('/fake/yt-dlp', ['--dump-json', 'https://example.com/v'], expect.any(Object));
  });

  it('rejects when the process exits non-zero', async () => {
    const mockSpawn = vi.fn().mockImplementation(() => fakeProc('', 'ERROR: not found\n', 1));
    await expect(
      runYtDlp(['x'], { binaryPath: '/fake/yt-dlp', _spawn: mockSpawn })
    ).rejects.toThrow(/ERROR: not found/);
  });
});

function fakeProc(stdout, stderr, exitCode) {
  const handlers = { stdout: [], stderr: [], close: [] };
  return {
    stdout: { on: (e, cb) => handlers.stdout.push(cb) },
    stderr: { on: (e, cb) => handlers.stderr.push(cb) },
    on: (e, cb) => {
      if (e === 'close') handlers.close.push(cb);
      setImmediate(() => {
        handlers.stdout.forEach(h => h(Buffer.from(stdout)));
        handlers.stderr.forEach(h => h(Buffer.from(stderr)));
        handlers.close.forEach(h => h(exitCode));
      });
    },
    kill: () => {},
  };
}
