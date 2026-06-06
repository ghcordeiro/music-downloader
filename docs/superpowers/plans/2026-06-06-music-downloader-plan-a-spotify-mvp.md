# Music Downloader — Plan A: Spotify MVP

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Electron foundation and a working Spotify download flow: user pastes a Spotify URL, the app shows a preview, then downloads tagged MP3 files into a chosen folder.

**Architecture:** Electron with a main/renderer/preload split. Main process houses one platform module (`spotify.js`), a download pipeline that wraps `yt-dlp` and `ffmpeg`, an ID3 tagger, a cross-platform paths helper, a typed errors module, and persistent config. Renderer is vanilla HTML/CSS/JS with a single Spotify tab covering five states (empty, loading, preview, downloading, done). MusicBrainz enrichment, mix-type parsing, the multi-tab UI, and the distributable installer come in Plans B and C respectively. This plan ends with a working app on the developer's machine, runnable via `npm start`.

**Tech Stack:** Electron 30+, Node.js 20+, `axios` (HTTP), `node-id3` (ID3 tags), Vitest (tests), `nock` (HTTP mocks). Sidecars: `yt-dlp` and `ffmpeg` downloaded once via a dev script (full bundling deferred to Plan C).

**Project root used throughout:** `/Users/guilhermecordeiro/www/pessoal/apple-playlist-downloader`

**Branch:** `music-downloader-electron` (new branch off `master`).

---

## File map

Files this plan creates:

| Path | Purpose |
|------|---------|
| `package.json` | Updated for Electron + new scripts |
| `vitest.config.js` | Vitest configuration |
| `main/index.js` | Electron bootstrap |
| `main/preload.js` | Secure renderer bridge |
| `main/ipc.js` | IPC handler registry |
| `main/errors.js` | Typed errors with Portuguese user messages |
| `main/storage/paths.js` | Filename sanitization, binary path resolution, reveal in explorer |
| `main/storage/config.js` | Read/write user config under `app.getPath('userData')` |
| `main/platforms/spotify.js` | Spotify URL parsing + Web API client |
| `main/download/ytdlp.js` | `yt-dlp` subprocess wrapper |
| `main/download/pipeline.js` | Track-by-track orchestrator |
| `main/tagging.js` | ID3 tag writer (essential fields only in Plan A) |
| `main/filename.js` | Filename builder (no mix parser yet — that arrives in Plan B) |
| `renderer/index.html` | Single-tab UI shell |
| `renderer/styles.css` | Visual style |
| `renderer/main.js` | Tab routing + global state |
| `renderer/tabs/spotify.js` | Spotify tab logic |
| `scripts/fetch-binaries.js` | Dev script that downloads `yt-dlp` and `ffmpeg` into `binaries/` |
| `tests/storage/paths.test.js` | Unit tests for paths.js |
| `tests/errors.test.js` | Unit tests for errors.js |
| `tests/storage/config.test.js` | Unit tests for config.js (uses tmp dirs) |
| `tests/download/ytdlp.test.js` | Unit tests for ytdlp.js (mocked subprocess) |
| `tests/platforms/spotify.test.js` | Unit + nock integration tests for spotify.js |
| `tests/filename.test.js` | Unit tests for filename.js |
| `tests/tagging.test.js` | Tests against a real MP3 fixture |
| `tests/download/pipeline.test.js` | Pipeline tests with mocked modules |
| `tests/fixtures/silent.mp3` | A tiny silent MP3 for tag-writing tests |

Files this plan **does not touch** (left as-is, removed in Plan C):
- `app.js`, `app-spotify.js`, `src/getPlaylist.js`, `src/getDownloadLink.js`, `src/getSpotifyPlaylist.js`, `src/test.js`

---

## Task 1: Create the working branch and rewrite `package.json`

**Files:**
- Modify: `package.json` (full rewrite)

- [ ] **Step 1: Create the branch**

```bash
git checkout -b music-downloader-electron
```

Expected output: `Switched to a new branch 'music-downloader-electron'`.

- [ ] **Step 2: Rewrite `package.json`**

Replace the file contents with:

```json
{
  "name": "music-downloader",
  "version": "0.1.0",
  "description": "Desktop app to download playlists and tracks as MP3 files with full ID3 tagging.",
  "main": "main/index.js",
  "scripts": {
    "start": "electron .",
    "test": "vitest run",
    "test:watch": "vitest",
    "fetch-binaries": "node scripts/fetch-binaries.js"
  },
  "author": "",
  "license": "ISC",
  "dependencies": {
    "axios": "^1.7.0",
    "node-id3": "^0.2.6"
  },
  "devDependencies": {
    "electron": "^30.0.0",
    "nock": "^13.5.0",
    "vitest": "^1.6.0"
  }
}
```

- [ ] **Step 3: Install dependencies**

```bash
npm install
```

Expected output: `added N packages` without errors. Vulnerability warnings are acceptable for this iteration.

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: switch project to electron skeleton"
```

---

## Task 2: Create the folder structure

**Files:**
- Create: `main/`, `main/platforms/`, `main/download/`, `main/storage/`
- Create: `renderer/`, `renderer/tabs/`
- Create: `scripts/`, `binaries/`, `tests/`, `tests/fixtures/`

- [ ] **Step 1: Create directories**

```bash
mkdir -p main/platforms main/download main/storage \
         renderer/tabs \
         scripts binaries \
         tests/storage tests/platforms tests/download tests/fixtures
```

- [ ] **Step 2: Add a `.gitkeep` to `binaries/` so the empty directory survives**

Create `binaries/.gitkeep` with no content.

- [ ] **Step 3: Commit**

```bash
git add main renderer scripts binaries tests
git commit -m "chore: scaffold music-downloader directory structure"
```

---

## Task 3: Smoke-test Electron with an empty window

**Files:**
- Create: `main/index.js`
- Create: `renderer/index.html`

- [ ] **Step 1: Write minimal `main/index.js`**

```javascript
const { app, BrowserWindow } = require('electron');
const path = require('path');

function createWindow() {
  const win = new BrowserWindow({
    width: 720,
    height: 540,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
```

- [ ] **Step 2: Write minimal `renderer/index.html`**

```html
<!DOCTYPE html>
<html lang="pt-br">
  <head>
    <meta charset="UTF-8" />
    <title>Music Downloader</title>
    <style>
      body { font-family: -apple-system, system-ui, sans-serif; padding: 40px; text-align: center; }
    </style>
  </head>
  <body>
    <h1>Music Downloader</h1>
    <p>Electron está rodando.</p>
  </body>
</html>
```

- [ ] **Step 3: Run the app**

```bash
npm start
```

Expected: an Electron window opens showing "Music Downloader / Electron está rodando." Close the window after verifying.

- [ ] **Step 4: Commit**

```bash
git add main/index.js renderer/index.html
git commit -m "feat(main): bootstrap electron window with placeholder renderer"
```

---

## Task 4: Configure Vitest

**Files:**
- Create: `vitest.config.js`

- [ ] **Step 1: Write `vitest.config.js`**

```javascript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.js'],
    globals: false,
  },
});
```

- [ ] **Step 2: Verify Vitest runs (no tests yet)**

```bash
npm test
```

Expected output: Vitest reports `No test files found, exiting with code 0` or similar. Confirms config loads.

- [ ] **Step 3: Commit**

```bash
git add vitest.config.js
git commit -m "chore: add vitest config"
```

---

## Task 5: `main/storage/paths.js` — `sanitizeFilename`

**Files:**
- Create: `main/storage/paths.js`
- Create: `tests/storage/paths.test.js`

- [ ] **Step 1: Write the failing test**

In `tests/storage/paths.test.js`:

```javascript
import { describe, it, expect } from 'vitest';
import { sanitizeFilename } from '../../main/storage/paths.js';

describe('sanitizeFilename', () => {
  it('removes characters forbidden on Windows', () => {
    const input = 'Daft Punk - Around <the> World: "remix"|extended?*/\\';
    expect(sanitizeFilename(input)).toBe('Daft Punk - Around the World remix extended');
  });

  it('collapses runs of whitespace and trims', () => {
    expect(sanitizeFilename('  Track    Name  ')).toBe('Track Name');
  });

  it('returns "untitled" for an empty or all-whitespace input', () => {
    expect(sanitizeFilename('')).toBe('untitled');
    expect(sanitizeFilename('   ')).toBe('untitled');
  });

  it('truncates very long names to keep filesystem-safe length', () => {
    const long = 'a'.repeat(300);
    const result = sanitizeFilename(long);
    expect(result.length).toBeLessThanOrEqual(200);
  });
});
```

- [ ] **Step 2: Run the tests — expect failure**

```bash
npm test -- tests/storage/paths.test.js
```

Expected: errors importing `sanitizeFilename` because the module does not exist yet.

- [ ] **Step 3: Implement `main/storage/paths.js`**

```javascript
const path = require('path');
const { exec } = require('child_process');

const FORBIDDEN_FILENAME_CHARS = /[<>:"/\\|?*\x00-\x1F]/g;
const MAX_FILENAME_LENGTH = 200;

function sanitizeFilename(name) {
  if (typeof name !== 'string') return 'untitled';
  const cleaned = name
    .replace(FORBIDDEN_FILENAME_CHARS, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (cleaned.length === 0) return 'untitled';
  return cleaned.length > MAX_FILENAME_LENGTH
    ? cleaned.slice(0, MAX_FILENAME_LENGTH).trim()
    : cleaned;
}

module.exports = { sanitizeFilename };
```

- [ ] **Step 4: Run the tests — expect pass**

```bash
npm test -- tests/storage/paths.test.js
```

Expected: 4 passing tests.

- [ ] **Step 5: Commit**

```bash
git add main/storage/paths.js tests/storage/paths.test.js
git commit -m "feat(storage): add sanitizeFilename in paths module"
```

---

## Task 6: `main/storage/paths.js` — `resolveBinary`

**Files:**
- Modify: `main/storage/paths.js`
- Modify: `tests/storage/paths.test.js`

- [ ] **Step 1: Append failing tests**

Append to `tests/storage/paths.test.js`:

```javascript
import { resolveBinary } from '../../main/storage/paths.js';
import path from 'node:path';

describe('resolveBinary', () => {
  it('returns the macOS arm64 path on Apple Silicon', () => {
    const result = resolveBinary('yt-dlp', { platform: 'darwin', arch: 'arm64', root: '/app' });
    expect(result).toBe(path.join('/app', 'binaries', 'mac-arm64', 'yt-dlp'));
  });

  it('returns the macOS x64 path on Intel Macs', () => {
    const result = resolveBinary('yt-dlp', { platform: 'darwin', arch: 'x64', root: '/app' });
    expect(result).toBe(path.join('/app', 'binaries', 'mac-x64', 'yt-dlp'));
  });

  it('appends .exe on Windows', () => {
    const result = resolveBinary('yt-dlp', { platform: 'win32', arch: 'x64', root: '/app' });
    expect(result).toBe(path.join('/app', 'binaries', 'win-x64', 'yt-dlp.exe'));
  });

  it('throws on unsupported platforms', () => {
    expect(() => resolveBinary('yt-dlp', { platform: 'linux', arch: 'x64', root: '/app' }))
      .toThrow(/unsupported platform/);
  });
});
```

- [ ] **Step 2: Run — expect failure**

```bash
npm test -- tests/storage/paths.test.js
```

Expected: `resolveBinary` import fails.

- [ ] **Step 3: Add to `main/storage/paths.js`**

Append to the module (before `module.exports`):

```javascript
function resolveBinary(name, opts = {}) {
  const platform = opts.platform || process.platform;
  const arch = opts.arch || process.arch;
  const root = opts.root || path.resolve(__dirname, '..', '..');

  let dir;
  let binName = name;
  if (platform === 'darwin' && arch === 'arm64') dir = 'mac-arm64';
  else if (platform === 'darwin' && arch === 'x64') dir = 'mac-x64';
  else if (platform === 'win32' && arch === 'x64') {
    dir = 'win-x64';
    binName = `${name}.exe`;
  } else {
    throw new Error(`unsupported platform/arch: ${platform}/${arch}`);
  }
  return path.join(root, 'binaries', dir, binName);
}
```

Then update the exports line:

```javascript
module.exports = { sanitizeFilename, resolveBinary };
```

- [ ] **Step 4: Run — expect pass**

```bash
npm test -- tests/storage/paths.test.js
```

Expected: 8 passing tests (4 from before + 4 new).

- [ ] **Step 5: Commit**

```bash
git add main/storage/paths.js tests/storage/paths.test.js
git commit -m "feat(storage): add resolveBinary in paths module"
```

---

## Task 7: `main/storage/paths.js` — `revealInExplorer`

**Files:**
- Modify: `main/storage/paths.js`

This wraps `child_process.exec` with the platform-specific command. It is not unit-tested (it does side effects on the OS); a manual smoke is enough.

- [ ] **Step 1: Add the function to `main/storage/paths.js`**

Append (before `module.exports`):

```javascript
function revealInExplorer(targetPath) {
  const platform = process.platform;
  if (platform === 'darwin') {
    exec(`open "${targetPath.replace(/"/g, '\\"')}"`);
  } else if (platform === 'win32') {
    exec(`explorer "${targetPath.replace(/"/g, '\\"')}"`);
  } else {
    throw new Error(`unsupported platform for revealInExplorer: ${platform}`);
  }
}
```

Update exports:

```javascript
module.exports = { sanitizeFilename, resolveBinary, revealInExplorer };
```

- [ ] **Step 2: Re-run all tests to confirm no regressions**

```bash
npm test
```

Expected: still 8 passing tests.

- [ ] **Step 3: Commit**

```bash
git add main/storage/paths.js
git commit -m "feat(storage): add revealInExplorer for finder/explorer opening"
```

---

## Task 8: `main/errors.js` — typed error classes

**Files:**
- Create: `main/errors.js`
- Create: `tests/errors.test.js`

- [ ] **Step 1: Write the failing test**

In `tests/errors.test.js`:

```javascript
import { describe, it, expect } from 'vitest';
import {
  InvalidUrlError,
  SpotifyAuthError,
  PlaylistNotFoundError,
  NetworkError,
  BinaryMissingError,
  DiskFullError,
  UnexpectedError,
} from '../main/errors.js';

describe('typed errors', () => {
  it('InvalidUrlError carries a Portuguese user message', () => {
    const err = new InvalidUrlError('https://bad');
    expect(err).toBeInstanceOf(Error);
    expect(err.code).toBe('INVALID_URL');
    expect(err.userMessage).toMatch(/link/i);
  });

  it('SpotifyAuthError indicates credential problems', () => {
    const err = new SpotifyAuthError('token revoked');
    expect(err.code).toBe('SPOTIFY_AUTH');
    expect(err.userMessage).toMatch(/Spotify/);
  });

  it('PlaylistNotFoundError carries the original URL', () => {
    const err = new PlaylistNotFoundError('https://open.spotify.com/playlist/abc');
    expect(err.code).toBe('PLAYLIST_NOT_FOUND');
    expect(err.url).toBe('https://open.spotify.com/playlist/abc');
  });

  it('UnexpectedError generates a short reference code', () => {
    const err = new UnexpectedError(new Error('boom'));
    expect(err.code).toBe('UNEXPECTED');
    expect(err.reference).toMatch(/^[A-Z0-9]{6}$/);
  });
});
```

- [ ] **Step 2: Run — expect failure**

```bash
npm test -- tests/errors.test.js
```

Expected: import errors.

- [ ] **Step 3: Implement `main/errors.js`**

```javascript
function randomReference() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = '';
  for (let i = 0; i < 6; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

class AppError extends Error {
  constructor(message, code, userMessage) {
    super(message);
    this.code = code;
    this.userMessage = userMessage;
  }
}

class InvalidUrlError extends AppError {
  constructor(url) {
    super(`invalid url: ${url}`, 'INVALID_URL', 'Esse link não parece ser válido.');
    this.url = url;
  }
}

class SpotifyAuthError extends AppError {
  constructor(detail) {
    super(`spotify auth failed: ${detail}`, 'SPOTIFY_AUTH',
      'Não consegui falar com o Spotify. As credenciais embutidas podem estar inválidas.');
  }
}

class PlaylistNotFoundError extends AppError {
  constructor(url) {
    super(`playlist not found: ${url}`, 'PLAYLIST_NOT_FOUND',
      'Não encontrei essa playlist. Confira se o link está correto e se a playlist é pública.');
    this.url = url;
  }
}

class NetworkError extends AppError {
  constructor(detail) {
    super(`network error: ${detail}`, 'NETWORK',
      'Sem conexão com a internet. Verifique sua rede e tente de novo.');
  }
}

class BinaryMissingError extends AppError {
  constructor(name) {
    super(`binary missing: ${name}`, 'BINARY_MISSING',
      'Um componente do app está faltando. Reinstale e tente novamente.');
    this.binary = name;
  }
}

class DiskFullError extends AppError {
  constructor() {
    super('disk full', 'DISK_FULL',
      'Espaço em disco insuficiente. Libere espaço e tente novamente.');
  }
}

class UnexpectedError extends AppError {
  constructor(cause) {
    super(`unexpected error: ${cause?.message || cause}`, 'UNEXPECTED',
      'Erro inesperado. Anote o código abaixo e mande pra quem te passou o app.');
    this.cause = cause;
    this.reference = randomReference();
  }
}

module.exports = {
  AppError,
  InvalidUrlError,
  SpotifyAuthError,
  PlaylistNotFoundError,
  NetworkError,
  BinaryMissingError,
  DiskFullError,
  UnexpectedError,
};
```

- [ ] **Step 4: Run — expect pass**

```bash
npm test -- tests/errors.test.js
```

Expected: 4 passing tests.

- [ ] **Step 5: Commit**

```bash
git add main/errors.js tests/errors.test.js
git commit -m "feat(errors): add typed errors with portuguese user messages"
```

---

## Task 9: `main/storage/config.js` — read/write config

**Files:**
- Create: `main/storage/config.js`
- Create: `tests/storage/config.test.js`

- [ ] **Step 1: Write the failing test**

In `tests/storage/config.test.js`:

```javascript
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
```

- [ ] **Step 2: Run — expect failure**

```bash
npm test -- tests/storage/config.test.js
```

- [ ] **Step 3: Implement `main/storage/config.js`**

```javascript
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
```

- [ ] **Step 4: Run — expect pass**

```bash
npm test -- tests/storage/config.test.js
```

Expected: 3 passing tests.

- [ ] **Step 5: Commit**

```bash
git add main/storage/config.js tests/storage/config.test.js
git commit -m "feat(storage): persistent config with defaults and corruption recovery"
```

---

## Task 10: `main/download/ytdlp.js` — subprocess wrapper

**Files:**
- Create: `main/download/ytdlp.js`
- Create: `tests/download/ytdlp.test.js`

- [ ] **Step 1: Write failing tests**

In `tests/download/ytdlp.test.js`:

```javascript
import { describe, it, expect, vi } from 'vitest';
import { runYtDlp } from '../../main/download/ytdlp.js';
import * as child from 'node:child_process';

describe('runYtDlp', () => {
  it('spawns the binary with the supplied args and resolves with stdout', async () => {
    const fakeStdout = JSON.stringify({ id: 'abc', title: 'Track' }) + '\n';
    const spy = vi.spyOn(child, 'spawn').mockImplementation(() => fakeProc(fakeStdout, '', 0));
    const out = await runYtDlp(['--dump-json', 'https://example.com/v'], {
      binaryPath: '/fake/yt-dlp',
    });
    expect(out.trim()).toContain('Track');
    expect(spy).toHaveBeenCalledWith('/fake/yt-dlp', ['--dump-json', 'https://example.com/v'], expect.any(Object));
  });

  it('rejects when the process exits non-zero', async () => {
    vi.spyOn(child, 'spawn').mockImplementation(() => fakeProc('', 'ERROR: not found\n', 1));
    await expect(
      runYtDlp(['x'], { binaryPath: '/fake/yt-dlp' })
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
      // schedule output after handlers register
      setImmediate(() => {
        handlers.stdout.forEach(h => h(Buffer.from(stdout)));
        handlers.stderr.forEach(h => h(Buffer.from(stderr)));
        handlers.close.forEach(h => h(exitCode));
      });
    },
    kill: () => {},
  };
}
```

- [ ] **Step 2: Run — expect failure**

```bash
npm test -- tests/download/ytdlp.test.js
```

- [ ] **Step 3: Implement `main/download/ytdlp.js`**

```javascript
const { spawn } = require('node:child_process');
const { resolveBinary } = require('../storage/paths.js');

function runYtDlp(args, opts = {}) {
  const binaryPath = opts.binaryPath || resolveBinary('yt-dlp');
  const signal = opts.signal;

  return new Promise((resolve, reject) => {
    const child = spawn(binaryPath, args, { signal });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (b) => { stdout += b.toString(); });
    child.stderr.on('data', (b) => { stderr += b.toString(); });
    child.on('close', (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(`yt-dlp exited ${code}: ${stderr.trim()}`));
    });
    child.on('error', (err) => reject(err));
  });
}

async function searchYouTubeForTrack({ artist, title }, opts = {}) {
  const query = `ytsearch1:${artist} - ${title}`;
  const out = await runYtDlp(['--dump-json', '--no-warnings', query], opts);
  const firstLine = out.trim().split('\n')[0];
  if (!firstLine) return null;
  const json = JSON.parse(firstLine);
  return { url: json.webpage_url || json.original_url || json.url, title: json.title };
}

async function downloadAudio(url, outputTemplate, opts = {}) {
  const args = [
    '-f', 'bestaudio',
    '-o', outputTemplate,
    '--no-warnings',
    '--no-playlist',
    url,
  ];
  await runYtDlp(args, opts);
}

module.exports = { runYtDlp, searchYouTubeForTrack, downloadAudio };
```

- [ ] **Step 4: Run — expect pass**

```bash
npm test -- tests/download/ytdlp.test.js
```

- [ ] **Step 5: Commit**

```bash
git add main/download/ytdlp.js tests/download/ytdlp.test.js
git commit -m "feat(download): yt-dlp subprocess wrapper with search and download"
```

---

## Task 11: `main/platforms/spotify.js` — URL parser

**Files:**
- Create: `main/platforms/spotify.js`
- Create: `tests/platforms/spotify.test.js`

- [ ] **Step 1: Write failing URL parser tests**

In `tests/platforms/spotify.test.js`:

```javascript
import { describe, it, expect } from 'vitest';
import { parseSpotifyUrl } from '../../main/platforms/spotify.js';

describe('parseSpotifyUrl', () => {
  it('parses playlist URLs', () => {
    expect(parseSpotifyUrl('https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M'))
      .toEqual({ type: 'playlist', id: '37i9dQZF1DXcBWIGoYBM5M' });
  });

  it('parses album URLs', () => {
    expect(parseSpotifyUrl('https://open.spotify.com/album/5MS3MvWHJ3lOZPLiMxzOU6'))
      .toEqual({ type: 'album', id: '5MS3MvWHJ3lOZPLiMxzOU6' });
  });

  it('parses track URLs', () => {
    expect(parseSpotifyUrl('https://open.spotify.com/track/11dFghVXANMlKmJXsNCbNl'))
      .toEqual({ type: 'track', id: '11dFghVXANMlKmJXsNCbNl' });
  });

  it('strips ?si=... share parameters', () => {
    expect(parseSpotifyUrl('https://open.spotify.com/playlist/abc?si=xyz'))
      .toEqual({ type: 'playlist', id: 'abc' });
  });

  it('throws InvalidUrlError on non-Spotify URLs', () => {
    expect(() => parseSpotifyUrl('https://youtube.com/x')).toThrow();
  });
});
```

- [ ] **Step 2: Run — expect failure**

```bash
npm test -- tests/platforms/spotify.test.js
```

- [ ] **Step 3: Implement the URL parser portion of `main/platforms/spotify.js`**

```javascript
const axios = require('axios');
const { InvalidUrlError, SpotifyAuthError, PlaylistNotFoundError, NetworkError } = require('../errors.js');

const URL_PATTERN = /^https?:\/\/open\.spotify\.com\/(playlist|album|track)\/([A-Za-z0-9]+)/;

function parseSpotifyUrl(rawUrl) {
  const url = (rawUrl || '').trim();
  const match = url.match(URL_PATTERN);
  if (!match) throw new InvalidUrlError(url);
  return { type: match[1], id: match[2] };
}

module.exports = { parseSpotifyUrl };
```

- [ ] **Step 4: Run — expect pass**

```bash
npm test -- tests/platforms/spotify.test.js
```

- [ ] **Step 5: Commit**

```bash
git add main/platforms/spotify.js tests/platforms/spotify.test.js
git commit -m "feat(spotify): parseSpotifyUrl for playlist/album/track/share URLs"
```

---

## Task 12: `main/platforms/spotify.js` — Client Credentials token

**Files:**
- Modify: `main/platforms/spotify.js`
- Modify: `tests/platforms/spotify.test.js`

- [ ] **Step 1: Install nock**

(Already in devDependencies from Task 1 — verify.)

```bash
node -e "require('nock')"
```

Expected: no output, no error.

- [ ] **Step 2: Append failing tests**

Append to `tests/platforms/spotify.test.js`:

```javascript
import nock from 'nock';
import { createSpotifyClient } from '../../main/platforms/spotify.js';

describe('Spotify token flow', () => {
  it('requests a Client Credentials token and caches until expiry', async () => {
    const tokenScope = nock('https://accounts.spotify.com')
      .post('/api/token', body =>
        body.includes('grant_type=client_credentials'))
      .reply(200, { access_token: 'tok-123', expires_in: 3600, token_type: 'Bearer' });

    const client = createSpotifyClient({ clientId: 'id', clientSecret: 'secret' });
    const tok1 = await client._getToken();
    const tok2 = await client._getToken();
    expect(tok1).toBe('tok-123');
    expect(tok2).toBe('tok-123');
    expect(tokenScope.isDone()).toBe(true);
  });

  it('throws SpotifyAuthError on 400/401 from token endpoint', async () => {
    nock('https://accounts.spotify.com')
      .post('/api/token')
      .reply(401, { error: 'invalid_client' });

    const client = createSpotifyClient({ clientId: 'bad', clientSecret: 'bad' });
    await expect(client._getToken()).rejects.toThrow(/Spotify/);
  });
});
```

- [ ] **Step 3: Run — expect failure**

```bash
npm test -- tests/platforms/spotify.test.js
```

- [ ] **Step 4: Implement client + token in `main/platforms/spotify.js`**

Replace the file contents with (keeping `parseSpotifyUrl`):

```javascript
const axios = require('axios');
const {
  InvalidUrlError, SpotifyAuthError, PlaylistNotFoundError, NetworkError,
} = require('../errors.js');

const URL_PATTERN = /^https?:\/\/open\.spotify\.com\/(playlist|album|track)\/([A-Za-z0-9]+)/;

function parseSpotifyUrl(rawUrl) {
  const url = (rawUrl || '').trim();
  const match = url.match(URL_PATTERN);
  if (!match) throw new InvalidUrlError(url);
  return { type: match[1], id: match[2] };
}

function createSpotifyClient({ clientId, clientSecret }) {
  let cachedToken = null;
  let cachedTokenExpiresAt = 0;

  async function _getToken() {
    const now = Date.now();
    if (cachedToken && now < cachedTokenExpiresAt - 30_000) return cachedToken;

    const basic = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
    try {
      const resp = await axios.post(
        'https://accounts.spotify.com/api/token',
        'grant_type=client_credentials',
        {
          headers: {
            'Authorization': `Basic ${basic}`,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          timeout: 10_000,
        }
      );
      cachedToken = resp.data.access_token;
      cachedTokenExpiresAt = now + resp.data.expires_in * 1000;
      return cachedToken;
    } catch (err) {
      if (err.response) throw new SpotifyAuthError(`HTTP ${err.response.status}`);
      throw new NetworkError(err.message);
    }
  }

  return { _getToken };
}

module.exports = { parseSpotifyUrl, createSpotifyClient };
```

- [ ] **Step 5: Run — expect pass**

```bash
npm test -- tests/platforms/spotify.test.js
```

- [ ] **Step 6: Commit**

```bash
git add main/platforms/spotify.js tests/platforms/spotify.test.js
git commit -m "feat(spotify): client credentials token with caching"
```

---

## Task 13: `main/platforms/spotify.js` — `fetchPlaylist`

**Files:**
- Modify: `main/platforms/spotify.js`
- Modify: `tests/platforms/spotify.test.js`

- [ ] **Step 1: Append failing tests**

```javascript
describe('fetchPlaylist', () => {
  it('returns playlist name, cover, and tracks shape', async () => {
    nock('https://accounts.spotify.com')
      .post('/api/token')
      .reply(200, { access_token: 'tok', expires_in: 3600, token_type: 'Bearer' });

    nock('https://api.spotify.com')
      .get('/v1/playlists/abc')
      .reply(200, {
        name: 'My Playlist',
        images: [{ url: 'https://cover.example/img.jpg' }],
        tracks: {
          items: [
            {
              track: {
                name: 'Track One',
                artists: [{ name: 'Artist A' }],
                duration_ms: 180_000,
                external_ids: { isrc: 'ISRC123' },
                album: {
                  id: 'alb1',
                  release_date: '2024-01-01',
                  images: [{ url: 'https://cover.example/alb.jpg' }],
                },
              },
            },
          ],
          next: null,
        },
      });

    const client = createSpotifyClient({ clientId: 'id', clientSecret: 'secret' });
    const result = await client.fetchPlaylist({ type: 'playlist', id: 'abc' });
    expect(result.playlistName).toBe('My Playlist');
    expect(result.coverUrl).toBe('https://cover.example/img.jpg');
    expect(result.tracks).toHaveLength(1);
    expect(result.tracks[0]).toMatchObject({
      name: 'Track One',
      artist: 'Artist A',
      durationSec: 180,
      isrc: 'ISRC123',
      year: '2024',
      albumId: 'alb1',
    });
  });

  it('paginates `next` to fetch all tracks', async () => {
    nock('https://accounts.spotify.com')
      .post('/api/token')
      .reply(200, { access_token: 'tok', expires_in: 3600, token_type: 'Bearer' });

    nock('https://api.spotify.com')
      .get('/v1/playlists/multi')
      .reply(200, {
        name: 'P', images: [],
        tracks: {
          items: [{ track: makeTrack('T1') }],
          next: 'https://api.spotify.com/v1/playlists/multi/tracks?offset=100',
        },
      });

    nock('https://api.spotify.com')
      .get('/v1/playlists/multi/tracks')
      .query(true)
      .reply(200, {
        items: [{ track: makeTrack('T2') }],
        next: null,
      });

    const client = createSpotifyClient({ clientId: 'id', clientSecret: 'secret' });
    const result = await client.fetchPlaylist({ type: 'playlist', id: 'multi' });
    expect(result.tracks.map(t => t.name)).toEqual(['T1', 'T2']);
  });
});

function makeTrack(name) {
  return {
    name,
    artists: [{ name: 'X' }],
    duration_ms: 60_000,
    external_ids: {},
    album: { id: 'a', release_date: '2024-01-01', images: [] },
  };
}
```

- [ ] **Step 2: Run — expect failure**

```bash
npm test -- tests/platforms/spotify.test.js
```

- [ ] **Step 3: Add `fetchPlaylist` to `main/platforms/spotify.js`**

Inside `createSpotifyClient`, before `return`, add:

```javascript
async function _authedGet(url) {
  const token = await _getToken();
  try {
    const resp = await axios.get(url, {
      headers: { Authorization: `Bearer ${token}` },
      timeout: 15_000,
    });
    return resp.data;
  } catch (err) {
    if (err.response?.status === 404) throw new PlaylistNotFoundError(url);
    if (err.response?.status === 401) throw new SpotifyAuthError('token rejected');
    if (err.response) throw new NetworkError(`spotify HTTP ${err.response.status}`);
    throw new NetworkError(err.message);
  }
}

function _mapItem(item) {
  const t = item.track || item;
  if (!t) return null;
  return {
    name: t.name,
    artist: (t.artists || []).map(a => a.name).join(', '),
    durationSec: Math.floor((t.duration_ms || 0) / 1000),
    coverUrl: t.album?.images?.[0]?.url || '',
    isrc: t.external_ids?.isrc || '',
    year: (t.album?.release_date || '').slice(0, 4),
    albumId: t.album?.id || '',
  };
}

async function fetchPlaylist({ type, id }) {
  if (type !== 'playlist') {
    throw new InvalidUrlError(`only playlists supported in plan A: ${type}`);
  }
  const first = await _authedGet(`https://api.spotify.com/v1/playlists/${id}`);
  const tracks = (first.tracks.items || []).map(_mapItem).filter(Boolean);

  let nextUrl = first.tracks.next;
  while (nextUrl) {
    const page = await _authedGet(nextUrl);
    tracks.push(...(page.items || []).map(_mapItem).filter(Boolean));
    nextUrl = page.next;
  }

  return {
    playlistName: first.name,
    coverUrl: first.images?.[0]?.url || '',
    tracks,
  };
}
```

Update the return to expose it:

```javascript
return { _getToken, fetchPlaylist };
```

- [ ] **Step 4: Run — expect pass**

```bash
npm test -- tests/platforms/spotify.test.js
```

- [ ] **Step 5: Commit**

```bash
git add main/platforms/spotify.js tests/platforms/spotify.test.js
git commit -m "feat(spotify): fetchPlaylist with pagination"
```

---

## Task 14: `main/platforms/spotify.js` — batch album labels

**Files:**
- Modify: `main/platforms/spotify.js`
- Modify: `tests/platforms/spotify.test.js`

- [ ] **Step 1: Append failing test**

```javascript
describe('attachAlbumLabels', () => {
  it('batches /v1/albums?ids=... up to 20 IDs per call', async () => {
    nock('https://accounts.spotify.com')
      .post('/api/token')
      .reply(200, { access_token: 'tok', expires_in: 3600, token_type: 'Bearer' });

    const ids = Array.from({ length: 25 }, (_, i) => `alb${i}`);
    const tracks = ids.map((id, i) => ({
      name: `T${i}`, artist: 'A', durationSec: 60, coverUrl: '',
      isrc: '', year: '', albumId: id,
    }));

    nock('https://api.spotify.com')
      .get('/v1/albums')
      .query(q => q.ids && q.ids.split(',').length === 20)
      .reply(200, { albums: ids.slice(0, 20).map(id => ({ id, label: `Lbl-${id}` })) });

    nock('https://api.spotify.com')
      .get('/v1/albums')
      .query(q => q.ids && q.ids.split(',').length === 5)
      .reply(200, { albums: ids.slice(20).map(id => ({ id, label: `Lbl-${id}` })) });

    const client = createSpotifyClient({ clientId: 'id', clientSecret: 'secret' });
    const enriched = await client.attachAlbumLabels(tracks);
    expect(enriched[0].label).toBe('Lbl-alb0');
    expect(enriched[24].label).toBe('Lbl-alb24');
  });
});
```

- [ ] **Step 2: Run — expect failure**

```bash
npm test -- tests/platforms/spotify.test.js
```

- [ ] **Step 3: Add `attachAlbumLabels` in `main/platforms/spotify.js`**

Inside `createSpotifyClient`, add:

```javascript
async function attachAlbumLabels(tracks) {
  const uniqueIds = [...new Set(tracks.map(t => t.albumId).filter(Boolean))];
  const idToLabel = new Map();

  for (let i = 0; i < uniqueIds.length; i += 20) {
    const slice = uniqueIds.slice(i, i + 20);
    const data = await _authedGet(
      `https://api.spotify.com/v1/albums?ids=${slice.join(',')}`
    );
    for (const album of data.albums || []) {
      if (album?.id) idToLabel.set(album.id, album.label || '');
    }
  }

  return tracks.map(t => ({ ...t, label: idToLabel.get(t.albumId) || '' }));
}
```

Update the return:

```javascript
return { _getToken, fetchPlaylist, attachAlbumLabels };
```

- [ ] **Step 4: Run — expect pass**

```bash
npm test -- tests/platforms/spotify.test.js
```

- [ ] **Step 5: Commit**

```bash
git add main/platforms/spotify.js tests/platforms/spotify.test.js
git commit -m "feat(spotify): batch album label lookup"
```

---

## Task 15: `main/filename.js` — `buildFilename` (no mix parser)

In Plan A the mix-type parser is deferred. Filename is `Artist - Title [Label].mp3` with graceful degradation.

**Files:**
- Create: `main/filename.js`
- Create: `tests/filename.test.js`

- [ ] **Step 1: Write failing tests**

In `tests/filename.test.js`:

```javascript
import { describe, it, expect } from 'vitest';
import { buildFilename } from '../main/filename.js';

describe('buildFilename', () => {
  it('with artist + title + label', () => {
    expect(buildFilename({ artist: 'Daft Punk', title: 'Around the World', label: 'Virgin' }))
      .toBe('Daft Punk - Around the World [Virgin].mp3');
  });

  it('omits the bracket when label is empty', () => {
    expect(buildFilename({ artist: 'Beyoncé', title: 'Halo', label: '' }))
      .toBe('Beyoncé - Halo.mp3');
  });

  it('sanitizes forbidden filename characters', () => {
    expect(buildFilename({ artist: 'A/B', title: 'X:Y', label: 'L|Z' }))
      .toBe('AB - XY [LZ].mp3');
  });

  it('substitutes "Unknown" for missing artist', () => {
    expect(buildFilename({ artist: '', title: 'X', label: '' })).toBe('Unknown - X.mp3');
  });
});
```

- [ ] **Step 2: Run — expect failure**

```bash
npm test -- tests/filename.test.js
```

- [ ] **Step 3: Implement `main/filename.js`**

```javascript
const { sanitizeFilename } = require('./storage/paths.js');

function buildFilename({ artist, title, label }) {
  const a = sanitizeFilename(artist || 'Unknown');
  const t = sanitizeFilename(title || 'untitled');
  const labelPart = label && label.trim()
    ? ` [${sanitizeFilename(label.trim())}]`
    : '';
  return `${a} - ${t}${labelPart}.mp3`;
}

module.exports = { buildFilename };
```

- [ ] **Step 4: Run — expect pass**

```bash
npm test -- tests/filename.test.js
```

- [ ] **Step 5: Commit**

```bash
git add main/filename.js tests/filename.test.js
git commit -m "feat(filename): basic builder with graceful degradation"
```

---

## Task 16: `main/tagging.js` — essential ID3 fields

This task needs a fixture MP3 to write tags to. A tiny silent MP3 (about 1 KB) is committed under `tests/fixtures/`.

**Files:**
- Create: `tests/fixtures/silent.mp3`
- Create: `main/tagging.js`
- Create: `tests/tagging.test.js`

- [ ] **Step 1: Generate the silent fixture**

```bash
ffmpeg -f lavfi -i anullsrc=r=44100:cl=mono -t 0.1 -q:a 9 -acodec libmp3lame tests/fixtures/silent.mp3 -y
```

(If `ffmpeg` is not on PATH yet, install via Homebrew: `brew install ffmpeg`.)

Expected: a `silent.mp3` of ~1–3 KB.

- [ ] **Step 2: Write failing tests**

In `tests/tagging.test.js`:

```javascript
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
```

- [ ] **Step 3: Run — expect failure**

```bash
npm test -- tests/tagging.test.js
```

- [ ] **Step 4: Implement `main/tagging.js`**

```javascript
const NodeID3 = require('node-id3');

async function writeTags(filePath, fields) {
  const tags = {
    title: fields.title || '',
    artist: fields.artist || '',
    album: fields.album || '',
    albumArtist: fields.albumArtist || 'Various Artists',
    trackNumber: fields.trackNumber || '',
    year: fields.year || '',
    comment: { language: 'eng', text: fields.comment || '' },
  };
  if (fields.publisher) tags.publisher = fields.publisher;
  if (fields.genre) tags.genre = fields.genre;
  if (fields.isrc) tags.ISRC = fields.isrc;
  if (fields.imageBuffer && fields.imageMime) {
    tags.image = {
      mime: fields.imageMime,
      type: { id: 3, name: 'Front Cover' },
      description: 'Cover',
      imageBuffer: fields.imageBuffer,
    };
  }
  const ok = NodeID3.write(tags, filePath);
  if (!ok) throw new Error(`failed to write ID3 tags to ${filePath}`);
}

module.exports = { writeTags };
```

- [ ] **Step 5: Run — expect pass**

```bash
npm test -- tests/tagging.test.js
```

- [ ] **Step 6: Commit**

```bash
git add main/tagging.js tests/tagging.test.js tests/fixtures/silent.mp3
git commit -m "feat(tagging): essential ID3 writer with cover-art support"
```

---

## Task 17: `main/download/pipeline.js` — single-track orchestration

This is the heart of Plan A. The pipeline takes one track at a time and runs: search → download → convert to MP3 → tag → emit events. To keep tests fast, sub-modules are injected.

**Files:**
- Create: `main/download/pipeline.js`
- Create: `tests/download/pipeline.test.js`

- [ ] **Step 1: Write failing test**

In `tests/download/pipeline.test.js`:

```javascript
import { describe, it, expect, vi } from 'vitest';
import { createPipeline } from '../../main/download/pipeline.js';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

describe('pipeline.run — single track happy path', () => {
  it('emits started → done and writes a file', async () => {
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mdrun-'));
    const events = [];
    const calls = { search: 0, download: 0, convert: 0, tag: 0 };

    const pipeline = createPipeline({
      ytdlp: {
        searchYouTubeForTrack: async () => { calls.search++; return { url: 'https://x', title: 'X' }; },
        downloadAudio: async (url, outputTemplate) => {
          calls.download++;
          // simulate yt-dlp writing the file
          const tmp = outputTemplate.replace('.%(ext)s', '.opus');
          fs.writeFileSync(tmp, Buffer.from('opus-bytes'));
        },
      },
      convertToMp3: async (input, output) => {
        calls.convert++;
        fs.copyFileSync(input, output);
      },
      writeTags: async () => { calls.tag++; },
      buildFilename: ({ artist, title }) => `${artist} - ${title}.mp3`,
      probeBitrateKbps: async () => 192,
    });

    await pipeline.run({
      playlistName: 'PL',
      tracks: [{ name: 'X', artist: 'A', durationSec: 60 }],
      outputDir: outDir,
      onEvent: (e) => events.push(e),
    });

    expect(events.map(e => e.type)).toEqual(['started', 'done']);
    expect(calls).toEqual({ search: 1, download: 1, convert: 1, tag: 1 });
    expect(fs.existsSync(path.join(outDir, 'PL', 'A - X.mp3'))).toBe(true);
  });
});
```

- [ ] **Step 2: Run — expect failure**

```bash
npm test -- tests/download/pipeline.test.js
```

- [ ] **Step 3: Implement `main/download/pipeline.js`**

```javascript
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { sanitizeFilename } = require('../storage/paths.js');

function uuid() {
  return crypto.randomBytes(8).toString('hex');
}

function createPipeline(deps) {
  const { ytdlp, convertToMp3, writeTags, buildFilename, probeBitrateKbps } = deps;

  async function run({ playlistName, tracks, outputDir, onEvent, signal }) {
    const targetDir = path.join(outputDir, sanitizeFilename(playlistName));
    await fsp.mkdir(targetDir, { recursive: true });

    const ok = [];
    const failed = [];

    for (let idx = 0; idx < tracks.length; idx++) {
      if (signal?.aborted) break;
      const track = tracks[idx];
      onEvent?.({ type: 'started', trackIdx: idx, name: track.name, artist: track.artist });

      try {
        const search = await ytdlp.searchYouTubeForTrack(
          { artist: track.artist, title: track.name },
          { signal }
        );
        if (!search) {
          onEvent?.({ type: 'not_found', trackIdx: idx, reason: 'no youtube result' });
          failed.push({ track, reason: 'not_found' });
          continue;
        }

        const tmpBase = path.join(os.tmpdir(), `mddl-${uuid()}`);
        const downloadTemplate = `${tmpBase}.%(ext)s`;
        await ytdlp.downloadAudio(search.url, downloadTemplate, { signal });

        // find what yt-dlp produced
        const sourceFile = await findDownloadedFile(tmpBase);
        const bitrateKbps = await probeBitrateKbps(sourceFile);

        const filename = buildFilename({
          artist: track.artist,
          title: track.name,
          label: track.label || '',
        });
        const finalPath = path.join(targetDir, filename);

        await convertToMp3(sourceFile, finalPath, { bitrateKbps, signal });

        await writeTags(finalPath, {
          title: track.name,
          artist: track.artist,
          album: playlistName,
          trackNumber: `${idx + 1}/${tracks.length}`,
          year: track.year || '',
          publisher: track.label || '',
          isrc: track.isrc || '',
          comment: `Source: ${search.title} → MP3 ${bitrateKbps}kbps`,
        });

        await fsp.unlink(sourceFile).catch(() => {});
        ok.push(track);
        onEvent?.({ type: 'done', trackIdx: idx });
      } catch (err) {
        onEvent?.({ type: 'not_found', trackIdx: idx, reason: err.message });
        failed.push({ track, reason: err.message });
      }
    }

    return { ok, failed };
  }

  return { run };
}

async function findDownloadedFile(tmpBase) {
  const dir = path.dirname(tmpBase);
  const prefix = path.basename(tmpBase);
  const entries = await fsp.readdir(dir);
  const match = entries.find(e => e.startsWith(prefix));
  if (!match) throw new Error(`download output not found for ${tmpBase}`);
  return path.join(dir, match);
}

module.exports = { createPipeline };
```

- [ ] **Step 4: Run — expect pass**

```bash
npm test -- tests/download/pipeline.test.js
```

- [ ] **Step 5: Commit**

```bash
git add main/download/pipeline.js tests/download/pipeline.test.js
git commit -m "feat(pipeline): single-track orchestrator with injected dependencies"
```

---

## Task 18: `main/download/pipeline.js` — not-found and abort handling

**Files:**
- Modify: `tests/download/pipeline.test.js`

- [ ] **Step 1: Append failing tests**

```javascript
describe('pipeline.run — failures', () => {
  it('emits not_found and continues to next track', async () => {
    const events = [];
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mdrun-'));

    const pipeline = createPipeline({
      ytdlp: {
        searchYouTubeForTrack: async ({ title }) => title === 'A' ? null : { url: 'https://x', title: 'B' },
        downloadAudio: async (url, t) => fs.writeFileSync(t.replace('.%(ext)s', '.opus'), Buffer.from('x')),
      },
      convertToMp3: async (i, o) => fs.copyFileSync(i, o),
      writeTags: async () => {},
      buildFilename: ({ artist, title }) => `${artist} - ${title}.mp3`,
      probeBitrateKbps: async () => 192,
    });

    const result = await pipeline.run({
      playlistName: 'PL',
      tracks: [
        { name: 'A', artist: 'X' },
        { name: 'B', artist: 'Y' },
      ],
      outputDir: outDir,
      onEvent: (e) => events.push(e),
    });

    expect(events.map(e => e.type)).toEqual(['started', 'not_found', 'started', 'done']);
    expect(result.failed).toHaveLength(1);
    expect(result.ok).toHaveLength(1);
  });

  it('stops on AbortSignal between tracks', async () => {
    const events = [];
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mdrun-'));
    const controller = new AbortController();

    const pipeline = createPipeline({
      ytdlp: {
        searchYouTubeForTrack: async () => ({ url: 'https://x', title: 'X' }),
        downloadAudio: async (url, t) => {
          fs.writeFileSync(t.replace('.%(ext)s', '.opus'), Buffer.from('x'));
          controller.abort(); // abort during first track
        },
      },
      convertToMp3: async (i, o) => fs.copyFileSync(i, o),
      writeTags: async () => {},
      buildFilename: ({ artist, title }) => `${artist} - ${title}.mp3`,
      probeBitrateKbps: async () => 192,
    });

    await pipeline.run({
      playlistName: 'PL',
      tracks: [{ name: 'X', artist: 'A' }, { name: 'Y', artist: 'A' }],
      outputDir: outDir,
      onEvent: (e) => events.push(e),
      signal: controller.signal,
    });

    // second track should never start
    expect(events.filter(e => e.type === 'started')).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run — expect pass (existing impl already handles these)**

```bash
npm test -- tests/download/pipeline.test.js
```

If a test fails, fix in `pipeline.js`; the abort check after each track is already in place.

- [ ] **Step 3: Commit**

```bash
git add tests/download/pipeline.test.js
git commit -m "test(pipeline): not_found continuation and abort handling"
```

---

## Task 19: `main/download/ffmpeg.js` — real ffmpeg helpers

The pipeline needs `convertToMp3` and `probeBitrateKbps`. They wrap `ffmpeg` and `ffprobe` binaries. The implementation can be tested only via integration — covered by smoke later.

**Files:**
- Create: `main/download/ffmpeg.js`

- [ ] **Step 1: Implement `main/download/ffmpeg.js`**

```javascript
const { spawn } = require('node:child_process');
const { resolveBinary } = require('../storage/paths.js');

function runBinary(name, args, signal) {
  return new Promise((resolve, reject) => {
    const child = spawn(resolveBinary(name), args, { signal });
    let stderr = '';
    let stdout = '';
    child.stdout.on('data', (b) => { stdout += b.toString(); });
    child.stderr.on('data', (b) => { stderr += b.toString(); });
    child.on('close', (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(`${name} exited ${code}: ${stderr.trim()}`));
    });
    child.on('error', reject);
  });
}

async function probeBitrateKbps(filePath) {
  const out = await runBinary('ffprobe', [
    '-v', 'error',
    '-select_streams', 'a:0',
    '-show_entries', 'stream=bit_rate',
    '-of', 'default=noprint_wrappers=1:nokey=1',
    filePath,
  ]);
  const bps = parseInt(out.trim(), 10);
  if (!Number.isFinite(bps) || bps <= 0) return 192;
  return Math.round(bps / 1000);
}

async function convertToMp3(input, output, opts = {}) {
  const bitrate = opts.bitrateKbps || 192;
  await runBinary('ffmpeg', [
    '-y',
    '-i', input,
    '-c:a', 'libmp3lame',
    '-b:a', `${bitrate}k`,
    '-ar', '44100',
    '-ac', '2',
    output,
  ], opts.signal);
}

module.exports = { probeBitrateKbps, convertToMp3 };
```

- [ ] **Step 2: Run all tests to confirm no regressions**

```bash
npm test
```

Expected: every test from previous tasks still passes (`ffmpeg.js` has no tests of its own; smoke covers it).

- [ ] **Step 3: Commit**

```bash
git add main/download/ffmpeg.js
git commit -m "feat(download): ffmpeg and ffprobe helpers"
```

---

## Task 20: `main/preload.js` — context bridge

**Files:**
- Create: `main/preload.js`

- [ ] **Step 1: Write `main/preload.js`**

```javascript
const { contextBridge, ipcRenderer } = require('electron');

const onProgressListeners = new Set();
ipcRenderer.on('download:progress', (_e, evt) => {
  for (const fn of onProgressListeners) fn(evt);
});

contextBridge.exposeInMainWorld('api', {
  config: {
    get: () => ipcRenderer.invoke('config:get'),
    set: (value) => ipcRenderer.invoke('config:set', value),
  },
  spotify: {
    fetchPlaylist: (url) => ipcRenderer.invoke('spotify:fetch', url),
  },
  download: {
    start: (payload) => ipcRenderer.invoke('download:start', payload),
    cancel: () => ipcRenderer.invoke('download:cancel'),
    onProgress: (cb) => {
      onProgressListeners.add(cb);
      return () => onProgressListeners.delete(cb);
    },
  },
  shell: {
    openFolder: (target) => ipcRenderer.invoke('shell:openFolder', target),
  },
});
```

- [ ] **Step 2: Commit**

```bash
git add main/preload.js
git commit -m "feat(preload): expose window.api with config, spotify, download, shell"
```

---

## Task 21: `main/ipc.js` — IPC handler registry

**Files:**
- Create: `main/ipc.js`

- [ ] **Step 1: Implement `main/ipc.js`**

```javascript
const { ipcMain, BrowserWindow } = require('electron');
const path = require('node:path');
const { parseSpotifyUrl, createSpotifyClient } = require('./platforms/spotify.js');
const { createPipeline } = require('./download/pipeline.js');
const ytdlp = require('./download/ytdlp.js');
const ffmpeg = require('./download/ffmpeg.js');
const { writeTags } = require('./tagging.js');
const { buildFilename } = require('./filename.js');
const { revealInExplorer } = require('./storage/paths.js');
const errors = require('./errors.js');

let activeAbort = null;

function broadcast(win, channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

function registerIpc({ config, window }) {
  const spotifyClient = createSpotifyClient({
    clientId: process.env.SPOTIFY_CLIENT_ID,
    clientSecret: process.env.SPOTIFY_CLIENT_SECRET,
  });

  const pipeline = createPipeline({
    ytdlp,
    convertToMp3: ffmpeg.convertToMp3,
    probeBitrateKbps: ffmpeg.probeBitrateKbps,
    writeTags,
    buildFilename,
  });

  ipcMain.handle('config:get', () => config.get());
  ipcMain.handle('config:set', (_e, value) => config.set(value));

  ipcMain.handle('spotify:fetch', async (_e, url) => {
    try {
      const parsed = parseSpotifyUrl(url);
      const data = await spotifyClient.fetchPlaylist(parsed);
      const enriched = await spotifyClient.attachAlbumLabels(data.tracks);
      return { ok: true, data: { ...data, tracks: enriched } };
    } catch (err) {
      return errorPayload(err);
    }
  });

  ipcMain.handle('download:start', async (_e, payload) => {
    const cfg = await config.get();
    activeAbort = new AbortController();
    try {
      const result = await pipeline.run({
        playlistName: payload.playlistName,
        tracks: payload.tracks,
        outputDir: cfg.outputDir,
        signal: activeAbort.signal,
        onEvent: (evt) => broadcast(window, 'download:progress', evt),
      });
      return { ok: true, data: result };
    } catch (err) {
      return errorPayload(err);
    } finally {
      activeAbort = null;
    }
  });

  ipcMain.handle('download:cancel', () => {
    if (activeAbort) activeAbort.abort();
    return { ok: true };
  });

  ipcMain.handle('shell:openFolder', (_e, target) => {
    revealInExplorer(target);
    return { ok: true };
  });
}

function errorPayload(err) {
  if (err instanceof errors.AppError) {
    return { ok: false, code: err.code, userMessage: err.userMessage };
  }
  const wrapped = new errors.UnexpectedError(err);
  return {
    ok: false,
    code: wrapped.code,
    userMessage: wrapped.userMessage,
    reference: wrapped.reference,
  };
}

module.exports = { registerIpc };
```

- [ ] **Step 2: Commit**

```bash
git add main/ipc.js
git commit -m "feat(ipc): handler registry wiring spotify/download/config/shell"
```

---

## Task 22: Wire main process to IPC and preload

**Files:**
- Modify: `main/index.js`

- [ ] **Step 1: Rewrite `main/index.js`**

```javascript
const { app, BrowserWindow } = require('electron');
const path = require('node:path');
const { createConfig } = require('./storage/config.js');
const { registerIpc } = require('./ipc.js');

let mainWindow = null;

function createWindow(config) {
  mainWindow = new BrowserWindow({
    width: 760,
    height: 580,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  return mainWindow;
}

app.whenReady().then(() => {
  const config = createConfig(app.getPath('userData'));
  const window = createWindow(config);
  registerIpc({ config, window });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow(config);
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
```

- [ ] **Step 2: Commit**

```bash
git add main/index.js
git commit -m "feat(main): wire config, ipc, and preload into the window"
```

---

## Task 23: Renderer — HTML and CSS shell

**Files:**
- Modify: `renderer/index.html` (full rewrite)
- Create: `renderer/styles.css`

- [ ] **Step 1: Rewrite `renderer/index.html`**

```html
<!DOCTYPE html>
<html lang="pt-br">
  <head>
    <meta charset="UTF-8" />
    <title>Music Downloader</title>
    <link rel="stylesheet" href="styles.css" />
  </head>
  <body>
    <div id="app">
      <!-- First-run welcome -->
      <section id="welcome" hidden>
        <h2>Onde você quer salvar as músicas?</h2>
        <p>Cada playlist vira uma pasta com as músicas dentro.</p>
        <div class="folder-row">
          <span id="welcomeFolder"></span>
          <!-- "Mudar" button deferred: hard default in Plan A; settings dialog in Plan C -->
        </div>
        <button id="welcomeStart">Começar</button>
      </section>

      <!-- Main tab UI -->
      <section id="main" hidden>
        <nav class="tabs">
          <button class="tab active" data-tab="spotify">Spotify</button>
        </nav>

        <div class="panel" id="spotifyPanel">
          <div class="state state-empty" data-state="empty">
            <p>Cole o link de uma playlist do Spotify:</p>
            <input id="spotifyUrl" placeholder="https://open.spotify.com/playlist/..." />
            <div class="row-right"><button id="spotifyFetch">Buscar</button></div>
          </div>

          <div class="state state-loading" data-state="loading" hidden>
            <p>Carregando…</p>
          </div>

          <div class="state state-preview" data-state="preview" hidden>
            <div class="preview">
              <img id="previewCover" alt="" />
              <div>
                <div id="previewName"></div>
                <div id="previewMeta"></div>
              </div>
            </div>
            <div class="row-right">
              <button id="previewCancel">Cancelar</button>
              <button id="previewStart">Baixar</button>
            </div>
          </div>

          <div class="state state-downloading" data-state="downloading" hidden>
            <div class="bar"><div id="bar" class="bar-fill"></div></div>
            <div id="counter"></div>
            <ul id="trackList"></ul>
            <div class="row-right"><button id="downloadCancel">Cancelar</button></div>
          </div>

          <div class="state state-done" data-state="done" hidden>
            <div id="summary"></div>
            <div class="row-right">
              <button id="openFolder">Ver pasta</button>
              <button id="anotherPlaylist">Baixar outra playlist</button>
            </div>
          </div>

          <div class="state state-error" data-state="error" hidden>
            <div id="errorMessage"></div>
            <div class="row-right"><button id="errorRetry">Voltar</button></div>
          </div>
        </div>
      </section>
    </div>

    <script type="module" src="main.js"></script>
  </body>
</html>
```

- [ ] **Step 2: Write `renderer/styles.css`**

```css
* { box-sizing: border-box; }
body {
  font-family: -apple-system, "Segoe UI", system-ui, sans-serif;
  margin: 0; padding: 0; background: #fafafa; color: #222;
}
#app { padding: 24px; max-width: 720px; margin: 0 auto; }
h2 { margin-top: 0; }
.tabs {
  display: flex; border-bottom: 1px solid #e5e5e5;
  margin-bottom: 16px;
}
.tab {
  background: transparent; border: none; padding: 12px 18px;
  font-size: 13px; color: #777; cursor: pointer;
  border-bottom: 3px solid transparent; font-weight: 500;
}
.tab.active { color: #1db954; border-bottom-color: #1db954; font-weight: 600; }
.panel { background: #fff; border-radius: 8px; padding: 20px; box-shadow: 0 2px 6px rgba(0,0,0,0.05); }
input {
  width: 100%; padding: 10px 12px; border: 1px solid #ccc;
  border-radius: 5px; font-size: 13px;
}
button {
  padding: 10px 18px; border-radius: 5px; font-size: 13px;
  border: none; cursor: pointer; font-weight: 600;
}
button#spotifyFetch, button#previewStart, button#welcomeStart, button#anotherPlaylist {
  background: #1db954; color: white;
}
button#previewCancel, button#downloadCancel, button#openFolder, button#errorRetry {
  background: transparent; color: #555; border: 1px solid #ddd;
}
.row-right { display: flex; gap: 8px; justify-content: flex-end; margin-top: 14px; }
.preview { display: flex; gap: 14px; padding: 14px; background: #f8f8f8; border-radius: 6px; margin-bottom: 14px; }
.preview img { width: 64px; height: 64px; border-radius: 4px; object-fit: cover; background: #ddd; }
#previewName { font-weight: 600; font-size: 14px; }
#previewMeta { font-size: 12px; color: #888; margin-top: 2px; }
.bar { height: 6px; background: #eee; border-radius: 3px; overflow: hidden; margin: 8px 0; }
.bar-fill { height: 100%; background: #e8472b; width: 0%; transition: width 0.2s; }
#trackList { list-style: none; padding: 0; margin: 8px 0; max-height: 240px; overflow-y: auto; font-size: 12px; }
#trackList li { padding: 4px 0; display: flex; gap: 8px; }
#trackList .num { color: #888; width: 32px; }
#trackList .name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
#trackList .status { width: 18px; text-align: center; }
.state-done #summary { padding: 16px; background: #f5f5f5; border-radius: 6px; text-align: center; }
.state-error #errorMessage { padding: 16px; background: #fff4f1; color: #b03a1f; border-radius: 6px; }
.folder-row { padding: 10px; background: #f5f5f5; border-radius: 6px; margin: 10px 0; }
```

- [ ] **Step 3: Commit**

```bash
git add renderer/index.html renderer/styles.css
git commit -m "feat(renderer): html shell and base styles"
```

---

## Task 24: Renderer — `main.js` shell logic

**Files:**
- Create: `renderer/main.js`
- Create: `renderer/tabs/spotify.js`

- [ ] **Step 1: Write `renderer/main.js`**

```javascript
import { initSpotifyTab } from './tabs/spotify.js';

const $ = (s, root = document) => root.querySelector(s);

async function init() {
  const cfg = await window.api.config.get();
  if (!cfg.firstRunCompleted) {
    showWelcome(cfg);
  } else {
    showMain();
  }
}

function showWelcome(cfg) {
  $('#welcome').hidden = false;
  $('#welcomeFolder').textContent = `📁 ${cfg.outputDir}`;
  $('#welcomeStart').addEventListener('click', async () => {
    await window.api.config.set({ firstRunCompleted: true });
    $('#welcome').hidden = true;
    showMain();
  });
}

function showMain() {
  $('#main').hidden = false;
  initSpotifyTab();
}

init().catch((err) => {
  console.error(err);
});
```

- [ ] **Step 2: Write `renderer/tabs/spotify.js`**

```javascript
const $ = (s, root = document) => root.querySelector(s);

function showState(name) {
  const panel = $('#spotifyPanel');
  panel.querySelectorAll('.state').forEach((el) => {
    el.hidden = el.dataset.state !== name;
  });
}

function renderPreview(data) {
  $('#previewName').textContent = data.playlistName;
  $('#previewMeta').textContent = `Spotify · ${data.tracks.length} músicas`;
  if (data.coverUrl) $('#previewCover').src = data.coverUrl;
  showState('preview');
}

function renderTrackList(tracks) {
  const ul = $('#trackList');
  ul.innerHTML = '';
  tracks.forEach((t, i) => {
    const li = document.createElement('li');
    li.dataset.idx = i;
    li.innerHTML = `<span class="num">${i + 1}</span><span class="name">${escapeHtml(t.artist)} — ${escapeHtml(t.name)}</span><span class="status"></span>`;
    ul.appendChild(li);
  });
}

function setTrackStatus(idx, icon) {
  const li = $('#trackList').querySelector(`li[data-idx="${idx}"]`);
  if (li) li.querySelector('.status').textContent = icon;
}

function showError(message) {
  $('#errorMessage').textContent = message;
  showState('error');
}

function escapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

export function initSpotifyTab() {
  let currentData = null;
  let currentTotal = 0;
  let completed = 0;

  $('#spotifyFetch').addEventListener('click', async () => {
    const url = $('#spotifyUrl').value.trim();
    if (!url) return;
    showState('loading');
    const resp = await window.api.spotify.fetchPlaylist(url);
    if (!resp.ok) {
      showError(resp.userMessage || 'Falha ao buscar a playlist.');
      return;
    }
    currentData = resp.data;
    renderPreview(currentData);
  });

  $('#previewCancel').addEventListener('click', () => {
    currentData = null;
    showState('empty');
  });

  $('#previewStart').addEventListener('click', async () => {
    currentTotal = currentData.tracks.length;
    completed = 0;
    renderTrackList(currentData.tracks);
    $('#counter').textContent = `0 / ${currentTotal}`;
    $('#bar').style.width = '0%';
    showState('downloading');

    const unsub = window.api.download.onProgress((evt) => {
      if (evt.type === 'started') setTrackStatus(evt.trackIdx, '↻');
      else if (evt.type === 'done') {
        setTrackStatus(evt.trackIdx, '✓');
        completed++;
      } else if (evt.type === 'not_found') {
        setTrackStatus(evt.trackIdx, '✗');
        completed++;
      } else if (evt.type === 'skipped') {
        setTrackStatus(evt.trackIdx, '·');
        completed++;
      }
      $('#counter').textContent = `${completed} / ${currentTotal}`;
      $('#bar').style.width = `${Math.round((completed / currentTotal) * 100)}%`;
    });

    const resp = await window.api.download.start({
      playlistName: currentData.playlistName,
      tracks: currentData.tracks,
    });
    unsub();

    if (!resp.ok) { showError(resp.userMessage || 'Erro ao baixar.'); return; }
    const okCount = resp.data.ok.length;
    const failed = resp.data.failed.length;
    $('#summary').innerHTML =
      `<div style="font-size:28px;font-weight:700;">${okCount} / ${currentTotal}</div>` +
      `<div>músicas baixadas</div>` +
      (failed ? `<div style="margin-top:8px;color:#cc6633">⚠ ${failed} não encontradas</div>` : '');
    showState('done');
  });

  $('#downloadCancel').addEventListener('click', () => {
    window.api.download.cancel();
  });

  $('#openFolder').addEventListener('click', async () => {
    const cfg = await window.api.config.get();
    await window.api.shell.openFolder(`${cfg.outputDir}/${currentData.playlistName}`);
  });

  $('#anotherPlaylist').addEventListener('click', () => {
    $('#spotifyUrl').value = '';
    showState('empty');
  });

  $('#errorRetry').addEventListener('click', () => showState('empty'));

  showState('empty');
}
```

- [ ] **Step 3: Commit**

```bash
git add renderer/main.js renderer/tabs/spotify.js
git commit -m "feat(renderer): main shell logic and spotify tab states"
```

---

## Task 25: Spotify credentials loader

The renderer never sees credentials. The main process reads them at boot time from `.env` during development, then at build time they will be baked into the bundle (Plan C). For Plan A development a simple `dotenv`-style read suffices.

**Files:**
- Modify: `main/index.js`
- Create: `.env.example` (already exists in untracked state; we'll overwrite)

- [ ] **Step 1: Update `.env.example` with the required keys**

Overwrite `.env.example`:

```
SPOTIFY_CLIENT_ID=your_client_id_here
SPOTIFY_CLIENT_SECRET=your_client_secret_here
```

- [ ] **Step 2: Add a tiny env loader at the top of `main/index.js`**

The file already starts with imports of `electron`, `node:path`, `./storage/config`, and `./ipc`. After the existing `const path = require('node:path');` line, add `const fs = require('node:fs');` (a new import), then place the loader block right after that. Do **not** redeclare `path` — reuse the existing one.

```javascript
const { app, BrowserWindow } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
try {
  const envPath = path.join(__dirname, '..', '.env');
  if (fs.existsSync(envPath)) {
    for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.+)\s*$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"|"$/g, '');
    }
  }
} catch { /* env loading is best-effort */ }
const { createConfig } = require('./storage/config.js');
const { registerIpc } = require('./ipc.js');
```

This is the first 10 lines of the file after the change. Leave the rest of `main/index.js` untouched.

- [ ] **Step 3: Create your local `.env` (not committed)**

```bash
cp .env.example .env
```

Then edit `.env` to add your real Client ID/Secret obtained from the Spotify Developer Dashboard.

- [ ] **Step 4: Verify `.env` is ignored**

```bash
git status --short | grep '\.env$' || echo "not tracked, good"
```

Expected: `not tracked, good`.

- [ ] **Step 5: Commit the example and the loader**

```bash
git add .env.example main/index.js
git commit -m "chore(env): add .env loader and example for spotify credentials"
```

---

## Task 26: Dev helper — `scripts/fetch-binaries.js`

Downloads `yt-dlp` and `ffmpeg`/`ffprobe` into `binaries/{mac-arm64,mac-x64,win-x64}/` so the app can run locally during development. Full bundling for distribution lives in Plan C.

**Files:**
- Create: `scripts/fetch-binaries.js`

- [ ] **Step 1: Write `scripts/fetch-binaries.js`**

```javascript
#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const https = require('node:https');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const BIN = path.join(ROOT, 'binaries');

const YT_DLP_RELEASES = {
  'mac-arm64': 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_macos',
  'mac-x64':   'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_macos',
  'win-x64':   'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe',
};

function ensureDir(d) { fs.mkdirSync(d, { recursive: true }); }

function download(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    function get(u) {
      https.get(u, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          return get(res.headers.location);
        }
        if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}`));
        res.pipe(file);
        file.on('finish', () => file.close(() => resolve()));
      }).on('error', reject);
    }
    get(url);
  });
}

async function fetchYtDlpFor(target) {
  const url = YT_DLP_RELEASES[target];
  if (!url) throw new Error(`no yt-dlp URL for ${target}`);
  const dir = path.join(BIN, target);
  ensureDir(dir);
  const dest = path.join(dir, target === 'win-x64' ? 'yt-dlp.exe' : 'yt-dlp');
  console.log(`downloading yt-dlp → ${dest}`);
  await download(url, dest);
  if (target !== 'win-x64') fs.chmodSync(dest, 0o755);
}

function copyHostFfmpeg(target) {
  // Plan A relies on a system-installed ffmpeg/ffprobe. Plan C will bundle proper sidecars.
  const which = (name) => spawnSync('which', [name], { encoding: 'utf8' }).stdout.trim();
  const ffmpeg = which('ffmpeg');
  const ffprobe = which('ffprobe');
  if (!ffmpeg || !ffprobe) {
    console.warn('ffmpeg/ffprobe not found on PATH. Install with `brew install ffmpeg` (mac).');
    return;
  }
  const dir = path.join(BIN, target);
  ensureDir(dir);
  fs.copyFileSync(ffmpeg, path.join(dir, 'ffmpeg'));
  fs.copyFileSync(ffprobe, path.join(dir, 'ffprobe'));
  fs.chmodSync(path.join(dir, 'ffmpeg'), 0o755);
  fs.chmodSync(path.join(dir, 'ffprobe'), 0o755);
  console.log(`copied host ffmpeg/ffprobe into ${dir}`);
}

(async () => {
  const target =
    process.platform === 'darwin' && process.arch === 'arm64' ? 'mac-arm64' :
    process.platform === 'darwin' ? 'mac-x64' :
    process.platform === 'win32'   ? 'win-x64' : null;
  if (!target) throw new Error(`unsupported platform: ${process.platform}`);

  await fetchYtDlpFor(target);
  copyHostFfmpeg(target);
  console.log('done.');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
```

- [ ] **Step 2: Run it once for your machine**

```bash
npm run fetch-binaries
```

Expected: `yt-dlp` is downloaded, and `ffmpeg`/`ffprobe` are copied from your system. If `brew install ffmpeg` is missing, install it first.

- [ ] **Step 3: Verify the binaries**

```bash
ls binaries/mac-arm64/  # or mac-x64 / win-x64 depending on host
./binaries/mac-arm64/yt-dlp --version
./binaries/mac-arm64/ffmpeg -version | head -1
```

Each should print a version.

- [ ] **Step 4: Commit the script (binaries stay ignored — see .gitignore update below)**

Add to `.gitignore` (modify):

```
node_modules/
songs/
.env
.DS_Store
.superpowers/
binaries/*/
!binaries/.gitkeep
```

```bash
git add scripts/fetch-binaries.js .gitignore
git commit -m "chore(binaries): dev script that fetches yt-dlp and copies ffmpeg"
```

---

## Task 27: End-to-end smoke

This is the manual integration test that proves Plan A works.

- [ ] **Step 1: Pre-flight**

```bash
test -f .env || echo "MISSING .env"
test -x binaries/mac-arm64/yt-dlp -o -x binaries/mac-x64/yt-dlp -o -x binaries/win-x64/yt-dlp.exe || echo "MISSING yt-dlp"
```

Expected: no `MISSING` output.

- [ ] **Step 2: Pick a tiny Spotify test playlist of your own**

Create a private playlist with 2-3 known songs. Copy its share URL.

- [ ] **Step 3: Run the app**

```bash
npm start
```

- [ ] **Step 4: Walk through the flow**

  1. The welcome screen appears (first run). Click "Começar".
  2. Paste the playlist URL into the Spotify tab. Click "Buscar".
  3. Preview shows the playlist name and track count.
  4. Click "Baixar".
  5. Watch progress per track; expect ✓ marks within ~30s per track on a decent connection.
  6. Done screen shows `N / N`. Click "Ver pasta".
  7. Finder/Explorer opens at the playlist folder. The MP3 files are present.

- [ ] **Step 5: Validate the files**

  - Open one MP3 in QuickTime / Windows Media Player → it plays.
  - Open it in MusicBrainz Picard (or any ID3 viewer) → title, artist, album (= playlist name), trackNumber, comment are filled.
  - Filename matches `Artist - Title [Label].mp3` (or without `[Label]` if not yet set).

- [ ] **Step 6: Re-run with the same URL**

  Repeat steps 3–6. Skip behavior is NOT yet present in Plan A (it lives in Plan B's `library.json`); expect re-download. This is the expected gap that Plan B closes.

- [ ] **Step 7: Capture findings**

Open `docs/superpowers/specs/2026-06-06-music-downloader-design.md` and add an entry to Section 14 if smoke surfaced anything unexpected (failing filenames, missing fields, OS quirks). Otherwise no action needed.

- [ ] **Step 8: Commit any notes**

```bash
git add docs/
git diff --cached --quiet || git commit -m "docs: smoke findings from plan A"
```

(If the diff is empty, the command does nothing — that is OK.)

---

## Task 28: Final cleanup and Plan A wrap

- [ ] **Step 1: Run the full test suite**

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 2: Run `npm start` once more end-to-end on a fresh session**

Confirms no regressions slipped in between commits.

- [ ] **Step 3: Push the branch**

```bash
git push -u origin music-downloader-electron
```

(Skip this step if not yet ready to share the branch.)

- [ ] **Step 4: Open a draft pull request titled "Music Downloader — Plan A (Spotify MVP)"**

This is optional but useful for tracking. If skipping, note in your local notes that Plan A is finished.

---

## Plan A complete

What you have at this point:
- Electron app that runs on your dev machine via `npm start`.
- One platform (Spotify), full URL → tagged MP3 flow.
- ID3 tags written: title, artist, album, trackNumber, year, label, ISRC, cover, comment.
- Filename: `Artist - Title [Label].mp3` with graceful degradation.
- First-run flow that establishes the output folder.
- Cancellation works mid-playlist.

What is intentionally **not yet** present:
- YouTube and SoundCloud tabs (Plan B).
- MusicBrainz enrichment for non-Spotify sources (Plan B).
- Mix-type parsing and the TIT3 subtitle (Plan B).
- Skip-if-exists library (Plan B).
- `.dmg` / `.exe` installer (Plan C).
- Code-signing instructions for friends (Plan C).
- Bundled binaries for cross-machine distribution (Plan C).
- Settings dialog for changing output folder (Plan C).
- Full tier-2 / tier-3 error UI polish (Plan C).
