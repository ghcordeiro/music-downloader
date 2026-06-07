const fs = require('node:fs/promises');
const path = require('node:path');

function createSpotifyAuthStore(dir, safeStorage) {
  const file = path.join(dir, 'spotify-auth.enc');

  return {
    async read() {
      try {
        const buf = await fs.readFile(file);
        if (!safeStorage.isEncryptionAvailable()) return null;
        const plain = safeStorage.decryptString(buf);
        return JSON.parse(plain);
      } catch (err) {
        if (err.code === 'ENOENT') return null;
        throw err;
      }
    },

    async write(payload) {
      if (!safeStorage.isEncryptionAvailable()) {
        const e = new Error('OS-level encryption is unavailable');
        e.code = 'ENCRYPTION_UNAVAILABLE';
        throw e;
      }
      await fs.mkdir(dir, { recursive: true });
      const blob = safeStorage.encryptString(JSON.stringify(payload));
      await fs.writeFile(file, blob);
    },

    async clear() {
      try { await fs.unlink(file); }
      catch (err) { if (err.code !== 'ENOENT') throw err; }
    },
  };
}

module.exports = { createSpotifyAuthStore };
