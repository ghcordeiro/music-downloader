const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');

function defaults() {
  return {
    outputDir: path.join(os.homedir(), 'Music', 'Music Downloader'),
    firstRunCompleted: false,
  };
}

function createConfig(userDataDir) {
  const file = path.join(userDataDir, 'config.json');

  async function read() {
    try {
      const buf = await fs.readFile(file, 'utf8');
      const parsed = JSON.parse(buf);
      return { ...defaults(), ...parsed };
    } catch {
      return defaults();
    }
  }

  async function write(value) {
    await fs.mkdir(userDataDir, { recursive: true });
    await fs.writeFile(file, JSON.stringify(value, null, 2), 'utf8');
  }

  return {
    async get() { return read(); },
    async set(value) {
      const merged = { ...(await read()), ...value };
      await write(merged);
      return merged;
    },
  };
}

module.exports = { createConfig };
