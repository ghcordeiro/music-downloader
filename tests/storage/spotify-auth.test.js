import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createSpotifyAuthStore } from '../../main/storage/spotify-auth.js';

function tmp() { return fs.mkdtempSync(path.join(os.tmpdir(), 'spauth-')); }

const fakeSafeStorage = {
  isEncryptionAvailable: () => true,
  encryptString: (s) => Buffer.from(s.split('').map((c) => c.charCodeAt(0) ^ 0x5A)),
  decryptString: (b) => Buffer.from(b).toString('binary').split('').map((c) => String.fromCharCode(c.charCodeAt(0) ^ 0x5A)).join(''),
};

describe('spotify-auth store', () => {
  let dir;
  beforeEach(() => { dir = tmp(); });

  it('returns null when no file exists', async () => {
    const store = createSpotifyAuthStore(dir, fakeSafeStorage);
    expect(await store.read()).toBeNull();
  });

  it('encrypts on write and decrypts on read', async () => {
    const store = createSpotifyAuthStore(dir, fakeSafeStorage);
    const payload = { refresh_token: 'AQ...', email: 'a@b', product: 'premium', savedAt: '2026-06-06T20:00:00Z' };
    await store.write(payload);
    const rawBytes = fs.readFileSync(path.join(dir, 'spotify-auth.enc'));
    expect(rawBytes.toString('utf8')).not.toContain('AQ');
    const reloaded = await createSpotifyAuthStore(dir, fakeSafeStorage).read();
    expect(reloaded).toEqual(payload);
  });

  it('clear() deletes the file (idempotent)', async () => {
    const store = createSpotifyAuthStore(dir, fakeSafeStorage);
    await store.write({ refresh_token: 'x', email: 'a', product: 'free', savedAt: 'z' });
    await store.clear();
    expect(await store.read()).toBeNull();
    await store.clear();
  });

  it('throws a typed error when encryption is unavailable', async () => {
    const broken = { ...fakeSafeStorage, isEncryptionAvailable: () => false };
    const store = createSpotifyAuthStore(dir, broken);
    await expect(store.write({ refresh_token: 'x', email: 'a', product: 'free', savedAt: 'z' }))
      .rejects.toThrow(/encryption/i);
  });
});
