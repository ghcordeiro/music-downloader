const fs = require('node:fs/promises');
const fssync = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

function hashTrack({ artist, title }) {
  return crypto.createHash('sha1')
    .update(`${(artist || '').toLowerCase()}::${(title || '').toLowerCase()}`)
    .digest('hex');
}

function hashPlaylist({ platform, sourceId }) {
  return crypto.createHash('sha1')
    .update(`${platform}::${sourceId}`)
    .digest('hex');
}

function createLibrary(dir) {
  fssync.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'library.json');

  async function readAll() {
    try {
      return JSON.parse(await fs.readFile(file, 'utf8'));
    } catch { return {}; }
  }
  async function writeAll(obj) {
    await fs.writeFile(file, JSON.stringify(obj, null, 2), 'utf8');
  }

  return {
    async has(playlistHash, trackHash) {
      const all = await readAll();
      return Array.isArray(all[playlistHash]) && all[playlistHash].includes(trackHash);
    },
    async register(playlistHash, trackHash) {
      const all = await readAll();
      if (!Array.isArray(all[playlistHash])) all[playlistHash] = [];
      if (!all[playlistHash].includes(trackHash)) all[playlistHash].push(trackHash);
      await writeAll(all);
    },
  };
}

module.exports = { createLibrary, hashTrack, hashPlaylist };
