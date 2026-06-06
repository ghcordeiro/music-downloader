import { describe, it, expect, beforeEach } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { createConfig } from '../../main/storage/config.js';

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'mdcfg-'));
}

describe('config store', () => {
  let dir;
  beforeEach(() => { dir = tmpDir(); });

  it('returns defaults when no file exists', async () => {
    const cfg = createConfig(dir);
    const value = await cfg.get();
    expect(value.outputDir).toBe(path.join(os.homedir(), 'Music', 'Music Downloader'));
    expect(value.firstRunCompleted).toBe(false);
  });

  it('persists and reads back a value', async () => {
    const cfg = createConfig(dir);
    await cfg.set({ outputDir: '/tmp/out', firstRunCompleted: true });
    const reloaded = createConfig(dir);
    const value = await reloaded.get();
    expect(value).toEqual({ outputDir: '/tmp/out', firstRunCompleted: true });
  });

  it('survives a corrupt config file by returning defaults', async () => {
    fs.writeFileSync(path.join(dir, 'config.json'), 'not json');
    const cfg = createConfig(dir);
    const value = await cfg.get();
    expect(value.firstRunCompleted).toBe(false);
  });
});
