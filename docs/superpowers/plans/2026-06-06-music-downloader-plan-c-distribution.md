# Music Downloader — Plan C: Distribution + UX Polish

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Take the Plan B working app and ship it as an installable `.dmg` (macOS) and `.exe` (Windows) that a non-technical friend can double-click. Bundle `yt-dlp` and `ffmpeg`/`ffprobe` for both OS targets. Add a settings dialog, polish the welcome screen with a folder picker, implement the full tier-1/tier-2/tier-3 error UI, harden cross-platform paths, embed Spotify credentials at build time, and remove legacy Apple Music code.

**Architecture:** Add `electron-builder` configuration and a multi-target sidecar-fetch script that downloads platform binaries for every OS we ship to. The renderer gains a settings dialog and the welcome screen gains a folder picker (delegated to Electron's native `dialog` API via IPC). Error handling becomes explicit: tier-1 errors flow silently to the summary, tier-2 errors surface as inline messages with retry, tier-3 errors open a modal with a copyable reference code. Path operations gain a Windows MAX_PATH guard.

**Tech Stack:** `electron-builder` (new devDep). Everything else as in Plans A and B.

**Prerequisite:** Plans A and B are implemented and `npm test` is green.

---

## File map

| Path | Action | Purpose |
|------|--------|---------|
| `package.json` | modify | Add `electron-builder` devDep + `build` block + `dist` scripts |
| `electron-builder.yml` | create | Build configuration for mac and win targets |
| `scripts/fetch-binaries.js` | modify | Download both mac arches and Windows binaries (not just host) + bundle full ffmpeg |
| `scripts/embed-spotify.js` | create | Inline `.env` values into a generated module at build time |
| `main/spotify-creds.js` | create (generated) | Output of embed-spotify; imported by `main/ipc.js` |
| `main/ipc.js` | modify | Read creds from `main/spotify-creds.js` instead of `process.env`; add `dialog:pickFolder` and `library:reset` handlers; add tier-3 modal channel |
| `main/preload.js` | modify | Expose new APIs |
| `main/storage/paths.js` | modify | Add `truncateForOS` and use it in filename pipeline |
| `main/download/pipeline.js` | modify | Apply `truncateForOS` to final paths |
| `main/errors.js` | modify | Add `OutputFolderUnwritableError`, `NoInternetError` |
| `renderer/index.html` | modify | Settings dialog, folder picker button, tier-3 modal |
| `renderer/styles.css` | modify | Styles for dialog and modal |
| `renderer/main.js` | modify | Wire settings, folder picker, tier-3 modal |
| `app.js`, `app-spotify.js`, `src/getPlaylist.js`, `src/getDownloadLink.js`, `src/getSpotifyPlaylist.js`, `src/test.js` | delete | Legacy code |
| `assets/icon.png` | create | App icon (placeholder accepted; iconography below) |
| `assets/icon.icns` | create | macOS icon |
| `assets/icon.ico` | create | Windows icon |
| `docs/INSTALL-mac.md` | create | Install instructions for Mac friends |
| `docs/INSTALL-windows.md` | create | Install instructions for Windows friends |

---

## Task 1: Add `electron-builder` and build scripts

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install electron-builder**

```bash
npm install --save-dev electron-builder@^24.0.0
```

Expected: package added without errors.

- [ ] **Step 2: Update `package.json` scripts**

Add to the `"scripts"` section (keep existing entries):

```json
"dist:mac": "electron-builder --mac",
"dist:win": "electron-builder --win",
"dist": "electron-builder --mac --win",
"prepare-binaries": "node scripts/fetch-binaries.js --all",
"embed-creds": "node scripts/embed-spotify.js"
```

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore(dist): add electron-builder and build scripts"
```

---

## Task 2: Create `electron-builder.yml`

**Files:**
- Create: `electron-builder.yml`

- [ ] **Step 1: Write `electron-builder.yml`**

```yaml
appId: com.musicdownloader.app
productName: Music Downloader
copyright: Copyright © 2026
directories:
  output: dist
files:
  - "main/**/*"
  - "renderer/**/*"
  - "package.json"
  - "!**/*.test.js"
  - "!docs/**/*"
  - "!tests/**/*"
  - "!.superpowers/**/*"
extraResources:
  - from: "binaries"
    to: "binaries"
    filter:
      - "**/*"
asar: true
mac:
  target:
    - target: dmg
      arch:
        - arm64
        - x64
  category: public.app-category.music
  icon: assets/icon.icns
  hardenedRuntime: false
  gatekeeperAssess: false
  identity: null
win:
  target:
    - target: nsis
      arch:
        - x64
  icon: assets/icon.ico
nsis:
  oneClick: false
  allowToChangeInstallationDirectory: true
  perMachine: false
dmg:
  contents:
    - x: 130
      y: 220
    - x: 410
      y: 220
      type: link
      path: /Applications
```

- [ ] **Step 2: Commit**

```bash
git add electron-builder.yml
git commit -m "chore(dist): electron-builder config for mac dmg and win nsis"
```

---

## Task 3: Update `fetch-binaries.js` to support multi-target

**Files:**
- Modify: `scripts/fetch-binaries.js`

This is the biggest single rewrite. Plan A's version downloaded host-only and copied the system's `ffmpeg`. For shipping we need a fully self-contained `binaries/` per target.

- [ ] **Step 1: Replace `scripts/fetch-binaries.js`**

```javascript
#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const https = require('node:https');
const { spawnSync } = require('node:child_process');
const os = require('node:os');

const ROOT = path.resolve(__dirname, '..');
const BIN = path.join(ROOT, 'binaries');

const YT_DLP = {
  'mac-arm64': 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_macos',
  'mac-x64':   'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_macos',
  'win-x64':   'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe',
};

// Static, GPL-3-licensed builds maintained by BtbN. Pin the latest stable for reproducibility.
const FFMPEG = {
  'mac-arm64': 'https://www.osxexperts.net/ffmpeg711arm.zip',
  'mac-x64':   'https://www.osxexperts.net/ffmpeg711intel.zip',
  'win-x64':   'https://github.com/BtbN/FFmpeg-Builds/releases/latest/download/ffmpeg-master-latest-win64-gpl.zip',
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
        if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode} for ${u}`));
        res.pipe(file);
        file.on('finish', () => file.close(() => resolve()));
      }).on('error', reject);
    }
    get(url);
  });
}

async function fetchYtDlp(target) {
  const dir = path.join(BIN, target);
  ensureDir(dir);
  const dest = path.join(dir, target === 'win-x64' ? 'yt-dlp.exe' : 'yt-dlp');
  console.log(`downloading yt-dlp for ${target}`);
  await download(YT_DLP[target], dest);
  if (target !== 'win-x64') fs.chmodSync(dest, 0o755);
}

async function fetchFfmpeg(target) {
  const tmp = path.join(os.tmpdir(), `ffmpeg-${target}-${Date.now()}.zip`);
  console.log(`downloading ffmpeg bundle for ${target}`);
  await download(FFMPEG[target], tmp);

  const dir = path.join(BIN, target);
  ensureDir(dir);

  // Use system unzip (mac and modern Windows ship it; Windows users running this from
  // PowerShell can also use `Expand-Archive` but we standardize on unzip here).
  const extractDir = path.join(os.tmpdir(), `ffx-${target}-${Date.now()}`);
  ensureDir(extractDir);
  const r = spawnSync('unzip', ['-o', tmp, '-d', extractDir], { stdio: 'inherit' });
  if (r.status !== 0) throw new Error('unzip failed; install unzip and retry');

  // Walk the extract and copy ffmpeg + ffprobe.
  const exeSuffix = target === 'win-x64' ? '.exe' : '';
  let copiedFfmpeg = false, copiedFfprobe = false;
  function walk(d) {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name === `ffmpeg${exeSuffix}` && !copiedFfmpeg) {
        fs.copyFileSync(full, path.join(dir, `ffmpeg${exeSuffix}`));
        if (target !== 'win-x64') fs.chmodSync(path.join(dir, 'ffmpeg'), 0o755);
        copiedFfmpeg = true;
      } else if (entry.name === `ffprobe${exeSuffix}` && !copiedFfprobe) {
        fs.copyFileSync(full, path.join(dir, `ffprobe${exeSuffix}`));
        if (target !== 'win-x64') fs.chmodSync(path.join(dir, 'ffprobe'), 0o755);
        copiedFfprobe = true;
      }
    }
  }
  walk(extractDir);
  if (!copiedFfmpeg || !copiedFfprobe) {
    throw new Error(`ffmpeg or ffprobe missing in archive for ${target}`);
  }
  fs.unlinkSync(tmp);
}

(async () => {
  const all = process.argv.includes('--all');
  let targets;
  if (all) {
    targets = ['mac-arm64', 'mac-x64', 'win-x64'];
  } else {
    targets = [
      process.platform === 'darwin' && process.arch === 'arm64' ? 'mac-arm64' :
      process.platform === 'darwin' ? 'mac-x64' :
      process.platform === 'win32'  ? 'win-x64' : null,
    ].filter(Boolean);
    if (targets.length === 0) {
      console.error(`unsupported host platform: ${process.platform}`);
      process.exit(1);
    }
  }

  for (const t of targets) {
    await fetchYtDlp(t);
    await fetchFfmpeg(t);
  }
  console.log('done.');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
```

- [ ] **Step 2: Verify the script downloads everything**

```bash
npm run prepare-binaries
```

Expected: `binaries/mac-arm64`, `binaries/mac-x64`, and `binaries/win-x64` each contain `yt-dlp`/`yt-dlp.exe`, `ffmpeg`/`ffmpeg.exe`, and `ffprobe`/`ffprobe.exe`. Total size on disk ~300 MB.

- [ ] **Step 3: Sanity check each binary on the host that can run it**

```bash
./binaries/mac-arm64/yt-dlp --version || ./binaries/mac-x64/yt-dlp --version
./binaries/mac-arm64/ffmpeg -version | head -1 || ./binaries/mac-x64/ffmpeg -version | head -1
```

Expected: versions print.

- [ ] **Step 4: Commit (the binaries themselves remain ignored by .gitignore from Plan A)**

```bash
git add scripts/fetch-binaries.js
git commit -m "chore(binaries): multi-target download with bundled ffmpeg"
```

---

## Task 4: Embed Spotify credentials at build time

**Files:**
- Create: `scripts/embed-spotify.js`
- Create: `main/spotify-creds.js` (generated, ignored from git)
- Modify: `.gitignore`

- [ ] **Step 1: Add `main/spotify-creds.js` to `.gitignore`**

Edit `.gitignore`, append:

```
main/spotify-creds.js
```

- [ ] **Step 2: Write `scripts/embed-spotify.js`**

```javascript
#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');

const envPath = path.resolve(__dirname, '..', '.env');
if (!fs.existsSync(envPath)) {
  console.error('No .env found; copy .env.example to .env and fill in your Spotify credentials.');
  process.exit(1);
}

const env = {};
for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.+)\s*$/);
  if (m) env[m[1]] = m[2].replace(/^"|"$/g, '');
}

if (!env.SPOTIFY_CLIENT_ID || !env.SPOTIFY_CLIENT_SECRET) {
  console.error('SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET must be set in .env');
  process.exit(1);
}

const out = `// AUTO-GENERATED by scripts/embed-spotify.js. Do not commit.
module.exports = {
  clientId: ${JSON.stringify(env.SPOTIFY_CLIENT_ID)},
  clientSecret: ${JSON.stringify(env.SPOTIFY_CLIENT_SECRET)},
};
`;
fs.writeFileSync(path.resolve(__dirname, '..', 'main', 'spotify-creds.js'), out, 'utf8');
console.log('main/spotify-creds.js written.');
```

- [ ] **Step 3: Wire into the build flow**

Update `package.json` to make `dist` depend on credential embedding and binary prep. Replace the `dist:*` scripts with:

```json
"prebuild": "npm run prepare-binaries && npm run embed-creds",
"dist:mac": "npm run prebuild && electron-builder --mac",
"dist:win": "npm run prebuild && electron-builder --win",
"dist": "npm run prebuild && electron-builder --mac --win"
```

- [ ] **Step 4: Update `main/ipc.js` to read credentials from the generated file**

In `main/ipc.js`, replace the `createSpotifyClient` call:

```javascript
let creds;
try { creds = require('./spotify-creds.js'); }
catch { creds = { clientId: process.env.SPOTIFY_CLIENT_ID, clientSecret: process.env.SPOTIFY_CLIENT_SECRET }; }
const spotifyClient = createSpotifyClient(creds);
```

This way:
- Local dev (no `embed-creds` run): falls back to `.env` via the loader in `main/index.js`.
- Distributable builds: uses the inlined `spotify-creds.js`.

- [ ] **Step 5: Commit**

```bash
git add scripts/embed-spotify.js .gitignore main/ipc.js package.json
git commit -m "chore(dist): embed spotify creds at build time with .env fallback"
```

---

## Task 5: `truncateForOS` and Windows path safety

**Files:**
- Modify: `main/storage/paths.js`
- Modify: `tests/storage/paths.test.js`
- Modify: `main/download/pipeline.js`

- [ ] **Step 1: Write failing tests**

Append to `tests/storage/paths.test.js`:

```javascript
import { truncateForOS } from '../../main/storage/paths.js';

describe('truncateForOS', () => {
  it('passes through normal paths', () => {
    expect(truncateForOS('/Music/Playlist/Artist - Title.mp3', { platform: 'darwin' }))
      .toBe('/Music/Playlist/Artist - Title.mp3');
  });

  it('truncates the filename to keep the path under 260 chars on Windows', () => {
    const baseDir = 'C:\\Users\\Friend\\Music\\Music Downloader\\Some Playlist\\';
    const veryLong = 'A'.repeat(300) + '.mp3';
    const result = truncateForOS(baseDir + veryLong, { platform: 'win32' });
    expect(result.length).toBeLessThanOrEqual(259);
    expect(result.endsWith('.mp3')).toBe(true);
  });

  it('preserves directory and extension when truncating', () => {
    const baseDir = 'C:\\Users\\Friend\\Music\\My Playlist\\';
    const veryLong = 'A'.repeat(300) + '.mp3';
    const result = truncateForOS(baseDir + veryLong, { platform: 'win32' });
    expect(result.startsWith(baseDir)).toBe(true);
    expect(result.endsWith('.mp3')).toBe(true);
  });
});
```

- [ ] **Step 2: Run — expect failure**

```bash
npm test -- tests/storage/paths.test.js
```

- [ ] **Step 3: Implement `truncateForOS`**

Append to `main/storage/paths.js` (before `module.exports`):

```javascript
function truncateForOS(fullPath, opts = {}) {
  const platform = opts.platform || process.platform;
  if (platform !== 'win32') return fullPath;
  const MAX = 259;
  if (fullPath.length <= MAX) return fullPath;

  const ext = path.extname(fullPath);
  const dir = path.dirname(fullPath);
  const base = path.basename(fullPath, ext);
  const overflow = fullPath.length - MAX;
  const newBase = base.slice(0, Math.max(1, base.length - overflow));
  return path.join(dir, newBase + ext);
}
```

Update exports:

```javascript
module.exports = { sanitizeFilename, resolveBinary, revealInExplorer, truncateForOS };
```

- [ ] **Step 4: Use `truncateForOS` in the pipeline**

In `main/download/pipeline.js`, near the top, add:

```javascript
const { sanitizeFilename, truncateForOS } = require('../storage/paths.js');
```

(Replace the existing single-named import.) Then update the line that computes `finalPath`:

```javascript
const finalPath = truncateForOS(path.join(targetDir, filename));
```

- [ ] **Step 5: Run all tests**

```bash
npm test
```

Expected: all tests still pass plus the three new ones.

- [ ] **Step 6: Commit**

```bash
git add main/storage/paths.js tests/storage/paths.test.js main/download/pipeline.js
git commit -m "feat(paths): truncate filenames to fit windows MAX_PATH"
```

---

## Task 6: Folder picker via Electron `dialog`

**Files:**
- Modify: `main/ipc.js`
- Modify: `main/preload.js`

- [ ] **Step 1: Add the IPC handler**

In `main/ipc.js`, add to the imports:

```javascript
const { ipcMain, dialog } = require('electron');
```

(replace the existing `const { ipcMain } = require('electron');`).

Add a handler:

```javascript
ipcMain.handle('dialog:pickFolder', async (_e, current) => {
  const result = await dialog.showOpenDialog({
    defaultPath: current,
    properties: ['openDirectory', 'createDirectory'],
    title: 'Onde salvar as músicas?',
  });
  if (result.canceled || result.filePaths.length === 0) return { ok: false };
  return { ok: true, path: result.filePaths[0] };
});
```

- [ ] **Step 2: Expose in `main/preload.js`**

Add to the exposed `api`:

```javascript
dialog: {
  pickFolder: (current) => ipcRenderer.invoke('dialog:pickFolder', current),
},
```

- [ ] **Step 3: Commit**

```bash
git add main/ipc.js main/preload.js
git commit -m "feat(dialog): native folder picker via electron dialog"
```

---

## Task 7: Welcome screen — folder picker button

**Files:**
- Modify: `renderer/index.html`
- Modify: `renderer/main.js`

- [ ] **Step 1: Update the welcome section in `renderer/index.html`**

Replace the `.folder-row` div with:

```html
<div class="folder-row">
  <span id="welcomeFolder"></span>
  <button id="welcomeChangeFolder" type="button">Mudar</button>
</div>
```

- [ ] **Step 2: Update `renderer/main.js` `showWelcome`**

Replace:

```javascript
function showWelcome(cfg) {
  $('#welcome').hidden = false;
  $('#welcomeFolder').textContent = `📁 ${cfg.outputDir}`;
  $('#welcomeStart').addEventListener('click', async () => {
    await window.api.config.set({ firstRunCompleted: true });
    $('#welcome').hidden = true;
    showMain();
  });
}
```

With:

```javascript
function showWelcome(cfg) {
  let currentDir = cfg.outputDir;
  const render = () => { $('#welcomeFolder').textContent = `📁 ${currentDir}`; };
  $('#welcome').hidden = false;
  render();

  $('#welcomeChangeFolder').addEventListener('click', async () => {
    const r = await window.api.dialog.pickFolder(currentDir);
    if (r.ok) { currentDir = r.path; render(); }
  });

  $('#welcomeStart').addEventListener('click', async () => {
    await window.api.config.set({ outputDir: currentDir, firstRunCompleted: true });
    $('#welcome').hidden = true;
    showMain();
  });
}
```

- [ ] **Step 3: Commit**

```bash
git add renderer/index.html renderer/main.js
git commit -m "feat(welcome): folder picker on first run"
```

---

## Task 8: Settings dialog

**Files:**
- Modify: `renderer/index.html`
- Modify: `renderer/styles.css`
- Modify: `renderer/main.js`

- [ ] **Step 1: Add the settings dialog markup**

In `renderer/index.html`, inside `<section id="main" hidden>`, before the `.tabs` nav, add:

```html
<header class="appbar">
  <h1>Music Downloader</h1>
  <button id="settingsBtn" type="button" title="Configurações">⚙</button>
</header>

<dialog id="settingsDialog">
  <form method="dialog">
    <h2>Configurações</h2>
    <div class="settings-row">
      <label>Pasta de saída:</label>
      <span id="settingsFolder"></span>
      <button id="settingsChangeFolder" type="button">Mudar</button>
    </div>
    <div class="settings-row">
      <button id="settingsResetLibrary" type="button">Resetar histórico de downloads</button>
    </div>
    <div class="row-right">
      <button id="settingsClose" value="close">Fechar</button>
    </div>
  </form>
</dialog>
```

- [ ] **Step 2: Add styles**

Append to `renderer/styles.css`:

```css
.appbar { display: flex; align-items: center; justify-content: space-between; margin-bottom: 14px; }
.appbar h1 { font-size: 18px; margin: 0; }
#settingsBtn { background: transparent; color: #555; border: 1px solid #ddd; padding: 6px 10px; font-size: 14px; }
dialog#settingsDialog { border: 1px solid #ddd; border-radius: 8px; padding: 18px; min-width: 360px; }
dialog#settingsDialog::backdrop { background: rgba(0, 0, 0, 0.2); }
.settings-row { display: flex; align-items: center; gap: 8px; margin: 12px 0; flex-wrap: wrap; }
.settings-row label { font-size: 12px; color: #555; min-width: 100px; }
.settings-row span { flex: 1; font-size: 12px; color: #222; }
```

- [ ] **Step 3: Add a library reset IPC handler**

`main/ipc.js` already imports `node:path`. Add a new import for `node:fs/promises` near the top:

```javascript
const fsp = require('node:fs/promises');
```

Then inside `registerIpc(...)`, alongside the other `ipcMain.handle(...)` blocks, add:

```javascript
ipcMain.handle('library:reset', async () => {
  try {
    await fsp.unlink(path.join(userDataDir, 'library.json'));
  } catch { /* file may not exist */ }
  return { ok: true };
});
```

`userDataDir` is in scope because `registerIpc({ config, window, userDataDir })` receives it as a parameter (added in Plan B Task 9 step 3).

- [ ] **Step 4: Expose `library.reset` in `main/preload.js`**

Add:

```javascript
library: {
  reset: () => ipcRenderer.invoke('library:reset'),
},
```

- [ ] **Step 5: Wire the dialog in `renderer/main.js`**

Inside `showMain`, after `wireTabSwitching();`, add:

```javascript
async function refreshSettingsRows() {
  const cfg = await window.api.config.get();
  $('#settingsFolder').textContent = cfg.outputDir;
}

$('#settingsBtn').addEventListener('click', async () => {
  await refreshSettingsRows();
  $('#settingsDialog').showModal();
});

$('#settingsChangeFolder').addEventListener('click', async () => {
  const cfg = await window.api.config.get();
  const r = await window.api.dialog.pickFolder(cfg.outputDir);
  if (r.ok) {
    await window.api.config.set({ outputDir: r.path });
    await refreshSettingsRows();
  }
});

$('#settingsResetLibrary').addEventListener('click', async () => {
  if (confirm('Apagar histórico de downloads? Tracks já no disco continuam, mas o app deixará de pular re-downloads.')) {
    await window.api.library.reset();
  }
});
```

- [ ] **Step 6: Commit**

```bash
git add renderer/index.html renderer/styles.css renderer/main.js main/ipc.js main/preload.js
git commit -m "feat(settings): dialog for output folder and library reset"
```

---

## Task 9: Tier-3 error modal

**Files:**
- Modify: `renderer/index.html`
- Modify: `renderer/styles.css`
- Modify: `renderer/main.js`
- Modify: `main/ipc.js`

- [ ] **Step 1: Add modal markup to `renderer/index.html`**

Inside `<section id="main" hidden>`, append:

```html
<dialog id="tier3Dialog">
  <h2>Erro inesperado</h2>
  <p id="tier3Message"></p>
  <p>Código: <code id="tier3Reference"></code></p>
  <p style="font-size: 12px; color: #666;">Copie esse código e envie pra quem te passou o app.</p>
  <div class="row-right">
    <form method="dialog"><button>Fechar</button></form>
  </div>
</dialog>
```

- [ ] **Step 2: Add styles**

Append to `renderer/styles.css`:

```css
dialog#tier3Dialog { border: 1px solid #f0a; border-radius: 8px; padding: 18px; min-width: 360px; }
dialog#tier3Dialog code { background: #f3f3f3; padding: 4px 8px; border-radius: 4px; font-family: ui-monospace, monospace; }
```

- [ ] **Step 3: Add a global error listener that opens the modal**

In `renderer/main.js`, at the end of `showMain()`, add:

```javascript
window.addEventListener('app:tier3', (e) => {
  const { userMessage, reference } = e.detail;
  $('#tier3Message').textContent = userMessage;
  $('#tier3Reference').textContent = reference || '------';
  $('#tier3Dialog').showModal();
});
```

- [ ] **Step 4: Dispatch from places that receive `{ ok: false, code: 'UNEXPECTED' }`**

In `renderer/tabs/tab.js`, replace the bodies of the two places that call `showError(...)` with:

```javascript
if (!resp.ok) {
  if (resp.code === 'UNEXPECTED') {
    window.dispatchEvent(new CustomEvent('app:tier3', { detail: { userMessage: resp.userMessage, reference: resp.reference } }));
    showState('empty');
    return;
  }
  showError(resp.userMessage || 'Erro.');
  return;
}
```

(Apply at both `fetchBtnId` click and `previewStartId` click handlers.)

- [ ] **Step 5: Commit**

```bash
git add renderer/index.html renderer/styles.css renderer/main.js renderer/tabs/tab.js
git commit -m "feat(errors): tier-3 modal with copyable reference code"
```

---

## Task 10: Logs to disk

**Files:**
- Modify: `main/ipc.js`

- [ ] **Step 1: Add a tiny logger and move `errorPayload` inside `registerIpc`**

`main/ipc.js` already imports `node:path`. Add a new import near the top:

```javascript
const fssync = require('node:fs');
```

Then add this helper right above the `registerIpc` function definition:

```javascript
function makeLogger(userDataDir) {
  const logsDir = path.join(userDataDir, 'logs');
  fssync.mkdirSync(logsDir, { recursive: true });
  const errFile = path.join(logsDir, `error-${new Date().toISOString().slice(0, 10)}.log`);
  return (err, ref) => {
    const line = `${new Date().toISOString()} [${ref || '------'}] ${err?.stack || err?.message || String(err)}\n`;
    try { fssync.appendFileSync(errFile, line); } catch { /* ignore */ }
  };
}
```

Now refactor `registerIpc` so it owns the logger and an inner `errorPayload`. The previous free-floating `errorPayload` (at the bottom of the file) must be deleted because we're moving it inside.

Inside `registerIpc({ config, window, userDataDir })`, immediately after the existing variable setup (`const spotifyClient = …`, `const enrichment = …`, etc.) and **before** the first `ipcMain.handle(...)` line, add:

```javascript
const logError = makeLogger(userDataDir);

function errorPayload(err) {
  if (err instanceof errors.AppError && err.code !== 'UNEXPECTED') {
    return { ok: false, code: err.code, userMessage: err.userMessage };
  }
  const wrapped = err instanceof errors.UnexpectedError ? err : new errors.UnexpectedError(err);
  logError(err, wrapped.reference);
  return {
    ok: false,
    code: wrapped.code,
    userMessage: wrapped.userMessage,
    reference: wrapped.reference,
  };
}
```

Finally, delete the old `function errorPayload(err) { … }` block that sits at the bottom of `main/ipc.js` outside `registerIpc`. The new inner version supersedes it; existing call sites (`return errorPayload(err);` inside other handlers) keep working because they all run inside `registerIpc` and see the inner binding.

- [ ] **Step 2: Commit**

```bash
git add main/ipc.js
git commit -m "feat(errors): persistent error log under userData/logs/"
```

---

## Task 11: Delete legacy code

**Files:**
- Delete: `app.js`, `app-spotify.js`, `src/getPlaylist.js`, `src/getDownloadLink.js`, `src/getSpotifyPlaylist.js`, `src/test.js`

- [ ] **Step 1: Remove the files**

```bash
git rm app.js app-spotify.js
git rm -r src/
```

(If `src/` only contains the old files, `git rm -r src/` removes the whole directory.)

- [ ] **Step 2: Update README**

Replace the contents of `README.md` with a short pointer:

```markdown
# Music Downloader

Electron app that downloads tracks from Spotify, YouTube, and SoundCloud as MP3 with full ID3 tagging.

- **Design:** see `docs/superpowers/specs/2026-06-06-music-downloader-design.md`
- **Install instructions for friends:** `docs/INSTALL-mac.md`, `docs/INSTALL-windows.md`
- **Develop:** `npm install`, copy `.env.example` to `.env`, fill in Spotify creds, then `npm run prepare-binaries` and `npm start`.
- **Build:** `npm run dist:mac`, `npm run dist:win`, or `npm run dist` for both. Output under `dist/`.
```

- [ ] **Step 3: Run the test suite to confirm nothing depends on the deleted files**

```bash
npm test
```

Expected: all tests still pass.

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "chore: remove legacy CLI code; refresh readme for electron app"
```

---

## Task 12: Generate the icon files

Generating polished icons is out of scope; placeholder PNG is acceptable. The friend never sees the dev process.

**Files:**
- Create: `assets/icon.png` (1024×1024)
- Create: `assets/icon.icns` (macOS)
- Create: `assets/icon.ico` (Windows)

- [ ] **Step 1: Place a 1024×1024 PNG at `assets/icon.png`**

If you have no source: create a solid color square with the letter "M" using any image tool (Preview, Paint.NET, etc.) and export as PNG.

- [ ] **Step 2: Generate `.icns` (Mac)**

```bash
mkdir -p assets/icon.iconset
sips -z 16 16     assets/icon.png --out assets/icon.iconset/icon_16x16.png
sips -z 32 32     assets/icon.png --out assets/icon.iconset/icon_16x16@2x.png
sips -z 32 32     assets/icon.png --out assets/icon.iconset/icon_32x32.png
sips -z 64 64     assets/icon.png --out assets/icon.iconset/icon_32x32@2x.png
sips -z 128 128   assets/icon.png --out assets/icon.iconset/icon_128x128.png
sips -z 256 256   assets/icon.png --out assets/icon.iconset/icon_128x128@2x.png
sips -z 256 256   assets/icon.png --out assets/icon.iconset/icon_256x256.png
sips -z 512 512   assets/icon.png --out assets/icon.iconset/icon_256x256@2x.png
sips -z 512 512   assets/icon.png --out assets/icon.iconset/icon_512x512.png
cp assets/icon.png assets/icon.iconset/icon_512x512@2x.png
iconutil -c icns assets/icon.iconset -o assets/icon.icns
rm -rf assets/icon.iconset
```

(On Windows, skip this step; the Mac build is done on a Mac.)

- [ ] **Step 3: Generate `.ico` (Windows)**

`electron-builder` accepts a 256×256 PNG renamed as `.ico` for unsigned builds. For a cleaner result, use an online PNG-to-ICO converter or `imagemagick`:

```bash
convert assets/icon.png -define icon:auto-resize=16,32,48,64,128,256 assets/icon.ico
```

If `imagemagick` is not installed: `brew install imagemagick`.

- [ ] **Step 4: Commit**

```bash
git add assets/
git commit -m "chore(assets): app icon for mac and windows builds"
```

---

## Task 13: Write install instructions for friends

**Files:**
- Create: `docs/INSTALL-mac.md`
- Create: `docs/INSTALL-windows.md`

- [ ] **Step 1: Write `docs/INSTALL-mac.md`**

```markdown
# Como instalar o Music Downloader (Mac)

1. Baixe o arquivo **`Music Downloader-x.y.z.dmg`** que te mandei.
2. Dê dois cliques nele. Vai abrir uma janela com um ícone do app e a pasta "Applications".
3. Arraste o ícone do app pra dentro da pasta "Applications".
4. Vá no Launchpad (ou pasta Aplicativos), procure por "Music Downloader" e clique pra abrir.

## Se aparecer "Não foi possível verificar o desenvolvedor"

Isso é normal — o app não foi assinado por uma empresa. Pra resolver:

1. Vá em **Aplicativos** no Finder.
2. Clique com o botão direito no ícone do "Music Downloader" (use `Control + clique` se estiver com mousepad).
3. Escolha **"Abrir"**.
4. Vai aparecer um aviso de novo, agora com um botão **"Abrir"** — clique nele.

Depois disso, basta clicar normalmente nas próximas vezes.

## Onde ficam as músicas?

Na primeira vez que abrir, o app pergunta uma pasta. Pode deixar a padrão (`~/Música/Music Downloader/`) ou escolher outra. Cada playlist vira uma subpasta com os MP3s dentro.
```

- [ ] **Step 2: Write `docs/INSTALL-windows.md`**

```markdown
# Como instalar o Music Downloader (Windows)

1. Baixe o arquivo **`Music Downloader Setup x.y.z.exe`** que te mandei.
2. Dê dois cliques nele.

## Se aparecer "O Windows protegeu seu PC"

Isso é normal — o app não foi assinado por uma empresa.

1. Clique em **"Mais informações"**.
2. Clique em **"Executar mesmo assim"**.
3. Siga o instalador (você pode escolher onde instalar; o padrão tá ok).

## Onde ficam as músicas?

Na primeira vez que abrir, o app pergunta uma pasta. Pode deixar a padrão (`C:\Users\<você>\Music\Music Downloader\`) ou escolher outra. Cada playlist vira uma subpasta com os MP3s dentro.
```

- [ ] **Step 3: Commit**

```bash
git add docs/INSTALL-mac.md docs/INSTALL-windows.md
git commit -m "docs: install instructions for mac and windows friends"
```

---

## Task 14: Build the Mac DMG

- [ ] **Step 1: Ensure `.env` has real Spotify credentials**

```bash
grep -q '^SPOTIFY_CLIENT_ID=[^[:space:]]\+$' .env && echo OK || echo "fill .env first"
```

Expected: `OK`.

- [ ] **Step 2: Build**

```bash
npm run dist:mac
```

Expected: takes ~5-10 minutes. Output:
- `dist/Music Downloader-0.1.0-arm64.dmg` (~150 MB)
- `dist/Music Downloader-0.1.0.dmg` (Intel, ~150 MB)

- [ ] **Step 3: Smoke install**

1. Open the `.dmg` matching your Mac's architecture.
2. Drag the app into Applications.
3. Open from Applications (use the Control-click → Open dance described in `INSTALL-mac.md`).
4. The welcome screen appears; pick a folder.
5. Paste a known Spotify URL and download a playlist.
6. Verify the MP3s appear in the chosen folder.

- [ ] **Step 4: Commit any build artifacts you want tracked**

The `dist/` folder is large; don't commit it. If `.gitignore` does not yet ignore it, add:

```
dist/
```

```bash
git add .gitignore
git diff --cached --quiet || git commit -m "chore: ignore dist build output"
```

---

## Task 15: Build the Windows EXE (and smoke if possible)

Building Windows artifacts on a Mac requires `wine` (electron-builder will prompt). Building on Windows is simpler.

- [ ] **Step 1: Trigger the Windows build**

```bash
npm run dist:win
```

If you are on Mac, electron-builder will fetch and configure `wine` automatically. First run is slow (~10 minutes); subsequent runs reuse the cache.

If you have a Windows machine, run this command there after cloning the repo and copying your `.env`.

- [ ] **Step 2: Locate the artifact**

```bash
ls -la dist/*.exe
```

Expected: a file like `dist/Music Downloader Setup 0.1.0.exe` (~150 MB).

- [ ] **Step 3: Smoke install (on a Windows machine)**

1. Run the installer; click through the SmartScreen "Run anyway" if shown.
2. Open the app; complete the welcome flow.
3. Paste known URLs from each tab and verify a downloads.

If you do not have a Windows machine: ship the EXE to a Windows-using friend with a copy of `docs/INSTALL-windows.md` and ask them to confirm install + first download work.

---

## Task 16: Final end-to-end QA + release prep

- [ ] **Step 1: Run the entire test suite once more**

```bash
npm test
```

Expected: all green.

- [ ] **Step 2: Smoke matrix — confirm each tab on each fresh install**

For each of:
- Mac arm64 DMG
- Mac x64 DMG
- Windows EXE

Confirm:
1. Install works per its `INSTALL-*.md`.
2. Welcome flow runs once.
3. Spotify tab downloads a known playlist (3 tracks).
4. YouTube tab downloads a known playlist (3 tracks).
5. SoundCloud tab downloads a known set (or single track).
6. Re-running the same URL hits the library → skips all tracks.
7. Settings dialog opens, folder change persists, library reset works.
8. Tier-2 error: paste a junk URL → inline message in Portuguese.
9. Tier-3 error: temporarily revoke `SPOTIFY_CLIENT_ID` in build, rebuild, paste a Spotify URL → error modal with reference code.

(Skip step 9 on shipping builds; verify once during pre-release QA only.)

- [ ] **Step 3: Tag the release**

```bash
git tag v0.1.0
git push --tags
```

- [ ] **Step 4: Distribute**

- macOS: send the `.dmg` matching the friend's chip (Apple Silicon vs Intel) plus `docs/INSTALL-mac.md`.
- Windows: send the `.exe` plus `docs/INSTALL-windows.md`.

A short message helps: "Tá num arquivo .dmg/.exe. Clica duas vezes pra instalar. Se aparecer alerta, segue as instruções no PDF que mandei junto."

---

## Plan C complete

What you have at this point:
- A self-contained installer for macOS (both archs) and Windows.
- Spotify credentials embedded at build time so friends never see them.
- `yt-dlp` and `ffmpeg`/`ffprobe` bundled per target — no system dependencies on the friend's machine.
- Native folder picker, settings dialog, library reset.
- Tier-1 errors silent (failed tracks shown in summary); tier-2 inline with retry; tier-3 modal with a copyable reference code, also logged to disk.
- Windows MAX_PATH safety so long playlist names + filenames do not blow up.
- Friend-facing install docs in Portuguese.
- Legacy CLI removed.

## Open questions deferred from this plan

- **Apple Developer Program ($99/yr):** if friends report that the Gatekeeper dance is too much, the spec's Section 13 already describes the path. Update `electron-builder.yml` `mac` block: `identity: Developer ID Application: <name>` and `hardenedRuntime: true`, set `notarize` block, set `APPLE_ID` / `APPLE_APP_SPECIFIC_PASSWORD` env vars; build pipeline notarizes automatically.
- **Windows code-signing certificate (~$200/yr):** mirror the above for `win` block.
- **Auto-update:** Electron supports `electron-updater`; the appcast lives on any static host (GitHub Releases works). Defer until friends report install/update friction.
- **Apple Music re-introduction:** create `main/platforms/applemusic.js` following the same contract as the existing modules, add a fourth tab, follow the patterns in Plans A and B.
- **Discogs enrichment:** add `main/enrichment-discogs.js` with the same shape as `enrichment.js` and consult it before MusicBrainz in `pipeline.js`. Requires an embedded Discogs personal access token.
