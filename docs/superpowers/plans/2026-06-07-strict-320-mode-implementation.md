# Strict 320 kbps Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a per-install "Modo strict 320 kbps" toggle (default on) that converts Spotify-direct recoverable failures into skipped tracks instead of falling back to YouTube. The skipped list is surfaced and copyable in the Done summary.

**Architecture:** Single new flag flows from `config.json` → `ipc.js` → `pipeline.js`. When the flag is on and Spotify-direct returns a recoverable error, the pipeline pushes `{ track, reason: 'quality_floor_not_met' }` into `failed` and does not register the track in the library. The renderer's Done summary renders a callout listing those tracks with a copy-to-clipboard button. No new modules, no new sidecars, no new errors.

**Tech Stack:** Same as Plans A/B/C/D — Electron, Node 20+, Vitest. No new npm dependencies.

**Spec:** `docs/superpowers/specs/2026-06-07-strict-320-mode-design.md`. Read it before starting.

**Project root:** `/Users/guilhermecordeiro/www/pessoal/apple-playlist-downloader`

**Branch:** `feat/strict-320-mode` (already created off `main`; the spec is already committed there).

---

## File map

Files this plan modifies:

| Path | Change |
|------|--------|
| `main/storage/config.js` | `defaults()` returns `strict320Mode: true` |
| `tests/storage/config.test.js` | Asserts the new default |
| `main/download/pipeline.js` | `run()` accepts `strict320Mode`; recoverable Spotify-direct error becomes a `quality_floor_not_met` skip when on |
| `tests/download/pipeline.test.js` | Three new cases for strict on/off × success/failure |
| `main/ipc.js` | `download:start` reads `cfg.strict320Mode` and forwards it to `pipeline.run({...})` |
| `renderer/index.html` | Settings dialog gains a checkbox row under "Spotify Premium" |
| `renderer/main.js` | Reads current value into the checkbox; persists on change |
| `renderer/tabs/tab.js` | Done-state summary renders the `quality_floor_not_met` callout + "Copiar lista" button |

Files this plan does **not** touch:

- `main/spotify-direct/*`, `main/storage/spotify-auth.js` (auth + zotify unchanged)
- `main/storage/library.js` (library schema unchanged)
- `renderer/tabs/{spotify,youtube,soundcloud}.js` (tab-specific UI unchanged)
- `electron-builder.yml`, CI workflows (release uses the existing v0.2.0 pipeline)

---

## Task 1: `config.js` default gains `strict320Mode: true`

**Files:**
- Modify: `main/storage/config.js`
- Modify: `tests/storage/config.test.js`

- [ ] **Step 1: Append the failing test**

In `tests/storage/config.test.js`, add:

```javascript
describe('strict320Mode default', () => {
  it('defaults to true for fresh installs', async () => {
    const dir = tmpDir();
    const cfg = createConfig(dir);
    const value = await cfg.get();
    expect(value.strict320Mode).toBe(true);
  });

  it('persists an explicit false', async () => {
    const dir = tmpDir();
    const a = createConfig(dir);
    await a.set({ strict320Mode: false });
    const b = createConfig(dir);
    const value = await b.get();
    expect(value.strict320Mode).toBe(false);
  });
});
```

- [ ] **Step 2: Run — expect failure**

```bash
npm test -- tests/storage/config.test.js
```

Expected: the "defaults to true for fresh installs" case fails with `expected undefined to be true`.

- [ ] **Step 3: Update `main/storage/config.js`**

Change the `defaults` function:

```javascript
function defaults() {
  return {
    outputDir: path.join(os.homedir(), 'Music', 'Music Downloader'),
    firstRunCompleted: false,
    strict320Mode: true,
  };
}
```

Leave the rest of the file untouched. The existing `set()` already merges arbitrary keys, so the second test ("persists an explicit false") will pass without code change.

- [ ] **Step 4: Run — expect pass**

```bash
npm test -- tests/storage/config.test.js
```

Expected: all config tests green.

- [ ] **Step 5: Commit**

```bash
git add main/storage/config.js tests/storage/config.test.js
git commit -m "feat(config): default strict320Mode to true"
```

---

## Task 2: Pipeline honors `strict320Mode` for recoverable Spotify-direct failures

**Files:**
- Modify: `main/download/pipeline.js`
- Modify: `tests/download/pipeline.test.js`

The pipeline today already has a `recoverable` array gating the Spotify-direct → YouTube fallback (added in Plan D Task 11). We branch inside that gate based on the new flag.

- [ ] **Step 1: Append three failing tests**

Append to `tests/download/pipeline.test.js`:

```javascript
describe('pipeline.run — strict 320 mode', () => {
  function pipelineWithStrict(spotifyDirect) {
    return createPipeline({
      ytdlp: {
        searchYouTubeForTrack: async () => ({ url: 'https://yt/x', title: 'X' }),
        downloadAudio: async (url, t) => fs.writeFileSync(t.replace('.%(ext)s', '.opus'), Buffer.from('y')),
      },
      convertToMp3: async (i, o) => fs.copyFileSync(i, o),
      writeTags: async () => {},
      buildFilename: ({ artist, title }) => `${artist} - ${title}.mp3`,
      probeBitrateKbps: async () => 320,
      parseMixType: (t) => ({ cleanTitle: t, mixType: null }),
      enrichment: { lookup: async () => null },
      library: { has: async () => false, register: async () => {} },
      hashPlaylist: () => 'plh', hashTrack: () => 'th',
      spotifyDirect,
    });
  }

  it('strict on + recoverable error: marks quality_floor_not_met, no library registration, no YouTube call', async () => {
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mdrun-'));
    const events = [];
    let ytSearchCalls = 0;
    let registerCalls = 0;

    const pipeline = createPipeline({
      ytdlp: {
        searchYouTubeForTrack: async () => { ytSearchCalls++; return { url: 'https://yt/x', title: 'X' }; },
        downloadAudio: async () => {},
      },
      convertToMp3: async () => {},
      writeTags: async () => {},
      buildFilename: ({ artist, title }) => `${artist} - ${title}.mp3`,
      probeBitrateKbps: async () => 320,
      parseMixType: (t) => ({ cleanTitle: t, mixType: null }),
      enrichment: { lookup: async () => null },
      library: { has: async () => false, register: async () => { registerCalls++; } },
      hashPlaylist: () => 'plh', hashTrack: () => 'th',
      spotifyDirect: {
        getStatus: async () => ({ connected: true, email: 'a@b', plan: 'premium' }),
        downloadTrack: async () => {
          const e = new Error('not in catalog'); e.code = 'TRACK_NOT_FOUND_SPOTIFY';
          throw e;
        },
      },
    });

    const result = await pipeline.run({
      playlistName: 'PL',
      platform: 'spotify',
      sourceId: 'src',
      tracks: [{ name: 'X', artist: 'A', spotifyId: 'T1' }],
      outputDir: outDir,
      strict320Mode: true,
      onEvent: (e) => events.push(e),
    });

    expect(result.failed).toHaveLength(1);
    expect(result.failed[0].reason).toBe('quality_floor_not_met');
    expect(ytSearchCalls).toBe(0);
    expect(registerCalls).toBe(0);
    expect(events.map(e => e.type)).toContain('not_found');
  });

  it('strict on + Spotify-direct success: behaves identically to non-strict success', async () => {
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mdrun-'));
    let sdCalls = 0;
    const pipeline = pipelineWithStrict({
      getStatus: async () => ({ connected: true, email: 'a@b', plan: 'premium' }),
      downloadTrack: async (_id, outputPath) => {
        sdCalls++;
        fs.writeFileSync(outputPath, Buffer.from('ogg'));
        return { ok: true, sourceCodec: 'vorbis', sourceBitrateKbps: 320, outputPath };
      },
    });
    const result = await pipeline.run({
      playlistName: 'PL', platform: 'spotify', sourceId: 'src',
      tracks: [{ name: 'X', artist: 'A', spotifyId: 'T1' }],
      outputDir: outDir,
      strict320Mode: true,
      onEvent: () => {},
    });
    expect(sdCalls).toBe(1);
    expect(result.ok).toHaveLength(1);
    expect(result.failed).toHaveLength(0);
  });

  it('strict off + recoverable error: falls back to YouTube as before (regression guard for Plan D)', async () => {
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mdrun-'));
    let ytSearchCalls = 0;
    const pipeline = createPipeline({
      ytdlp: {
        searchYouTubeForTrack: async () => { ytSearchCalls++; return { url: 'https://yt/x', title: 'X' }; },
        downloadAudio: async (url, t) => fs.writeFileSync(t.replace('.%(ext)s', '.opus'), Buffer.from('y')),
      },
      convertToMp3: async (i, o) => fs.copyFileSync(i, o),
      writeTags: async () => {},
      buildFilename: ({ artist, title }) => `${artist} - ${title}.mp3`,
      probeBitrateKbps: async () => 128,
      parseMixType: (t) => ({ cleanTitle: t, mixType: null }),
      enrichment: { lookup: async () => null },
      library: { has: async () => false, register: async () => {} },
      hashPlaylist: () => 'plh', hashTrack: () => 'th',
      spotifyDirect: {
        getStatus: async () => ({ connected: true, email: 'a@b', plan: 'premium' }),
        downloadTrack: async () => {
          const e = new Error('region'); e.code = 'REGION_LOCKED';
          throw e;
        },
      },
    });
    const result = await pipeline.run({
      playlistName: 'PL', platform: 'spotify', sourceId: 'src',
      tracks: [{ name: 'X', artist: 'A', spotifyId: 'T1' }],
      outputDir: outDir,
      strict320Mode: false,
      onEvent: () => {},
    });
    expect(ytSearchCalls).toBe(1);
    expect(result.ok).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run — expect failure**

```bash
npm test -- tests/download/pipeline.test.js
```

Expected: the first new case ("strict on + recoverable error") fails because `pipeline.run()` does not yet accept `strict320Mode`.

- [ ] **Step 3: Modify `main/download/pipeline.js`**

Two changes inside `function createPipeline(deps)`:

**(a)** Update `run()`'s parameter list to accept `strict320Mode`:

```javascript
async function run({ playlistName, platform, sourceId, tracks, outputDir, onEvent, signal, strict320Mode }) {
```

**(b)** Inside the per-track loop, in the Spotify-direct attempt block, change the catch branch. Find the existing snippet:

```javascript
} catch (err) {
  const recoverable = ['TRACK_NOT_FOUND_SPOTIFY', 'REGION_LOCKED', 'PREMIUM_REQUIRED', 'ZOTIFY_UNRECOGNIZED', 'AUTH_EXPIRED', 'NOT_CONNECTED'];
  if (recoverable.includes(err.code)) {
    fallbackReason = err.code.toLowerCase();
  } else {
    throw err;
  }
}
```

Replace with:

```javascript
} catch (err) {
  const recoverable = ['TRACK_NOT_FOUND_SPOTIFY', 'REGION_LOCKED', 'PREMIUM_REQUIRED', 'ZOTIFY_UNRECOGNIZED', 'AUTH_EXPIRED', 'NOT_CONNECTED'];
  if (recoverable.includes(err.code)) {
    if (strict320Mode) {
      onEvent?.({ type: 'not_found', trackIdx: idx, reason: 'quality_floor_not_met' });
      failed.push({ track, reason: 'quality_floor_not_met' });
      continue;
    }
    fallbackReason = err.code.toLowerCase();
  } else {
    throw err;
  }
}
```

The `continue` skips the rest of the track body, which means `library.register()` is never called for a strict-skipped track — exactly the recovery behavior the spec requires.

- [ ] **Step 4: Run — expect pass**

```bash
npm test -- tests/download/pipeline.test.js
```

Expected: all pipeline tests green, including the three new ones.

- [ ] **Step 5: Run the full suite to confirm no regressions**

```bash
npm test
```

Expected: green across the board.

- [ ] **Step 6: Commit**

```bash
git add main/download/pipeline.js tests/download/pipeline.test.js
git commit -m "feat(pipeline): strict 320 mode skips instead of falling back to youtube"
```

---

## Task 3: IPC forwards `strict320Mode` from config to the pipeline

**Files:**
- Modify: `main/ipc.js`

No new unit test. The `download:start` handler is exercised end-to-end via the manual smoke at the bottom of the plan.

- [ ] **Step 1: Modify `main/ipc.js`**

Find the `download:start` handler:

```javascript
ipcMain.handle('download:start', async (_e, payload) => {
  const cfg = await config.get();
  activeAbort = new AbortController();
  try {
    const result = await pipeline.run({
      playlistName: payload.playlistName,
      platform: payload.platform,
      sourceId: payload.sourceId,
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
```

Add `strict320Mode` to the `pipeline.run({...})` argument object:

```javascript
ipcMain.handle('download:start', async (_e, payload) => {
  const cfg = await config.get();
  activeAbort = new AbortController();
  try {
    const result = await pipeline.run({
      playlistName: payload.playlistName,
      platform: payload.platform,
      sourceId: payload.sourceId,
      tracks: payload.tracks,
      outputDir: cfg.outputDir,
      signal: activeAbort.signal,
      onEvent: (evt) => broadcast(window, 'download:progress', evt),
      strict320Mode: cfg.strict320Mode,
    });
    return { ok: true, data: result };
  } catch (err) {
    return errorPayload(err);
  } finally {
    activeAbort = null;
  }
});
```

- [ ] **Step 2: Run full suite**

```bash
npm test
```

Expected: still green (no test references this handler directly).

- [ ] **Step 3: Commit**

```bash
git add main/ipc.js
git commit -m "feat(ipc): forward strict320Mode from config to pipeline.run"
```

---

## Task 4: Settings dialog gets the "Modo strict 320 kbps" row

**Files:**
- Modify: `renderer/index.html`
- Modify: `renderer/main.js`

The toggle is bound to `config.strict320Mode`. Reads the value when the dialog opens; writes to `config.set({ strict320Mode })` on change.

- [ ] **Step 1: Modify `renderer/index.html`**

Open `renderer/index.html` and locate the `<dialog id="settingsDialog"><form method="dialog">` block. Inside, between the existing "Spotify Premium" section and the "Histórico" reset row, add:

```html
<hr />
<div class="settings-row" style="align-items: flex-start;">
  <label style="min-width: 100px;">Qualidade:</label>
  <div style="flex: 1;">
    <label style="display: flex; gap: 8px; align-items: flex-start; font-size: 12px;">
      <input type="checkbox" id="settingsStrict320" />
      <span>
        <strong>Modo strict 320 kbps</strong><br />
        <span style="color: #666; font-size: 11px;">
          Tracks que não tiverem fonte em 320 kbps são puladas em vez de
          baixadas em qualidade menor. Só faz efeito quando Spotify Premium
          está conectado.
        </span>
      </span>
    </label>
  </div>
</div>
```

- [ ] **Step 2: Modify `renderer/main.js`**

Locate the existing `refreshSettingsRows` function (or the place where Settings reads the current config). After the function body, add a helper and wire the checkbox. Concretely, add this function near `refreshSettingsRows`:

```javascript
async function refreshStrict320Row() {
  const checkbox = $('#settingsStrict320');
  if (!checkbox) return;
  const cfg = await window.api.config.get();
  checkbox.checked = cfg.strict320Mode !== false;
}
```

Then, inside the existing `$('#settingsBtn').addEventListener('click', ...)` handler that opens the dialog, add the new refresh call alongside the existing ones:

```javascript
await refreshStrict320Row();
```

Finally, somewhere during initial wire-up of the Settings dialog (next to `$('#settingsResetLibrary').addEventListener(...)`), add the toggle listener:

```javascript
$('#settingsStrict320').addEventListener('change', async (e) => {
  await window.api.config.set({ strict320Mode: e.target.checked });
});
```

- [ ] **Step 3: Manual smoke test**

```bash
npm start
```

Walk:
1. Open the gear in the top-right. The Settings dialog opens with "Modo strict 320 kbps" checked (because fresh install default is `true`).
2. Uncheck it. Close the dialog. Reopen it. The checkbox is unchecked (persisted).
3. Check it again. Close. Reopen. Checked.
4. Close the app.

- [ ] **Step 4: Commit**

```bash
git add renderer/index.html renderer/main.js
git commit -m "feat(renderer): settings toggle for strict 320 kbps mode"
```

---

## Task 5: Done-state summary surfaces the strict-skip list

**Files:**
- Modify: `renderer/tabs/tab.js`

The current Plan D summary already breaks down per-source counts and shows fallback warnings. We add a new callout when at least one failed item has `reason === 'quality_floor_not_met'`, plus a "Copiar lista" button.

- [ ] **Step 1: Modify `renderer/tabs/tab.js`**

Locate the existing summary rendering block (the section that sets `$(summaryId).innerHTML = ...` with `okItems`, `failedItems`, `breakdownHtml`). Replace the block — from the line that starts `const okItems = resp.data.ok;` through and including `showState('done');` — with:

```javascript
const okItems = resp.data.ok;
const failedItems = resp.data.failed;
const okCount = okItems.length;

const viaSpotify = okItems.filter((o) => o.via === 'spotify-direct').length;
const viaYouTube = okItems.filter((o) => o.via === 'youtube').length;
const viaYouTubeFallback = okItems.filter((o) => o.via === 'youtube' && o.fallbackReason).length;

let breakdownHtml = '';
if (viaSpotify > 0 && viaYouTube > 0) {
  breakdownHtml = `<div style="margin-top:6px;font-size:12px;color:#555;">${viaSpotify} via Spotify · ${viaYouTube} via YouTube (fallback)</div>`;
} else if (viaSpotify > 0) {
  breakdownHtml = `<div style="margin-top:6px;font-size:12px;color:#555;">${viaSpotify} via Spotify · 320 kbps</div>`;
} else if (viaYouTube > 0 && currentData.platform === 'spotify') {
  breakdownHtml = `<div style="margin-top:6px;font-size:12px;color:#555;">${viaYouTube} via YouTube</div>`;
}
if (viaYouTubeFallback > 0) {
  breakdownHtml += `<div style="margin-top:6px;font-size:12px;color:#cc6633;">⚠ ${viaYouTubeFallback} em ~128 kbps (YouTube) — download direto Spotify falhou</div>`;
}

const strictSkipped = failedItems.filter((f) => f.reason === 'quality_floor_not_met');
const otherFailed = failedItems.filter((f) => f.reason !== 'quality_floor_not_met');

let strictSkipHtml = '';
if (strictSkipped.length > 0) {
  const listText = strictSkipped
    .map((f) => `${f.track.artist} — ${f.track.name}`)
    .join('\n');
  const listHtml = strictSkipped
    .map((f) => `<li>${escapeHtml(f.track.artist)} — ${escapeHtml(f.track.name)}</li>`)
    .join('');
  strictSkipHtml =
    `<div style="margin-top:10px;padding:8px 10px;background:#fff4ec;border:1px solid #ffd5b8;border-radius:6px;font-size:12px;">` +
    `<div style="color:#cc6633;font-weight:600;margin-bottom:4px;">⚠ ${strictSkipped.length} não baixadas (fonte 320 indisponível)</div>` +
    `<ul style="margin:4px 0 0 18px;padding:0;color:#555;">${listHtml}</ul>` +
    `<button type="button" id="strictCopyBtn" style="margin-top:8px;padding:6px 12px;font-size:11px;background:transparent;color:#555;border:1px solid #ddd;border-radius:4px;cursor:pointer;">Copiar lista</button>` +
    `</div>`;
  // After insertion, wire the button (see below).
  setTimeout(() => {
    const btn = document.querySelector('#strictCopyBtn');
    if (btn) {
      btn.addEventListener('click', async () => {
        await navigator.clipboard.writeText(listText);
        btn.textContent = 'Copiado ✓';
        setTimeout(() => { btn.textContent = 'Copiar lista'; }, 1500);
      });
    }
  }, 0);
}

const okWordingHtml = strictSkipped.length > 0
  ? `<div>músicas baixadas em 320</div>`
  : `<div>músicas baixadas</div>`;

$(summaryId).innerHTML =
  `<div style="font-size:28px;font-weight:700;">${okCount} / ${currentTotal}</div>` +
  okWordingHtml +
  breakdownHtml +
  strictSkipHtml +
  (otherFailed.length
    ? `<div style="margin-top:8px;color:#cc6633">⚠ ${otherFailed.length} falharam</div>`
      + (otherFailed[0]?.reason
        ? `<div style="margin-top:4px;font-size:12px;color:#888">Ex.: ${escapeHtml(String(otherFailed[0].reason).slice(0, 120))}</div>`
        : '')
    : '');
showState('done');
```

The `setTimeout(..., 0)` defers the button wiring until after `innerHTML` runs and the new DOM is attached. This avoids needing a separate render lifecycle for one button.

- [ ] **Step 2: Manual smoke test**

```bash
npm start
```

This requires manufacturing a strict skip. Easiest path: temporarily make `main/spotify-direct/zotify.js` throw `TRACK_NOT_FOUND_SPOTIFY` for one specific track ID (revert before commit). Or use a track known to be region-locked in your account.

Walk:
1. Confirm Settings has strict on.
2. Download a playlist that includes the synthetic-failure track.
3. Done screen shows the "fonte 320 indisponível" callout.
4. "Copiar lista" button copies the expected `Artist — Title` lines.
5. Pasting into a Notes app shows one line per skipped track.

- [ ] **Step 3: Commit**

```bash
git add renderer/tabs/tab.js
git commit -m "feat(renderer): strict skip callout with copy-to-clipboard in summary"
```

---

## Task 6: Full end-to-end smoke

This is the canonical "shipping" check. Run before opening the PR.

- [ ] **Step 1: Pre-flight**

```bash
test -f .env || echo "MISSING .env"
node -e "const c = require('./main/spotify-creds.js'); ['clientId','clientSecret','oauthClientId'].forEach(k => { if (!c[k]) console.error('MISSING', k); })"
ls binaries/mac-arm64/zotify || ls binaries/mac-x64/zotify || ls binaries/win-x64/zotify.exe
```

Expected: no `MISSING` output.

- [ ] **Step 2: Confirm default is strict on**

```bash
rm -rf ~/Library/Application\ Support/MusicDownloader/config.json
npm start
```

Open Settings. Verify "Modo strict 320 kbps" is checked. Close.

(Reading the empty userData causes `config.get()` to return defaults, which now include `strict320Mode: true`.)

- [ ] **Step 3: Strict mode happy path**

Paste a playlist URL known to have all tracks available on Spotify. Click Buscar → Baixar.

Verify:
1. All tracks complete via Spotify-direct (✓ marks).
2. Summary shows `N / N · músicas baixadas em 320` plus `N via Spotify · 320 kbps`.
3. No "fonte 320 indisponível" callout.

- [ ] **Step 4: Strict mode skip path**

Paste a playlist URL that contains at least one track known to fail Spotify-direct (region-locked, removed, or use the synthetic failure from Task 5 Step 2).

Verify:
1. Successful tracks complete via Spotify-direct.
2. The failing track shows ✗ in the list.
3. Summary shows `(N-1) / N · músicas baixadas em 320`.
4. "fonte 320 indisponível" callout lists the failed track.
5. "Copiar lista" copies `Artist — Title` to clipboard.

- [ ] **Step 5: Strict off regression check**

Open Settings. Uncheck strict. Re-run the same playlist URL from Step 4.

Verify:
1. Previously-skipped track now downloads via YouTube.
2. Summary shows `N / N · músicas baixadas` (no "em 320" suffix because mixed sources).
3. Per-source breakdown shows `via Spotify · via YouTube (fallback)` or similar.

- [ ] **Step 6: Commit notes if anything surprised you**

```bash
git add docs/
git diff --cached --quiet || git commit -m "docs: smoke notes for strict 320 mode"
```

---

## Task 7: PR + release

- [ ] **Step 1: Push the branch**

```bash
git push -u origin feat/strict-320-mode
```

- [ ] **Step 2: Open the PR**

```bash
gh pr create --base main --head feat/strict-320-mode \
  --title "feat: strict 320 kbps mode" \
  --body "$(cat <<'EOF'
## Summary
- New Settings toggle 'Modo strict 320 kbps' (default ON in fresh installs)
- When on + connected to Premium: recoverable Spotify-direct failures (track not in catalog, region-locked, premium-required, transient librespot errors) now skip the track instead of falling back to YouTube
- Done summary surfaces a callout listing skipped tracks with a 'Copiar lista' button so a DJ can re-acquire them elsewhere
- Strict skips are NOT registered in the library, so re-runs retry the track
- No new modules, no new sidecars, no new CI secrets

## Spec
\`docs/superpowers/specs/2026-06-07-strict-320-mode-design.md\`

## Plan
\`docs/superpowers/plans/2026-06-07-strict-320-mode-implementation.md\`

## Behavior change for existing installs
Strict mode defaults to ON for both fresh installs and existing installs upgrading. Existing users who prefer the prior fallback behavior can disable it in Settings → Qualidade. Called out in v0.2.1 release notes.

## Test plan
- [x] Vitest green locally (new cases: config defaults, pipeline strict-on success, strict-on skip, strict-off regression)
- [ ] CI green
- [x] Manual smoke per Task 6 of the implementation plan
- [ ] Post-merge: tag \`v0.2.1\` to trigger Build installers workflow
EOF
)"
```

- [ ] **Step 3: After CI passes, merge and tag**

```bash
gh pr merge --merge --delete-branch
git checkout main
git pull
git tag -a v0.2.1 -m "v0.2.1 — strict 320 kbps mode (default on)"
git push origin v0.2.1
```

The tag triggers the existing Build installers + Publish GitHub Release workflow, producing `.dmg` and `.exe` artifacts that ship strict mode.

---

## Strict 320 kbps complete

What you have at this point:

- A per-install toggle that flips Spotify-tab fallback policy.
- Fresh installs (and existing installs after upgrade) default to strict on.
- Recoverable Spotify-direct failures surface as `quality_floor_not_met` skips with a copyable list in the Done summary.
- Strict-skipped tracks are not registered in the library — they retry on the next run.
- Five Vitest cases covering all four cells of the strict × failure-mode matrix.
- v0.2.1 release published with the new behavior.

What is intentionally **not** in this plan:

- A numeric quality floor dropdown (192 / 256 / 320). Binary on/off only.
- Per-playlist override above the preview screen.
- Visual "strict on" indicator next to the Spotify connect pill (deferred until friction emerges).
- An "audit history" view of past download quality (the ID3 `COMM` provenance already records actual source per file).
- Telemetry. This app does not phone home.
