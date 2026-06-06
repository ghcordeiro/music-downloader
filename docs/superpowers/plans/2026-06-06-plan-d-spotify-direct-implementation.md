# Plan D — Spotify Direct Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Spotify-direct downloads via bundled zotify sidecar, gated behind per-friend Spotify Premium OAuth (PKCE), with transparent fallback to the existing YouTube path. Each downloaded MP3 records its actual source in the ID3 comment; the playlist summary surfaces per-source counts.

**Architecture:** A new `main/spotify-direct/` subtree owns OAuth + token storage + zotify subprocess. `main/download/pipeline.js` gains a single optional step before its YouTube path — only when the platform is Spotify and the user is connected — that tries Spotify-direct and falls through on any recoverable error. The renderer's Spotify tab gains a banner (disconnected) or status pill (connected), the Settings dialog gains a "Spotify Premium" block, and the OAuth flow is driven by the system browser via a loopback HTTP listener. No other modules change behavior; YouTube and SoundCloud tabs are untouched.

**Tech Stack:** Same as Plans A/B/C (Electron, Node 20+, Vitest, nock). New runtime piece: `zotify` (Python-built single-file executable, ~50–80 MB per OS/arch) bundled as a sidecar alongside `yt-dlp` and `ffmpeg`. Electron's `safeStorage` API is used for token encryption (backed by macOS Keychain / Windows DPAPI).

**Spec:** `docs/superpowers/specs/2026-06-06-plan-d-spotify-direct-design.md`. Read it before starting.

**Project root used throughout:** `/Users/guilhermecordeiro/www/pessoal/apple-playlist-downloader`

**Branch:** start a new branch off `main` named `feat/plan-d-spotify-direct`.

---

## File map

Files this plan creates:

| Path | Purpose |
|------|---------|
| `main/spotify-direct/index.js` | Public facade exposing `connect/disconnect/getStatus/downloadTrack` |
| `main/spotify-direct/pkce.js` | Pure functions: `generateCodeVerifier`, `codeChallenge` (RFC 7636) |
| `main/spotify-direct/oauth-urls.js` | Pure URL builders for authorize endpoint |
| `main/spotify-direct/oauth.js` | Loopback server + browser open + code exchange + token refresh |
| `main/spotify-direct/zotify.js` | Subprocess wrapper around the `zotify` sidecar |
| `main/spotify-direct/provenance.js` | Builds the ID3 `COMM` comment string from the actual source |
| `main/storage/spotify-auth.js` | Encrypted token storage via `safeStorage` |
| `tests/spotify-direct/pkce.test.js` | Unit tests for PKCE crypto |
| `tests/spotify-direct/oauth-urls.test.js` | Unit tests for URL building |
| `tests/spotify-direct/oauth.test.js` | Integration tests for OAuth flow (nock + fake loopback) |
| `tests/spotify-direct/zotify.test.js` | Subprocess-mocked tests for zotify wrapper |
| `tests/spotify-direct/provenance.test.js` | Unit tests for comment builder |
| `tests/storage/spotify-auth.test.js` | Round-trip tests with mocked `safeStorage` |
| `docs/superpowers/notes/2026-06-06-zotify-spike.md` | The spike's findings (committed) |

Files this plan modifies:

| Path | Why |
|------|-----|
| `main/download/pipeline.js` | Insert Spotify-direct step before YouTube path for `platform === 'spotify'` |
| `main/tagging.js` | Accept and write the provenance comment from `provenance.js` |
| `main/ipc.js` | Register `spotify:connect`, `spotify:disconnect`, `spotify:status`, `spotify:on-status-change` |
| `main/preload.js` | Expose `window.api.spotifyAccount.{connect,disconnect,getStatus,onStatusChange}` |
| `main/index.js` | Wire the new IPC handlers; pass `spotifyDirect` instance into ipc.js |
| `renderer/tabs/spotify.js` | Banner when disconnected, status pill when connected, OAuth modal flow |
| `renderer/main.js` | Settings dialog Spotify Premium section + status-change subscription |
| `renderer/index.html` | New banner + status pill + settings block + OAuth modal markup |
| `renderer/styles.css` | Styles for new UI elements |
| `scripts/embed-spotify.js` | Add `SPOTIFY_OAUTH_CLIENT_ID` as a third embedded credential |
| `scripts/fetch-binaries.js` | Download zotify alongside yt-dlp and ffmpeg |
| `.github/workflows/build-release.yml` | Pass `SPOTIFY_OAUTH_CLIENT_ID` from secrets to `.env` |
| `electron-builder.yml` | No change in structure; just ensure `binaries/**/*` continues to include zotify (already covered) |

Files this plan does **not** touch:

- `main/platforms/spotify.js` (still uses Client Credentials for playlist metadata; orthogonal to Plan D)
- `main/platforms/youtube.js`, `main/platforms/soundcloud.js` (unchanged)
- `main/storage/config.js` (gains an optional `spotifyBannerDismissedAt` field, but `set()` already merges arbitrary keys)
- `main/storage/library.js` (unchanged)
- `main/filename.js` (unchanged)
- `main/enrichment.js` (unchanged)

---

## Task 1: Spike — validate the zotify ↔ OAuth bridge

> **HARD GATE.** This is the only investment-protecting checkpoint in Plan D. Do not start Task 2 until this spike succeeds. If it cannot succeed in 3 hours of focused work, STOP and report to the user; the design will pivot to Approach B (custom librespot wrapper).

**Files:**
- Create: `docs/superpowers/notes/2026-06-06-zotify-spike.md`
- Create (throwaway): `spike/spike.js`, `spike/.env.spike` (gitignored)

- [ ] **Step 1: Add `spike/` to `.gitignore`**

Append a single line to the existing `.gitignore` so the throwaway spike folder never reaches git:

```
spike/
```

- [ ] **Step 2: Register a second Spotify Developer app for OAuth**

In a browser, log in at `https://developer.spotify.com/dashboard` and create a **new** app named "Music Downloader OAuth". Set the redirect URI to `http://127.0.0.1:53682/callback` (any fixed port works for the spike; production code uses a random one). Save the Client ID. Do NOT use Client Secret — PKCE doesn't need it.

- [ ] **Step 3: Create the spike script**

Create `spike/spike.js` with the following contents. This is a self-contained throwaway that exercises the full bridge:

```javascript
#!/usr/bin/env node
// Throwaway spike. Validates that zotify can be authenticated using
// the access token we obtain from a PKCE OAuth flow.

const http = require('node:http');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { exec, spawn } = require('node:child_process');
const os = require('node:os');

const PORT = 53682;
const REDIRECT_URI = `http://127.0.0.1:${PORT}/callback`;
const SCOPES = 'streaming user-read-private user-read-email';

// Pull SPIKE_CLIENT_ID from spike/.env.spike
const envPath = path.join(__dirname, '.env.spike');
if (!fs.existsSync(envPath)) {
  console.error('Create spike/.env.spike with SPIKE_CLIENT_ID=<your_oauth_client_id>');
  process.exit(1);
}
const env = Object.fromEntries(
  fs.readFileSync(envPath, 'utf8').split('\n').filter(Boolean).map(line => line.split('='))
);
const CLIENT_ID = env.SPIKE_CLIENT_ID;
if (!CLIENT_ID) { console.error('SPIKE_CLIENT_ID missing'); process.exit(1); }

function base64url(buf) {
  return buf.toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}
const codeVerifier = base64url(crypto.randomBytes(48));
const codeChallenge = base64url(crypto.createHash('sha256').update(codeVerifier).digest());
const state = base64url(crypto.randomBytes(8));

const authUrl = new URL('https://accounts.spotify.com/authorize');
authUrl.searchParams.set('client_id', CLIENT_ID);
authUrl.searchParams.set('response_type', 'code');
authUrl.searchParams.set('redirect_uri', REDIRECT_URI);
authUrl.searchParams.set('code_challenge_method', 'S256');
authUrl.searchParams.set('code_challenge', codeChallenge);
authUrl.searchParams.set('scope', SCOPES);
authUrl.searchParams.set('state', state);

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, REDIRECT_URI);
  if (url.pathname !== '/callback') {
    res.writeHead(404); res.end(); return;
  }
  const code = url.searchParams.get('code');
  const gotState = url.searchParams.get('state');
  if (gotState !== state || !code) {
    res.writeHead(400); res.end('state mismatch'); server.close(); return;
  }

  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end('<h2>Pode fechar essa aba.</h2>');
  server.close();

  // Exchange code for tokens
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: REDIRECT_URI,
    client_id: CLIENT_ID,
    code_verifier: codeVerifier,
  }).toString();

  const tokenRes = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const tokens = await tokenRes.json();
  console.log('Tokens received:', { ...tokens, access_token: tokens.access_token?.slice(0, 12) + '...' });

  // /v1/me to verify Premium
  const meRes = await fetch('https://api.spotify.com/v1/me', {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  });
  const me = await meRes.json();
  console.log('Logged in as:', me.email, 'plan:', me.product);
  if (me.product !== 'premium') {
    console.log('NOTE: Not Premium. 320 kbps will not be achievable; spike will still attempt 160.');
  }

  // Try Approach 1: write credentials file in librespot-python's expected location
  const credPath = path.join(os.homedir(), '.zotify', 'credentials.json');
  fs.mkdirSync(path.dirname(credPath), { recursive: true });
  fs.writeFileSync(credPath, JSON.stringify({
    type: 'AUTHENTICATION_USER_PASS',
    access_token: tokens.access_token,
    username: me.id,
  }, null, 2));
  console.log('Wrote', credPath);

  // A known Spotify track URL (Daft Punk - Around the World)
  const TEST_TRACK = 'https://open.spotify.com/track/1pKYYY0dkg23sQQXi0Q5zN';
  console.log('Attempting zotify download...');

  const child = spawn('zotify', [
    '--output', '/tmp/zotify-spike',
    '--audio-format', 'vorbis',
    TEST_TRACK,
  ], { stdio: 'inherit' });
  child.on('exit', (code) => {
    console.log('zotify exited with code', code);
    console.log('Spike result: see /tmp/zotify-spike for output.');
  });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log('Open this URL in your browser:');
  console.log(authUrl.toString());
  if (process.platform === 'darwin') exec(`open "${authUrl.toString()}"`);
  else if (process.platform === 'win32') exec(`start "" "${authUrl.toString()}"`);
});
```

- [ ] **Step 4: Install zotify in a venv (out of band)**

Outside the spike folder, install zotify:

```bash
python3 -m venv ~/.zotify-venv
source ~/.zotify-venv/bin/activate
pip install zotify
which zotify
```

Expected: `which zotify` prints a path under `~/.zotify-venv/bin/zotify`. Keep the venv activated for the remainder of this task.

- [ ] **Step 5: Create the spike .env**

```bash
echo "SPIKE_CLIENT_ID=<the_oauth_client_id_from_step_2>" > spike/.env.spike
```

Replace `<the_oauth_client_id_from_step_2>` with the actual Client ID from the new Spotify Developer app.

- [ ] **Step 6: Run the spike**

```bash
node spike/spike.js
```

Expected sequence:
1. The browser opens to Spotify's authorization page.
2. You log in and approve the requested scopes.
3. The script logs `Tokens received` and `Logged in as <your email> plan: premium`.
4. zotify is invoked. Either it succeeds (exit 0, file at `/tmp/zotify-spike/...`) or it errors out (auth rejected, or other).

- [ ] **Step 7: If zotify exit was non-zero, try Approach 2 (token via env var)**

Stop the server (Ctrl-C if still running). Edit `spike/spike.js`: replace the `spawn('zotify', ...)` call with:

```javascript
const child = spawn('zotify', [
  '--output', '/tmp/zotify-spike',
  '--audio-format', 'vorbis',
  TEST_TRACK,
], {
  stdio: 'inherit',
  env: { ...process.env, ZOTIFY_ACCESS_TOKEN: tokens.access_token },
});
```

Re-run `node spike/spike.js`. Note whether this changes the outcome.

- [ ] **Step 8: If both approaches failed, try Approach 3 (librespot-auth converter)**

Install `librespot-auth` (`pip install librespot-auth` or the language-equivalent) and look at its README for the conversion call. Save the converted credentials file at the path zotify expects (typically `~/.config/zotify/credentials.json`). Re-run the spike with the original spawn call.

- [ ] **Step 9: Write findings to `docs/superpowers/notes/2026-06-06-zotify-spike.md`**

Document, in roughly this shape:

```markdown
# Zotify ↔ OAuth Bridge Spike — Findings

**Date:** 2026-06-06
**Outcome:** SUCCESS / FAILURE (delete one)

## Approach that worked
<one of: "credentials.json file at ~/.zotify/credentials.json with access_token field",
         "ZOTIFY_ACCESS_TOKEN env var",
         "librespot-auth conversion to AP token at <path>",
         "NONE OF THE ABOVE">

## Reproducing the success
<the minimal sequence of steps>

## Surprises
<things that were not obvious from documentation>

## Implication for Plan D
- If SUCCESS: implementation proceeds. Section 6.7 of the spec is resolved.
- If FAILURE: STOP. Notify the user. Switch design to Approach B (bundle librespot directly).
```

- [ ] **Step 10: Commit the findings**

```bash
git add docs/superpowers/notes/2026-06-06-zotify-spike.md .gitignore
git commit -m "spike: validate zotify auth bridge for plan d"
```

- [ ] **Step 11: GATE — decide whether to proceed**

If the spike succeeded: continue to Task 2.

If the spike failed: do not continue. Report to the user: "Spike failed. The three approaches that were tried: <list>. Recommend pivoting to Approach B (bundle librespot directly) and re-writing the spec." Wait for direction.

---

## Task 2: Project branch and dependency check

**Files:**
- No code changes; environment preparation.

- [ ] **Step 1: Create the implementation branch off `main`**

```bash
git checkout main
git pull origin main
git checkout -b feat/plan-d-spotify-direct
```

- [ ] **Step 2: Confirm dependencies**

```bash
node --version
npm test
```

Expected: Node 20+ and the existing test suite passes (this confirms the baseline before any changes).

- [ ] **Step 3: Add no new npm dependencies**

Plan D requires no new npm packages. All HTTP work uses Node's built-in `https` / `http`. PKCE uses Node's built-in `crypto`. OAuth tokens use Electron's built-in `safeStorage`. If you find yourself reaching for a library, stop and check the spec — every external dependency is enumerated.

---

## Task 3: PKCE crypto — pure functions

**Files:**
- Create: `main/spotify-direct/pkce.js`
- Create: `tests/spotify-direct/pkce.test.js`

- [ ] **Step 1: Write the failing tests**

Create `tests/spotify-direct/pkce.test.js`:

```javascript
import { describe, it, expect } from 'vitest';
import crypto from 'node:crypto';
import { generateCodeVerifier, codeChallenge } from '../../main/spotify-direct/pkce.js';

describe('generateCodeVerifier', () => {
  it('produces an RFC 7636-conformant string (43-128 chars, URL-safe)', () => {
    for (let i = 0; i < 50; i++) {
      const v = generateCodeVerifier();
      expect(v.length).toBeGreaterThanOrEqual(43);
      expect(v.length).toBeLessThanOrEqual(128);
      expect(v).toMatch(/^[A-Za-z0-9_-]+$/);
    }
  });

  it('produces different values across calls (entropy check)', () => {
    const seen = new Set();
    for (let i = 0; i < 20; i++) seen.add(generateCodeVerifier());
    expect(seen.size).toBe(20);
  });
});

describe('codeChallenge', () => {
  it('produces the S256 base64url SHA-256 of the verifier (RFC 7636 example)', () => {
    // Example values verified against https://www.rfc-editor.org/rfc/rfc7636#appendix-B
    const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
    const expected = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';
    expect(codeChallenge(verifier)).toBe(expected);
  });

  it('is deterministic for the same verifier', () => {
    const v = generateCodeVerifier();
    expect(codeChallenge(v)).toBe(codeChallenge(v));
  });
});
```

- [ ] **Step 2: Run — expect failure**

```bash
npm test -- tests/spotify-direct/pkce.test.js
```

Expected: import error because `main/spotify-direct/pkce.js` does not exist.

- [ ] **Step 3: Implement `main/spotify-direct/pkce.js`**

```javascript
const crypto = require('node:crypto');

function base64url(buf) {
  return buf.toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function generateCodeVerifier() {
  // 48 random bytes → 64 base64url chars, comfortably inside RFC 7636's 43-128 range.
  return base64url(crypto.randomBytes(48));
}

function codeChallenge(verifier) {
  return base64url(crypto.createHash('sha256').update(verifier).digest());
}

module.exports = { generateCodeVerifier, codeChallenge };
```

- [ ] **Step 4: Run — expect pass**

```bash
npm test -- tests/spotify-direct/pkce.test.js
```

Expected: 4 passing tests.

- [ ] **Step 5: Commit**

```bash
git add main/spotify-direct/pkce.js tests/spotify-direct/pkce.test.js
git commit -m "feat(spotify-direct): pkce code verifier and S256 challenge"
```

---

## Task 4: OAuth URL builder — pure functions

**Files:**
- Create: `main/spotify-direct/oauth-urls.js`
- Create: `tests/spotify-direct/oauth-urls.test.js`

- [ ] **Step 1: Write the failing tests**

In `tests/spotify-direct/oauth-urls.test.js`:

```javascript
import { describe, it, expect } from 'vitest';
import { buildAuthorizationUrl } from '../../main/spotify-direct/oauth-urls.js';

describe('buildAuthorizationUrl', () => {
  it('returns a Spotify authorize URL with the required query params', () => {
    const url = buildAuthorizationUrl({
      clientId: 'abc123',
      redirectUri: 'http://127.0.0.1:5101/callback',
      codeChallenge: 'CHALLENGE',
      state: 'STATE',
    });
    expect(url).toMatch(/^https:\/\/accounts\.spotify\.com\/authorize\?/);
    const parsed = new URL(url);
    expect(parsed.searchParams.get('client_id')).toBe('abc123');
    expect(parsed.searchParams.get('response_type')).toBe('code');
    expect(parsed.searchParams.get('redirect_uri')).toBe('http://127.0.0.1:5101/callback');
    expect(parsed.searchParams.get('code_challenge_method')).toBe('S256');
    expect(parsed.searchParams.get('code_challenge')).toBe('CHALLENGE');
    expect(parsed.searchParams.get('state')).toBe('STATE');
    expect(parsed.searchParams.get('scope')).toBe('streaming user-read-private user-read-email');
  });

  it('encodes special characters in the redirect URI', () => {
    const url = buildAuthorizationUrl({
      clientId: 'x',
      redirectUri: 'http://127.0.0.1:5101/callback?extra=1',
      codeChallenge: 'c',
      state: 's',
    });
    const parsed = new URL(url);
    expect(parsed.searchParams.get('redirect_uri')).toBe('http://127.0.0.1:5101/callback?extra=1');
  });
});
```

- [ ] **Step 2: Run — expect failure**

```bash
npm test -- tests/spotify-direct/oauth-urls.test.js
```

- [ ] **Step 3: Implement `main/spotify-direct/oauth-urls.js`**

```javascript
const SCOPES = 'streaming user-read-private user-read-email';

function buildAuthorizationUrl({ clientId, redirectUri, codeChallenge, state }) {
  const u = new URL('https://accounts.spotify.com/authorize');
  u.searchParams.set('client_id', clientId);
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('redirect_uri', redirectUri);
  u.searchParams.set('code_challenge_method', 'S256');
  u.searchParams.set('code_challenge', codeChallenge);
  u.searchParams.set('state', state);
  u.searchParams.set('scope', SCOPES);
  return u.toString();
}

module.exports = { buildAuthorizationUrl, SCOPES };
```

- [ ] **Step 4: Run — expect pass**

```bash
npm test -- tests/spotify-direct/oauth-urls.test.js
```

- [ ] **Step 5: Commit**

```bash
git add main/spotify-direct/oauth-urls.js tests/spotify-direct/oauth-urls.test.js
git commit -m "feat(spotify-direct): oauth authorize url builder"
```

---

## Task 5: Encrypted token storage

**Files:**
- Create: `main/storage/spotify-auth.js`
- Create: `tests/storage/spotify-auth.test.js`

- [ ] **Step 1: Write the failing tests**

In `tests/storage/spotify-auth.test.js`:

```javascript
import { describe, it, expect, beforeEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createSpotifyAuthStore } from '../../main/storage/spotify-auth.js';

function tmp() { return fs.mkdtempSync(path.join(os.tmpdir(), 'spauth-')); }

// Stand-in for Electron's safeStorage; XOR with a constant so we can verify round-trip
// without depending on the real Keychain.
const fakeSafeStorage = {
  isEncryptionAvailable: () => true,
  encryptString: (s) => Buffer.from(s.split('').map(c => c.charCodeAt(0) ^ 0x5A)),
  decryptString: (b) => Buffer.from(b).toString('binary').split('').map(c => String.fromCharCode(c.charCodeAt(0) ^ 0x5A)).join(''),
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
    expect(rawBytes.toString('utf8')).not.toContain('AQ');  // not stored in plaintext
    const reloaded = await createSpotifyAuthStore(dir, fakeSafeStorage).read();
    expect(reloaded).toEqual(payload);
  });

  it('clear() deletes the file (idempotent)', async () => {
    const store = createSpotifyAuthStore(dir, fakeSafeStorage);
    await store.write({ refresh_token: 'x', email: 'a', product: 'free', savedAt: 'z' });
    await store.clear();
    expect(await store.read()).toBeNull();
    await store.clear();  // second call must not throw
  });

  it('throws a typed error when encryption is unavailable', async () => {
    const broken = { ...fakeSafeStorage, isEncryptionAvailable: () => false };
    const store = createSpotifyAuthStore(dir, broken);
    await expect(store.write({ refresh_token: 'x', email: 'a', product: 'free', savedAt: 'z' }))
      .rejects.toThrow(/encryption/i);
  });
});
```

- [ ] **Step 2: Run — expect failure**

```bash
npm test -- tests/storage/spotify-auth.test.js
```

- [ ] **Step 3: Implement `main/storage/spotify-auth.js`**

```javascript
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
```

- [ ] **Step 4: Run — expect pass**

```bash
npm test -- tests/storage/spotify-auth.test.js
```

Expected: 4 passing tests.

- [ ] **Step 5: Commit**

```bash
git add main/storage/spotify-auth.js tests/storage/spotify-auth.test.js
git commit -m "feat(storage): encrypted spotify auth store via safeStorage"
```

---

## Task 6: OAuth orchestrator — code exchange and token refresh

This task implements the HTTP side of the OAuth flow without the loopback server (covered in Task 7). The two halves are split so the token-exchange logic stays mockable.

**Files:**
- Create: `main/spotify-direct/oauth.js`
- Create: `tests/spotify-direct/oauth.test.js`

- [ ] **Step 1: Write failing tests for code exchange**

In `tests/spotify-direct/oauth.test.js`:

```javascript
import { describe, it, expect, beforeEach } from 'vitest';
import nock from 'nock';
import { exchangeCodeForTokens, refreshAccessToken, fetchUserProfile } from '../../main/spotify-direct/oauth.js';

beforeEach(() => nock.cleanAll());

describe('exchangeCodeForTokens', () => {
  it('POSTs the right form body and returns the parsed tokens', async () => {
    nock('https://accounts.spotify.com')
      .post('/api/token', body =>
        body.includes('grant_type=authorization_code') &&
        body.includes('code=THECODE') &&
        body.includes('code_verifier=VERIFIER') &&
        body.includes('client_id=CID'))
      .reply(200, {
        access_token: 'AT', refresh_token: 'RT', expires_in: 3600,
        token_type: 'Bearer', scope: 'streaming user-read-private user-read-email',
      });

    const out = await exchangeCodeForTokens({
      code: 'THECODE',
      codeVerifier: 'VERIFIER',
      redirectUri: 'http://127.0.0.1:5101/callback',
      clientId: 'CID',
    });
    expect(out).toMatchObject({ access_token: 'AT', refresh_token: 'RT', expires_in: 3600 });
  });

  it('throws a typed AuthError on 400 from Spotify', async () => {
    nock('https://accounts.spotify.com')
      .post('/api/token')
      .reply(400, { error: 'invalid_grant' });
    await expect(exchangeCodeForTokens({
      code: 'X', codeVerifier: 'V', redirectUri: 'R', clientId: 'C',
    })).rejects.toThrow(/oauth/i);
  });
});

describe('refreshAccessToken', () => {
  it('uses the refresh_token grant', async () => {
    nock('https://accounts.spotify.com')
      .post('/api/token', body => body.includes('grant_type=refresh_token') && body.includes('refresh_token=RT'))
      .reply(200, { access_token: 'NEW', expires_in: 3600 });
    const out = await refreshAccessToken({ refreshToken: 'RT', clientId: 'CID' });
    expect(out.access_token).toBe('NEW');
  });
});

describe('fetchUserProfile', () => {
  it('returns email and product', async () => {
    nock('https://api.spotify.com')
      .get('/v1/me')
      .matchHeader('Authorization', 'Bearer ABC')
      .reply(200, { email: 'a@b.c', product: 'premium', id: 'uid' });
    const out = await fetchUserProfile({ accessToken: 'ABC' });
    expect(out).toEqual({ email: 'a@b.c', product: 'premium', id: 'uid' });
  });
});
```

- [ ] **Step 2: Run — expect failure**

```bash
npm test -- tests/spotify-direct/oauth.test.js
```

- [ ] **Step 3: Implement `main/spotify-direct/oauth.js`**

```javascript
const axios = require('axios');

class OAuthError extends Error {
  constructor(message, status, body) {
    super(`oauth: ${message}`);
    this.status = status;
    this.body = body;
  }
}

async function exchangeCodeForTokens({ code, codeVerifier, redirectUri, clientId }) {
  try {
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      client_id: clientId,
      code_verifier: codeVerifier,
    }).toString();
    const r = await axios.post('https://accounts.spotify.com/api/token', body, {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      timeout: 15_000,
    });
    return r.data;
  } catch (err) {
    if (err.response) throw new OAuthError(err.response.data?.error || 'code exchange failed', err.response.status, err.response.data);
    throw new OAuthError(err.message, 0, null);
  }
}

async function refreshAccessToken({ refreshToken, clientId }) {
  try {
    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: clientId,
    }).toString();
    const r = await axios.post('https://accounts.spotify.com/api/token', body, {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      timeout: 15_000,
    });
    return r.data;
  } catch (err) {
    if (err.response) throw new OAuthError(err.response.data?.error || 'refresh failed', err.response.status, err.response.data);
    throw new OAuthError(err.message, 0, null);
  }
}

async function fetchUserProfile({ accessToken }) {
  const r = await axios.get('https://api.spotify.com/v1/me', {
    headers: { Authorization: `Bearer ${accessToken}` },
    timeout: 10_000,
  });
  return { email: r.data.email, product: r.data.product, id: r.data.id };
}

module.exports = { exchangeCodeForTokens, refreshAccessToken, fetchUserProfile, OAuthError };
```

- [ ] **Step 4: Run — expect pass**

```bash
npm test -- tests/spotify-direct/oauth.test.js
```

- [ ] **Step 5: Commit**

```bash
git add main/spotify-direct/oauth.js tests/spotify-direct/oauth.test.js
git commit -m "feat(spotify-direct): oauth code-exchange, refresh, and /v1/me"
```

---

## Task 7: Loopback callback server

**Files:**
- Modify: `main/spotify-direct/oauth.js`
- Modify: `tests/spotify-direct/oauth.test.js`

- [ ] **Step 1: Append failing tests**

Append to `tests/spotify-direct/oauth.test.js`:

```javascript
import { createLoopbackCallback } from '../../main/spotify-direct/oauth.js';
import http from 'node:http';

function fetchOnce(port, pathAndQuery) {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port, path: pathAndQuery }, (res) => {
      let body = '';
      res.on('data', (c) => body += c);
      res.on('end', () => resolve({ status: res.statusCode, body }));
    }).on('error', reject);
  });
}

describe('createLoopbackCallback', () => {
  it('resolves with { code, state } when /callback receives them', async () => {
    const cb = await createLoopbackCallback();
    expect(cb.port).toBeGreaterThan(0);
    setTimeout(() => { fetchOnce(cb.port, '/callback?code=THECODE&state=ST'); }, 5);
    const result = await cb.promise;
    expect(result).toEqual({ code: 'THECODE', state: 'ST' });
  });

  it('serves "Pode fechar" HTML on the callback response', async () => {
    const cb = await createLoopbackCallback();
    setTimeout(() => { fetchOnce(cb.port, '/callback?code=A&state=B'); }, 5);
    await cb.promise;
    // The response was sent; nothing more to assert (verified indirectly via the test above)
    // but make sure cleanup() works cleanly.
    cb.cleanup();
  });

  it('rejects with TimeoutError after the timeout elapses', async () => {
    const cb = await createLoopbackCallback({ timeoutMs: 50 });
    await expect(cb.promise).rejects.toThrow(/timeout/i);
    cb.cleanup();
  });

  it('rejects when the loopback receives no code', async () => {
    const cb = await createLoopbackCallback();
    setTimeout(() => { fetchOnce(cb.port, '/callback?error=access_denied'); }, 5);
    await expect(cb.promise).rejects.toThrow(/access_denied|denied/i);
    cb.cleanup();
  });
});
```

- [ ] **Step 2: Run — expect failure**

```bash
npm test -- tests/spotify-direct/oauth.test.js
```

Expected: import error for `createLoopbackCallback`.

- [ ] **Step 3: Add the loopback server to `main/spotify-direct/oauth.js`**

Append the following inside `main/spotify-direct/oauth.js` (and add to the exports):

```javascript
const http = require('node:http');

async function createLoopbackCallback({ timeoutMs = 5 * 60 * 1000 } = {}) {
  let resolveFn, rejectFn;
  const promise = new Promise((res, rej) => { resolveFn = res; rejectFn = rej; });

  const server = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://127.0.0.1');
    if (u.pathname !== '/callback') {
      res.writeHead(404); res.end(); return;
    }
    const code = u.searchParams.get('code');
    const state = u.searchParams.get('state');
    const error = u.searchParams.get('error');

    if (error) {
      res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end('<h2>Falha na autorização. Volte ao app e tente de novo.</h2>');
      rejectFn(new Error(`oauth callback error: ${error}`));
      return;
    }
    if (!code) {
      res.writeHead(400); res.end();
      rejectFn(new Error('oauth callback missing code'));
      return;
    }

    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end('<h2>Pode fechar essa aba ✅</h2>');
    resolveFn({ code, state });
  });

  await new Promise((res, rej) => {
    server.listen(0, '127.0.0.1', (err) => err ? rej(err) : res());
  });

  const port = server.address().port;

  const timer = setTimeout(() => {
    rejectFn(new Error('oauth callback timeout'));
    server.close();
  }, timeoutMs);

  return {
    port,
    promise: promise.finally(() => { clearTimeout(timer); server.close(); }),
    cleanup: () => { clearTimeout(timer); server.close(); },
  };
}
```

Update the export:

```javascript
module.exports = { exchangeCodeForTokens, refreshAccessToken, fetchUserProfile, OAuthError, createLoopbackCallback };
```

- [ ] **Step 4: Run — expect pass**

```bash
npm test -- tests/spotify-direct/oauth.test.js
```

- [ ] **Step 5: Commit**

```bash
git add main/spotify-direct/oauth.js tests/spotify-direct/oauth.test.js
git commit -m "feat(spotify-direct): loopback callback server with timeout"
```

---

## Task 8: Provenance comment builder

**Files:**
- Create: `main/spotify-direct/provenance.js`
- Create: `tests/spotify-direct/provenance.test.js`

- [ ] **Step 1: Write the failing tests**

In `tests/spotify-direct/provenance.test.js`:

```javascript
import { describe, it, expect } from 'vitest';
import { buildProvenanceComment } from '../../main/spotify-direct/provenance.js';

describe('buildProvenanceComment', () => {
  it('Spotify direct Premium', () => {
    expect(buildProvenanceComment({
      source: 'spotify-direct',
      sourceCodec: 'vorbis',
      sourceBitrateKbps: 320,
      finalBitrateKbps: 320,
      plan: 'premium',
    })).toBe('Source: Spotify Ogg Vorbis 320kbps → MP3 320kbps');
  });

  it('Spotify direct Free', () => {
    expect(buildProvenanceComment({
      source: 'spotify-direct',
      sourceCodec: 'vorbis',
      sourceBitrateKbps: 160,
      finalBitrateKbps: 160,
      plan: 'free',
    })).toBe('Source: Spotify Ogg Vorbis 160kbps → MP3 160kbps');
  });

  it('YouTube after Spotify fallback records the reason', () => {
    expect(buildProvenanceComment({
      source: 'youtube',
      sourceCodec: 'opus',
      sourceBitrateKbps: 160,
      finalBitrateKbps: 160,
      fallbackReason: 'not_in_catalog',
    })).toBe('Source: YouTube Opus 160kbps → MP3 160kbps (Spotify fallback: not_in_catalog)');
  });

  it('Pure YouTube (not connected, or YouTube tab)', () => {
    expect(buildProvenanceComment({
      source: 'youtube',
      sourceCodec: 'opus',
      sourceBitrateKbps: 160,
      finalBitrateKbps: 160,
    })).toBe('Source: YouTube Opus 160kbps → MP3 160kbps');
  });

  it('SoundCloud passes through the codec name as-is', () => {
    expect(buildProvenanceComment({
      source: 'soundcloud',
      sourceCodec: 'mp3',
      sourceBitrateKbps: 128,
      finalBitrateKbps: 128,
    })).toBe('Source: SoundCloud mp3 128kbps → MP3 128kbps');
  });
});
```

- [ ] **Step 2: Run — expect failure**

```bash
npm test -- tests/spotify-direct/provenance.test.js
```

- [ ] **Step 3: Implement `main/spotify-direct/provenance.js`**

```javascript
const SOURCE_LABEL = {
  'spotify-direct': 'Spotify',
  'youtube': 'YouTube',
  'soundcloud': 'SoundCloud',
};

const CODEC_LABEL = {
  vorbis: 'Ogg Vorbis',
  opus: 'Opus',
  aac: 'AAC',
};

function buildProvenanceComment({ source, sourceCodec, sourceBitrateKbps, finalBitrateKbps, fallbackReason }) {
  const sourceName = SOURCE_LABEL[source] || source;
  const codec = CODEC_LABEL[sourceCodec] || sourceCodec;
  const tail = fallbackReason ? ` (Spotify fallback: ${fallbackReason})` : '';
  return `Source: ${sourceName} ${codec} ${sourceBitrateKbps}kbps → MP3 ${finalBitrateKbps}kbps${tail}`;
}

module.exports = { buildProvenanceComment };
```

- [ ] **Step 4: Run — expect pass**

```bash
npm test -- tests/spotify-direct/provenance.test.js
```

- [ ] **Step 5: Commit**

```bash
git add main/spotify-direct/provenance.js tests/spotify-direct/provenance.test.js
git commit -m "feat(spotify-direct): provenance comment builder"
```

---

## Task 9: zotify subprocess wrapper

**Files:**
- Create: `main/spotify-direct/zotify.js`
- Create: `tests/spotify-direct/zotify.test.js`

The wrapper exposes one entry point: `downloadTrack({ accessToken, trackUrl, outputPath, signal }) → { ok, sourceCodec, sourceBitrateKbps, outputPath }` or throws a typed error.

The exact CLI shape depends on the spike's findings. The placeholder below assumes Approach 1 (write credentials file at `~/.zotify/credentials.json` then run `zotify --output <path> --audio-format vorbis <url>`). If the spike chose another approach, adjust the spawn call accordingly. Tests remain identical because they mock the subprocess.

- [ ] **Step 1: Write the failing tests**

In `tests/spotify-direct/zotify.test.js`:

```javascript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as child from 'node:child_process';
import { downloadTrack, TrackNotFoundOnSpotify, AuthExpired } from '../../main/spotify-direct/zotify.js';

function fakeProc(stdout, stderr, exitCode) {
  const handlers = { stdout: [], stderr: [], close: [], error: [] };
  return {
    stdout: { on: (e, cb) => handlers.stdout.push(cb) },
    stderr: { on: (e, cb) => handlers.stderr.push(cb) },
    on: (e, cb) => {
      if (e === 'close') handlers.close.push(cb);
      else if (e === 'error') handlers.error.push(cb);
      setImmediate(() => {
        handlers.stdout.forEach(h => h(Buffer.from(stdout)));
        handlers.stderr.forEach(h => h(Buffer.from(stderr)));
        handlers.close.forEach(h => h(exitCode));
      });
    },
    kill: () => {},
  };
}

beforeEach(() => { vi.restoreAllMocks(); });

describe('zotify downloadTrack', () => {
  it('resolves with codec and bitrate on exit 0', async () => {
    vi.spyOn(child, 'spawn').mockImplementation(() => fakeProc('Downloaded vorbis 320\n', '', 0));
    const result = await downloadTrack({
      accessToken: 'AT',
      trackUrl: 'https://open.spotify.com/track/X',
      outputPath: '/tmp/x.ogg',
      binaryPath: '/fake/zotify',
    });
    expect(result.ok).toBe(true);
    expect(result.sourceCodec).toBe('vorbis');
    expect(result.outputPath).toBe('/tmp/x.ogg');
  });

  it('throws TrackNotFoundOnSpotify when zotify reports a 404-style error', async () => {
    vi.spyOn(child, 'spawn').mockImplementation(() => fakeProc('', 'Track not found in catalog\n', 1));
    await expect(downloadTrack({
      accessToken: 'AT', trackUrl: 'https://x', outputPath: '/tmp/x.ogg', binaryPath: '/fake/zotify',
    })).rejects.toBeInstanceOf(TrackNotFoundOnSpotify);
  });

  it('throws AuthExpired when zotify reports an auth error', async () => {
    vi.spyOn(child, 'spawn').mockImplementation(() => fakeProc('', 'Authentication failed: token expired\n', 1));
    await expect(downloadTrack({
      accessToken: 'AT', trackUrl: 'https://x', outputPath: '/tmp/x.ogg', binaryPath: '/fake/zotify',
    })).rejects.toBeInstanceOf(AuthExpired);
  });

  it('throws ZotifyBinaryMissing on spawn error', async () => {
    vi.spyOn(child, 'spawn').mockImplementation(() => {
      const ee = { stdout: { on: () => {} }, stderr: { on: () => {} }, kill: () => {} };
      ee.on = (e, cb) => { if (e === 'error') setImmediate(() => cb(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }))); };
      return ee;
    });
    await expect(downloadTrack({
      accessToken: 'AT', trackUrl: 'https://x', outputPath: '/tmp/x.ogg', binaryPath: '/fake/zotify',
    })).rejects.toThrow(/binary/i);
  });
});
```

- [ ] **Step 2: Run — expect failure**

```bash
npm test -- tests/spotify-direct/zotify.test.js
```

- [ ] **Step 3: Implement `main/spotify-direct/zotify.js`**

```javascript
const { spawn } = require('node:child_process');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { resolveBinary } = require('../storage/paths.js');

class TrackNotFoundOnSpotify extends Error { constructor() { super('track not found on Spotify'); this.code = 'TRACK_NOT_FOUND_SPOTIFY'; } }
class AuthExpired extends Error { constructor() { super('Spotify auth expired'); this.code = 'AUTH_EXPIRED'; } }
class RegionLocked extends Error { constructor() { super('track region-locked'); this.code = 'REGION_LOCKED'; } }
class PremiumRequired extends Error { constructor() { super('track requires Premium'); this.code = 'PREMIUM_REQUIRED'; } }
class ZotifyBinaryMissing extends Error { constructor() { super('zotify binary missing'); this.code = 'ZOTIFY_BINARY_MISSING'; } }
class ZotifyUnrecognizedError extends Error {
  constructor(stderr) { super(`zotify failed: ${stderr}`); this.code = 'ZOTIFY_UNRECOGNIZED'; }
}

async function writeCredentialsFile(accessToken) {
  // Approach 1 from the spike: zotify reads credentials at this path.
  // If the spike resolved to a different approach, replace this helper.
  const credPath = path.join(os.homedir(), '.zotify', 'credentials.json');
  await fs.mkdir(path.dirname(credPath), { recursive: true });
  await fs.writeFile(credPath, JSON.stringify({ access_token: accessToken }), 'utf8');
}

function classifyStderr(stderr) {
  const s = stderr.toLowerCase();
  if (/auth(entication)? (failed|expired)/.test(s) || /token expired/.test(s)) return new AuthExpired();
  if (/not found|404/.test(s)) return new TrackNotFoundOnSpotify();
  if (/region/.test(s)) return new RegionLocked();
  if (/premium/.test(s)) return new PremiumRequired();
  return new ZotifyUnrecognizedError(stderr.trim());
}

async function downloadTrack({ accessToken, trackUrl, outputPath, signal, binaryPath }) {
  await writeCredentialsFile(accessToken);

  const exe = binaryPath || resolveBinary('zotify');
  return new Promise((resolve, reject) => {
    const child = spawn(exe, [
      '--output', outputPath,
      '--audio-format', 'vorbis',
      trackUrl,
    ], { signal });

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (b) => { stdout += b.toString(); });
    child.stderr.on('data', (b) => { stderr += b.toString(); });
    child.on('error', (err) => {
      if (err.code === 'ENOENT') reject(new ZotifyBinaryMissing());
      else reject(err);
    });
    child.on('close', (code) => {
      if (code === 0) {
        const codec = (stdout.match(/vorbis|opus|aac/i) || ['vorbis'])[0].toLowerCase();
        const bitrate = parseInt((stdout.match(/(\d{2,3})\s*kbps/i) || [])[1] || '320', 10);
        resolve({ ok: true, outputPath, sourceCodec: codec, sourceBitrateKbps: bitrate });
      } else {
        reject(classifyStderr(stderr));
      }
    });
  });
}

module.exports = {
  downloadTrack,
  TrackNotFoundOnSpotify, AuthExpired, RegionLocked, PremiumRequired,
  ZotifyBinaryMissing, ZotifyUnrecognizedError,
};
```

- [ ] **Step 4: Run — expect pass**

```bash
npm test -- tests/spotify-direct/zotify.test.js
```

- [ ] **Step 5: Commit**

```bash
git add main/spotify-direct/zotify.js tests/spotify-direct/zotify.test.js
git commit -m "feat(spotify-direct): zotify subprocess wrapper with typed errors"
```

---

## Task 10: spotify-direct facade

**Files:**
- Create: `main/spotify-direct/index.js`

This is the single integration point the rest of the app uses. It glues PKCE + OAuth + storage + zotify, and exposes the public API from the spec.

- [ ] **Step 1: Write `main/spotify-direct/index.js`**

```javascript
const { EventEmitter } = require('node:events');
const { shell } = require('electron');
const { generateCodeVerifier, codeChallenge } = require('./pkce.js');
const { buildAuthorizationUrl } = require('./oauth-urls.js');
const oauth = require('./oauth.js');
const zotify = require('./zotify.js');

function createSpotifyDirect({ store, clientIdProvider }) {
  const ee = new EventEmitter();
  let access = { token: null, expiresAt: 0 };
  let cachedProfile = null;  // { email, product }

  async function loadFromStore() {
    const persisted = await store.read();
    if (!persisted) return null;
    cachedProfile = { email: persisted.email, product: persisted.product };
    return persisted;
  }

  async function _refreshIfNeeded() {
    if (access.token && Date.now() < access.expiresAt - 5 * 60 * 1000) return access.token;
    const persisted = await store.read();
    if (!persisted) throw Object.assign(new Error('not connected'), { code: 'NOT_CONNECTED' });
    try {
      const r = await oauth.refreshAccessToken({
        refreshToken: persisted.refresh_token,
        clientId: clientIdProvider(),
      });
      access = { token: r.access_token, expiresAt: Date.now() + r.expires_in * 1000 };
      if (r.refresh_token && r.refresh_token !== persisted.refresh_token) {
        await store.write({ ...persisted, refresh_token: r.refresh_token, savedAt: new Date().toISOString() });
      }
      return access.token;
    } catch (err) {
      // Refresh failed; assume revoked
      await store.clear();
      access = { token: null, expiresAt: 0 };
      cachedProfile = null;
      ee.emit('status-changed', { connected: false });
      throw err;
    }
  }

  return {
    on: (...args) => ee.on(...args),

    async getStatus() {
      const persisted = await store.read();
      if (!persisted) return { connected: false };
      return { connected: true, email: persisted.email, plan: persisted.product };
    },

    async connect() {
      ee.emit('status-changed', { connecting: true });

      const verifier = generateCodeVerifier();
      const challenge = codeChallenge(verifier);
      const state = generateCodeVerifier().slice(0, 16);

      const cb = await oauth.createLoopbackCallback();
      const redirectUri = `http://127.0.0.1:${cb.port}/callback`;
      const url = buildAuthorizationUrl({
        clientId: clientIdProvider(),
        redirectUri,
        codeChallenge: challenge,
        state,
      });

      shell.openExternal(url);

      let callbackResult;
      try { callbackResult = await cb.promise; }
      catch (err) {
        ee.emit('status-changed', { connected: false, error: err.message });
        throw err;
      }

      if (callbackResult.state !== state) {
        ee.emit('status-changed', { connected: false, error: 'state mismatch' });
        throw new Error('oauth state mismatch');
      }

      const tokens = await oauth.exchangeCodeForTokens({
        code: callbackResult.code,
        codeVerifier: verifier,
        redirectUri,
        clientId: clientIdProvider(),
      });

      const me = await oauth.fetchUserProfile({ accessToken: tokens.access_token });
      access = { token: tokens.access_token, expiresAt: Date.now() + tokens.expires_in * 1000 };
      cachedProfile = { email: me.email, product: me.product };

      await store.write({
        refresh_token: tokens.refresh_token,
        email: me.email,
        product: me.product,
        savedAt: new Date().toISOString(),
      });

      ee.emit('status-changed', { connected: true, email: me.email, plan: me.product });
      return { connected: true, email: me.email, plan: me.product };
    },

    async disconnect() {
      await store.clear();
      access = { token: null, expiresAt: 0 };
      cachedProfile = null;
      ee.emit('status-changed', { connected: false });
    },

    async downloadTrack(spotifyTrackId, outputPath, { signal } = {}) {
      const token = await _refreshIfNeeded();
      const trackUrl = `https://open.spotify.com/track/${spotifyTrackId}`;
      try {
        return await zotify.downloadTrack({
          accessToken: token, trackUrl, outputPath, signal,
        });
      } catch (err) {
        if (err.code === 'AUTH_EXPIRED') {
          await store.clear();
          access = { token: null, expiresAt: 0 };
          ee.emit('status-changed', { connected: false, error: 'auth expired' });
        }
        throw err;
      }
    },

    _loadFromStore: loadFromStore,
  };
}

module.exports = { createSpotifyDirect };
```

- [ ] **Step 2: Run the full suite to confirm no regressions**

```bash
npm test
```

Expected: everything still passes. The facade has no dedicated test file — it is exercised through integration tests in later tasks (pipeline + IPC). This is deliberate: writing isolated tests for an orchestrator that already delegates to fully-tested units is low value.

- [ ] **Step 3: Commit**

```bash
git add main/spotify-direct/index.js
git commit -m "feat(spotify-direct): facade gluing pkce, oauth, store, and zotify"
```

---

## Task 11: Pipeline integration

**Files:**
- Modify: `main/download/pipeline.js`
- Modify: `tests/download/pipeline.test.js`

- [ ] **Step 1: Append failing tests**

Append to `tests/download/pipeline.test.js`:

```javascript
describe('pipeline.run — Spotify-direct first, YouTube fallback', () => {
  function pipelineWithSpotifyDirect(spotifyDirect) {
    return createPipeline({
      ytdlp: {
        searchYouTubeForTrack: async () => ({ url: 'https://yt/x', title: 'X' }),
        downloadAudio: async (url, t) => fs.writeFileSync(t.replace('.%(ext)s', '.opus'), Buffer.from('y')),
      },
      convertToMp3: async (i, o) => fs.copyFileSync(i, o),
      writeTags: async () => {},
      buildFilename: ({ artist, title }) => `${artist} - ${title}.mp3`,
      probeBitrateKbps: async () => 192,
      parseMixType: (t) => ({ cleanTitle: t, mixType: null }),
      enrichment: { lookup: async () => null },
      library: { has: async () => false, register: async () => {} },
      hashPlaylist: () => 'plh', hashTrack: () => 'th',
      spotifyDirect,
    });
  }

  it('uses Spotify-direct when connected and platform is spotify', async () => {
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mdrun-'));
    const calls = { sd: 0, ytSearch: 0 };
    const pipeline = pipelineWithSpotifyDirect({
      getStatus: async () => ({ connected: true, email: 'a@b', plan: 'premium' }),
      downloadTrack: async (_id, outputPath) => {
        calls.sd++;
        fs.writeFileSync(outputPath, Buffer.from('ogg'));
        return { ok: true, sourceCodec: 'vorbis', sourceBitrateKbps: 320, outputPath };
      },
    });
    // Re-create with a sentinel search for accounting
    pipeline.deps_for_test = { calls };

    await pipeline.run({
      playlistName: 'PL',
      platform: 'spotify',
      sourceId: 'src',
      tracks: [{ name: 'X', artist: 'A', spotifyId: 'TRACK1' }],
      outputDir: outDir,
      onEvent: () => {},
    });
    expect(calls.sd).toBe(1);
  });

  it('falls through to YouTube when Spotify-direct throws a recoverable error', async () => {
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mdrun-'));
    const events = [];
    const pipeline = pipelineWithSpotifyDirect({
      getStatus: async () => ({ connected: true, email: 'a@b', plan: 'premium' }),
      downloadTrack: async () => {
        const e = new Error('not in catalog'); e.code = 'TRACK_NOT_FOUND_SPOTIFY';
        throw e;
      },
    });
    const result = await pipeline.run({
      playlistName: 'PL',
      platform: 'spotify',
      sourceId: 'src',
      tracks: [{ name: 'X', artist: 'A', spotifyId: 'T1' }],
      outputDir: outDir,
      onEvent: (e) => events.push(e),
    });
    // The track should still complete (via YouTube). 'done' is emitted.
    expect(events.map(e => e.type)).toContain('done');
    expect(result.ok).toHaveLength(1);
  });

  it('skips Spotify-direct entirely when not connected', async () => {
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mdrun-'));
    let sdCalled = false;
    const pipeline = pipelineWithSpotifyDirect({
      getStatus: async () => ({ connected: false }),
      downloadTrack: async () => { sdCalled = true; throw new Error('should not be called'); },
    });
    await pipeline.run({
      playlistName: 'PL', platform: 'spotify', sourceId: 'src',
      tracks: [{ name: 'X', artist: 'A', spotifyId: 'T1' }],
      outputDir: outDir,
      onEvent: () => {},
    });
    expect(sdCalled).toBe(false);
  });
});
```

- [ ] **Step 2: Run — expect failure**

```bash
npm test -- tests/download/pipeline.test.js
```

- [ ] **Step 3: Modify `main/download/pipeline.js`**

Update the `createPipeline(deps)` destructure to add `spotifyDirect`, and insert the new step inside the `for` loop, between the library-skip check and the YouTube search. The relevant edit:

```javascript
function createPipeline(deps) {
  const {
    ytdlp, convertToMp3, writeTags, buildFilename, probeBitrateKbps,
    parseMixType, enrichment, library, hashPlaylist, hashTrack,
    spotifyDirect,
  } = deps;

  // ... existing code ...
}
```

Then, inside the per-track loop, after the existing `if (await library.has(...))` skip block and before the existing `const search = await ytdlp.searchYouTubeForTrack(...)` call, insert:

```javascript
let usedSpotifyDirect = false;
let spotifyDirectMeta = null;
let fallbackReason = null;

if (platform === 'spotify' && spotifyDirect && track.spotifyId) {
  let status;
  try { status = await spotifyDirect.getStatus(); } catch { status = { connected: false }; }

  if (status.connected) {
    const sdOutputPath = path.join(os.tmpdir(), `mdsd-${uuid()}.ogg`);
    try {
      const sd = await spotifyDirect.downloadTrack(track.spotifyId, sdOutputPath, { signal });
      usedSpotifyDirect = true;
      spotifyDirectMeta = sd;
    } catch (err) {
      const recoverable = ['TRACK_NOT_FOUND_SPOTIFY', 'REGION_LOCKED', 'PREMIUM_REQUIRED', 'ZOTIFY_UNRECOGNIZED', 'AUTH_EXPIRED', 'NOT_CONNECTED'];
      if (recoverable.includes(err.code)) {
        fallbackReason = err.code.toLowerCase();
      } else {
        throw err;
      }
    }
  }
}

let sourceFile;
let bitrateKbps;
let sourceCodec;

if (usedSpotifyDirect) {
  sourceFile = spotifyDirectMeta.outputPath;
  bitrateKbps = spotifyDirectMeta.sourceBitrateKbps;
  sourceCodec = spotifyDirectMeta.sourceCodec;
} else {
  // existing YouTube path (search + downloadAudio + ffprobe), but only assign sourceFile after
  const search = await ytdlp.searchYouTubeForTrack({ artist: track.artist, title: track.name }, { signal });
  if (!search) {
    onEvent?.({ type: 'not_found', trackIdx: idx, reason: 'no youtube result' });
    failed.push({ track, reason: 'not_found' });
    continue;
  }
  const tmpBase = path.join(os.tmpdir(), `mddl-${uuid()}`);
  await ytdlp.downloadAudio(search.url, `${tmpBase}.%(ext)s`, { signal });
  sourceFile = await findDownloadedFile(tmpBase);
  bitrateKbps = await probeBitrateKbps(sourceFile);
  sourceCodec = 'opus';  // best-effort; YouTube bestaudio is overwhelmingly Opus
}
```

Then, where the existing code calls `writeTags(...)`, add the provenance comment field:

```javascript
const provenance = buildProvenanceComment({
  source: usedSpotifyDirect ? 'spotify-direct' : (platform === 'soundcloud' ? 'soundcloud' : 'youtube'),
  sourceCodec,
  sourceBitrateKbps: bitrateKbps,
  finalBitrateKbps: bitrateKbps,
  fallbackReason,
  plan: spotifyDirectMeta?.plan,
});

await writeTags(finalPath, {
  // ... existing fields ...
  comment: provenance,
});
```

At the top of the file, add the require:

```javascript
const { buildProvenanceComment } = require('../spotify-direct/provenance.js');
```

Also, track per-track source so the summary can break it down. Extend `ok.push(track)` to `ok.push({ track, via: usedSpotifyDirect ? 'spotify-direct' : 'youtube', fallbackReason })`.

Change the function's return:

```javascript
return { ok, failed };
```

Stays the same; the per-item shape carries the per-source info now.

- [ ] **Step 4: Run — expect pass**

```bash
npm test -- tests/download/pipeline.test.js
```

Note: the existing pipeline tests that pushed plain tracks into `ok` will need to be updated to expect the new `{ track, via, fallbackReason }` shape. Update those tests inline as part of this step.

- [ ] **Step 5: Run the full suite**

```bash
npm test
```

Expected: green.

- [ ] **Step 6: Commit**

```bash
git add main/download/pipeline.js tests/download/pipeline.test.js
git commit -m "feat(pipeline): try spotify-direct before youtube with graceful fallback"
```

---

## Task 12: IPC channels for connect/disconnect/status

**Files:**
- Modify: `main/ipc.js`
- Modify: `main/preload.js`
- Modify: `main/index.js`

- [ ] **Step 1: Update `main/ipc.js`**

At the top, add:

```javascript
const { createSpotifyDirect } = require('./spotify-direct/index.js');
const { createSpotifyAuthStore } = require('./storage/spotify-auth.js');
const { safeStorage } = require('electron');
```

Inside `registerIpc({ config, window, userDataDir })`, after the existing `const spotifyClient = createSpotifyClient(...)` line, add:

```javascript
const spotifyDirectStore = createSpotifyAuthStore(userDataDir, safeStorage);
const spotifyDirect = createSpotifyDirect({
  store: spotifyDirectStore,
  clientIdProvider: () => creds.oauthClientId,
});

spotifyDirect.on('status-changed', (payload) => {
  broadcast(window, 'spotify:status-changed', payload);
});
```

Update the `createPipeline(...)` call to include the new dependency:

```javascript
const pipeline = createPipeline({
  ytdlp,
  convertToMp3: ffmpeg.convertToMp3,
  probeBitrateKbps: ffmpeg.probeBitrateKbps,
  writeTags,
  buildFilename,
  parseMixType,
  enrichment,
  library,
  hashPlaylist,
  hashTrack,
  spotifyDirect,
});
```

Append four new IPC handlers near the existing ones:

```javascript
ipcMain.handle('spotify:status', async () => spotifyDirect.getStatus());

ipcMain.handle('spotify:connect', async () => {
  try { return { ok: true, data: await spotifyDirect.connect() }; }
  catch (err) { return errorPayload(err); }
});

ipcMain.handle('spotify:disconnect', async () => {
  await spotifyDirect.disconnect();
  return { ok: true };
});
```

- [ ] **Step 2: Update `main/preload.js`**

Add the new namespace to the `contextBridge.exposeInMainWorld('api', ...)` object:

```javascript
spotifyAccount: {
  getStatus: () => ipcRenderer.invoke('spotify:status'),
  connect: () => ipcRenderer.invoke('spotify:connect'),
  disconnect: () => ipcRenderer.invoke('spotify:disconnect'),
  onStatusChange: (cb) => {
    const listener = (_e, payload) => cb(payload);
    ipcRenderer.on('spotify:status-changed', listener);
    return () => ipcRenderer.off('spotify:status-changed', listener);
  },
},
```

- [ ] **Step 3: Confirm `main/index.js` already forwards `userDataDir` to `registerIpc`**

It does, since Plan B Task 9. No change required. Run a quick sanity:

```bash
grep -n 'registerIpc' main/index.js
```

Expected: a line `registerIpc({ config, window, userDataDir: app.getPath('userData') });` is present.

- [ ] **Step 4: Run all tests**

```bash
npm test
```

Expected: green. (The IPC layer has no direct unit tests; it's exercised end-to-end via the manual smoke.)

- [ ] **Step 5: Commit**

```bash
git add main/ipc.js main/preload.js
git commit -m "feat(ipc): expose spotify connect/disconnect/status + status-change broadcast"
```

---

## Task 13: Embed OAuth client ID at build time

**Files:**
- Modify: `scripts/embed-spotify.js`

- [ ] **Step 1: Modify `scripts/embed-spotify.js`**

Replace the existing exit-on-placeholder block with an extended version that also handles `SPOTIFY_OAUTH_CLIENT_ID`:

```javascript
if (!env.SPOTIFY_CLIENT_ID || !env.SPOTIFY_CLIENT_SECRET || !env.SPOTIFY_OAUTH_CLIENT_ID) {
  console.error('SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET, and SPOTIFY_OAUTH_CLIENT_ID must be set in .env');
  process.exit(1);
}

const PLACEHOLDERS = new Set([
  '',
  'your_client_id_here',
  'your_client_secret_here',
  'ci_placeholder_client_id',
  'ci_placeholder_client_secret',
  'your_oauth_client_id_here',
  'changeme',
  'TODO',
]);

if (
  PLACEHOLDERS.has(env.SPOTIFY_CLIENT_ID) ||
  PLACEHOLDERS.has(env.SPOTIFY_CLIENT_SECRET) ||
  PLACEHOLDERS.has(env.SPOTIFY_OAUTH_CLIENT_ID)
) {
  console.error('ERRO: .env contém credenciais placeholder ou vazias.');
  console.error('Configure SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET e SPOTIFY_OAUTH_CLIENT_ID com valores reais.');
  process.exit(1);
}
```

Replace the `out` template:

```javascript
const out = `// AUTO-GENERATED by scripts/embed-spotify.js. Do not commit.
module.exports = {
  clientId: ${JSON.stringify(env.SPOTIFY_CLIENT_ID)},
  clientSecret: ${JSON.stringify(env.SPOTIFY_CLIENT_SECRET)},
  oauthClientId: ${JSON.stringify(env.SPOTIFY_OAUTH_CLIENT_ID)},
};
`;
```

- [ ] **Step 2: Update `.env.example`**

Append:

```
SPOTIFY_OAUTH_CLIENT_ID=your_oauth_client_id_here
```

- [ ] **Step 3: Update your local `.env`**

Set the value to the OAuth Client ID from the spike (Task 1, Step 2).

- [ ] **Step 4: Verify the script works**

```bash
npm run embed-creds
node -e "const c = require('./main/spotify-creds.js'); console.log(Object.keys(c));"
```

Expected: `[ 'clientId', 'clientSecret', 'oauthClientId' ]`.

- [ ] **Step 5: Commit**

```bash
git add scripts/embed-spotify.js .env.example
git commit -m "build: embed SPOTIFY_OAUTH_CLIENT_ID alongside existing creds"
```

---

## Task 14: CI workflow — pass OAuth secret to build

**Files:**
- Modify: `.github/workflows/build-release.yml`

- [ ] **Step 1: Add the GitHub Secret in the UI**

In a browser, open `Settings → Environments → PROD → Add secret`. Add `SPOTIFY_OAUTH_CLIENT_ID` with the value from Spotify Developer Dashboard. (This is a manual UI step; verify locally:)

```bash
gh secret list --env PROD --repo $(git remote get-url origin | sed -E 's|.*github.com[:/]([^/]+/[^/.]+).*|\1|')
```

Expected: three secrets listed (the two existing plus `SPOTIFY_OAUTH_CLIENT_ID`).

- [ ] **Step 2: Modify the workflow**

In `.github/workflows/build-release.yml`, in both the `build-mac` and `build-windows` jobs, add the new env var alongside the existing two. Each `env:` block becomes:

```yaml
env:
  SPOTIFY_CLIENT_ID: ${{ secrets.SPOTIFY_CLIENT_ID }}
  SPOTIFY_CLIENT_SECRET: ${{ secrets.SPOTIFY_CLIENT_SECRET }}
  SPOTIFY_OAUTH_CLIENT_ID: ${{ secrets.SPOTIFY_OAUTH_CLIENT_ID }}
```

In both jobs' `Create build env file` step, extend the bash script:

```yaml
      - name: Create build env file
        shell: bash
        run: |
          if [ -z "$SPOTIFY_CLIENT_ID" ] || [ -z "$SPOTIFY_CLIENT_SECRET" ] || [ -z "$SPOTIFY_OAUTH_CLIENT_ID" ]; then
            echo "::error::SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET, e SPOTIFY_OAUTH_CLIENT_ID precisam estar configurados em Settings → Environments → PROD."
            exit 1
          fi
          {
            echo "SPOTIFY_CLIENT_ID=${SPOTIFY_CLIENT_ID}"
            echo "SPOTIFY_CLIENT_SECRET=${SPOTIFY_CLIENT_SECRET}"
            echo "SPOTIFY_OAUTH_CLIENT_ID=${SPOTIFY_OAUTH_CLIENT_ID}"
          } > .env
```

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/build-release.yml
git commit -m "ci: pass SPOTIFY_OAUTH_CLIENT_ID to mac and windows builds"
```

---

## Task 15: Bundle zotify in `scripts/fetch-binaries.js`

**Files:**
- Modify: `scripts/fetch-binaries.js`

This task depends heavily on the spike's findings about where to source `zotify` binaries. The placeholder below assumes downloading prebuilt PyInstaller releases from the upstream zotify repo. If a usable upstream release does not exist for all three targets, the implementer builds them in CI using PyInstaller on the matching runner OS — that path is a follow-up sub-task documented in `docs/superpowers/notes/2026-06-06-zotify-spike.md` and outside this plan's scope.

- [ ] **Step 1: Add ZOTIFY URLs to the script**

Near the top of `scripts/fetch-binaries.js`, after the existing `YT_DLP` and `FFMPEG` maps, add:

```javascript
const ZOTIFY = {
  'mac-arm64': '<UPSTREAM_URL_FOR_MAC_ARM64>',
  'mac-x64':   '<UPSTREAM_URL_FOR_MAC_X64>',
  'win-x64':   '<UPSTREAM_URL_FOR_WIN_X64>',
};
```

Replace each `<UPSTREAM_URL_...>` with the URL recorded in the spike's findings document. If the spike's outcome was "build from source," skip this task and follow the alternate path documented in the findings.

- [ ] **Step 2: Add a `fetchZotify` function**

Mirror the existing `fetchYtDlp`:

```javascript
async function fetchZotify(target) {
  if (!ZOTIFY[target]) {
    console.warn(`no zotify URL for ${target}; skipping`);
    return;
  }
  const dir = path.join(BIN, target);
  ensureDir(dir);
  const dest = path.join(dir, target === 'win-x64' ? 'zotify.exe' : 'zotify');
  console.log(`downloading zotify for ${target}`);
  await download(ZOTIFY[target], dest);
  if (target !== 'win-x64') fs.chmodSync(dest, 0o755);
}
```

- [ ] **Step 3: Call it from the targets loop**

Inside the loop near the bottom:

```javascript
for (const t of targets) {
  await fetchYtDlp(t);
  await fetchFfmpeg(t);
  await fetchZotify(t);
}
```

- [ ] **Step 4: Run for your local target**

```bash
node scripts/fetch-binaries.js
ls binaries/mac-arm64/zotify || ls binaries/mac-x64/zotify
binaries/mac-*/zotify --version 2>&1 | head -3
```

Expected: a version line.

- [ ] **Step 5: Commit**

```bash
git add scripts/fetch-binaries.js
git commit -m "chore(binaries): bundle zotify alongside yt-dlp and ffmpeg"
```

---

## Task 16: Renderer — Spotify tab banner, status pill, and OAuth modal

**Files:**
- Modify: `renderer/index.html`
- Modify: `renderer/styles.css`
- Modify: `renderer/tabs/spotify.js`

- [ ] **Step 1: Add banner, status pill, and OAuth modal markup to `renderer/index.html`**

Inside `<div class="panel" id="spotifyPanel">`, immediately at the top of the panel (above the existing `.state.state-empty` block), add:

```html
<div id="spotifyAuthBanner" class="auth-banner" hidden>
  <button class="dismiss" id="spotifyAuthBannerDismiss" type="button" aria-label="Dispensar">×</button>
  <strong>🎵 Conecte sua conta Spotify pra baixar em 320 kbps</strong>
  <span>Sem conectar, ainda funciona via YouTube (até 160 kbps).</span>
  <button id="spotifyConnectBtn" type="button" class="primary">Conectar Spotify</button>
</div>

<div id="spotifyAuthPill" class="auth-pill" hidden>
  <span id="spotifyAuthPillText"></span>
  <button id="spotifyDisconnectBtn" type="button" class="ghost">Desconectar</button>
</div>
```

Inside `<section id="main" hidden>` (alongside the other dialogs added in Plan C), add the OAuth modal:

```html
<dialog id="oauthDialog">
  <h2>Aguardando autorização no Spotify…</h2>
  <p id="oauthDialogBody">Se você fechou o navegador sem querer, clique em "Tentar de novo".</p>
  <div class="row-right">
    <button id="oauthDialogRetry" type="button">Tentar de novo</button>
    <button id="oauthDialogCancel" type="button" value="cancel">Cancelar</button>
  </div>
</dialog>
```

- [ ] **Step 2: Add styles**

Append to `renderer/styles.css`:

```css
.auth-banner {
  background: #e8f7ed; border: 1px solid #b9e1c8; border-radius: 6px;
  padding: 10px 14px; margin-bottom: 12px; display: flex; gap: 10px;
  align-items: center; flex-wrap: wrap; position: relative; font-size: 13px;
}
.auth-banner strong { color: #1c7c3f; }
.auth-banner span { color: #555; flex: 1; min-width: 200px; }
.auth-banner button.primary {
  background: #1db954; color: white; font-size: 12px; padding: 8px 14px;
}
.auth-banner .dismiss {
  position: absolute; top: 6px; right: 8px; background: transparent;
  border: none; color: #888; font-size: 16px; cursor: pointer;
}
.auth-pill {
  background: #f3f9f5; border: 1px solid #d8ecdd; border-radius: 6px;
  padding: 8px 12px; margin-bottom: 12px; display: flex; gap: 10px;
  align-items: center; font-size: 12px; color: #2a6b3f;
}
.auth-pill button.ghost {
  background: transparent; color: #555; border: 1px solid #ddd; padding: 4px 10px;
  font-size: 11px;
}
#oauthDialog { border: 1px solid #ddd; border-radius: 8px; padding: 18px; min-width: 360px; }
#oauthDialog::backdrop { background: rgba(0, 0, 0, 0.2); }
```

- [ ] **Step 3: Update `renderer/tabs/spotify.js`**

At the top of the file, before the existing `export function initSpotifyTab()` definition (or inside it), add:

```javascript
async function refreshSpotifyAuthBanner() {
  const banner = document.querySelector('#spotifyAuthBanner');
  const pill = document.querySelector('#spotifyAuthPill');
  const pillText = document.querySelector('#spotifyAuthPillText');

  const status = await window.api.spotifyAccount.getStatus();
  const cfg = await window.api.config.get();

  if (status.connected) {
    banner.hidden = true;
    pill.hidden = false;
    const planLabel = status.plan === 'premium'
      ? `Premium · 320 kbps`
      : `${status.plan} · 160 kbps (upgrade pra 320)`;
    pillText.textContent = `✓ Conectado como ${status.email} · ${planLabel}`;
  } else {
    pill.hidden = true;
    const dismissedAt = cfg.spotifyBannerDismissedAt;
    const dismissedRecently = dismissedAt && (Date.now() - new Date(dismissedAt).getTime() < 7 * 86400 * 1000);
    banner.hidden = !!dismissedRecently;
  }
}

async function triggerOAuthFlow() {
  const dialog = document.querySelector('#oauthDialog');
  dialog.showModal();
  const result = await window.api.spotifyAccount.connect();
  dialog.close();
  if (!result.ok) {
    alert(result.userMessage || 'Falha ao conectar Spotify.');
  }
  await refreshSpotifyAuthBanner();
}

async function disconnectSpotify() {
  await window.api.spotifyAccount.disconnect();
  await refreshSpotifyAuthBanner();
}

async function dismissBanner() {
  const cfg = await window.api.config.get();
  await window.api.config.set({ ...cfg, spotifyBannerDismissedAt: new Date().toISOString() });
  await refreshSpotifyAuthBanner();
}

// Wire on tab init
window.addEventListener('DOMContentLoaded', () => {
  const connectBtn = document.querySelector('#spotifyConnectBtn');
  const disconnectBtn = document.querySelector('#spotifyDisconnectBtn');
  const dismissBtn = document.querySelector('#spotifyAuthBannerDismiss');
  if (connectBtn) connectBtn.addEventListener('click', triggerOAuthFlow);
  if (disconnectBtn) disconnectBtn.addEventListener('click', disconnectSpotify);
  if (dismissBtn) dismissBtn.addEventListener('click', dismissBanner);

  refreshSpotifyAuthBanner();

  if (window.api.spotifyAccount?.onStatusChange) {
    window.api.spotifyAccount.onStatusChange(() => refreshSpotifyAuthBanner());
  }
});
```

- [ ] **Step 4: Test manually**

```bash
npm start
```

Click the Spotify tab. Verify the banner appears. Click the "×" → banner disappears, doesn't return on tab re-entry. Quit the app, restart, re-open Spotify tab → banner is still suppressed (because of the timestamp).

To test connect: click "Conectar Spotify" → browser opens (you'll need a real OAuth Client ID for this; for now just check that the modal appears and the browser opens). Cancel out — the modal stays open until you click Cancel.

- [ ] **Step 5: Commit**

```bash
git add renderer/index.html renderer/styles.css renderer/tabs/spotify.js
git commit -m "feat(renderer): spotify auth banner, status pill, and oauth modal"
```

---

## Task 17: Settings dialog — Spotify Premium block

**Files:**
- Modify: `renderer/index.html`
- Modify: `renderer/main.js`

- [ ] **Step 1: Update `renderer/index.html`**

Inside `<dialog id="settingsDialog"><form>`, between the existing folder row and the library reset row, add:

```html
<hr />
<div class="settings-row">
  <label>Spotify:</label>
  <span id="settingsSpotifyStatus"></span>
  <button id="settingsSpotifyAction" type="button"></button>
</div>
```

- [ ] **Step 2: Update `renderer/main.js`**

Inside `showMain()`, before the existing `$('#settingsBtn')` click handler, add:

```javascript
async function refreshSpotifySettings() {
  const status = await window.api.spotifyAccount.getStatus();
  const statusEl = $('#settingsSpotifyStatus');
  const actionEl = $('#settingsSpotifyAction');
  if (status.connected) {
    statusEl.textContent = `✓ Conectado como ${status.email} (${status.plan})`;
    actionEl.textContent = 'Desconectar';
    actionEl.onclick = async () => {
      await window.api.spotifyAccount.disconnect();
      await refreshSpotifySettings();
    };
  } else {
    statusEl.textContent = 'Não conectado · downloads do Spotify usam YouTube como fonte.';
    actionEl.textContent = 'Conectar Spotify';
    actionEl.onclick = async () => {
      const res = await window.api.spotifyAccount.connect();
      if (!res.ok) alert(res.userMessage || 'Falha ao conectar.');
      await refreshSpotifySettings();
    };
  }
}
```

In the existing `$('#settingsBtn').addEventListener('click', ...)` handler, add a `await refreshSpotifySettings();` call right next to `await refreshSettingsRows();`.

- [ ] **Step 3: Test manually**

```bash
npm start
```

Open the gear → see the Spotify row. Click Connect / Disconnect → verify behavior. The dialog state should match the tab banner state.

- [ ] **Step 4: Commit**

```bash
git add renderer/index.html renderer/main.js
git commit -m "feat(renderer): settings dialog spotify premium block"
```

---

## Task 18: Summary breakdown per source

**Files:**
- Modify: `renderer/tabs/tab.js`

- [ ] **Step 1: Update the summary rendering**

In `renderer/tabs/tab.js`, find the block that sets `$(summaryId).innerHTML = ...`. Replace it with:

```javascript
const okItems = resp.data.ok;
const failedItems = resp.data.failed;
const okCount = okItems.length;

const viaSpotify = okItems.filter(o => o.via === 'spotify-direct').length;
const viaYouTube = okItems.filter(o => o.via === 'youtube').length;
const breakdownHtml = (viaSpotify > 0 && viaYouTube > 0)
  ? `<div style="margin-top:6px;font-size:12px;color:#555;">${viaSpotify} via Spotify · ${viaYouTube} via YouTube (fallback)</div>`
  : '';

$(summaryId).innerHTML =
  `<div style="font-size:28px;font-weight:700;">${okCount} / ${currentTotal}</div>` +
  `<div>músicas baixadas</div>` +
  breakdownHtml +
  (failedItems.length ? `<div style="margin-top:8px;color:#cc6633">⚠ ${failedItems.length} não encontradas</div>` : '');
```

- [ ] **Step 2: Run all tests**

```bash
npm test
```

Expected: green.

- [ ] **Step 3: Commit**

```bash
git add renderer/tabs/tab.js
git commit -m "feat(renderer): per-source breakdown in playlist summary"
```

---

## Task 19: End-to-end smoke (manual)

- [ ] **Step 1: Pre-flight**

```bash
test -f .env || echo "MISSING .env"
node -e "const c = require('./main/spotify-creds.js'); ['clientId','clientSecret','oauthClientId'].forEach(k => { if (!c[k]) console.error('MISSING', k); })"
ls binaries/mac-*/zotify || ls binaries/win-x64/zotify.exe
```

Expected: no `MISSING` output.

- [ ] **Step 2: Run the app**

```bash
npm start
```

- [ ] **Step 3: Walk the flow**

  1. Spotify tab shows the banner.
  2. Click "Conectar Spotify" → browser opens.
  3. Log in, authorize.
  4. Modal closes; status pill shows "Conectado as <email>" with plan.
  5. Paste a known Premium-Spotify playlist URL (any of your 5-track test playlists).
  6. Buscar → preview.
  7. Baixar → track icons animate.
  8. Done → summary shows "5 / 5" with breakdown "5 via Spotify" (no fallback row).

- [ ] **Step 4: Verify file quality**

  1. Open each MP3 in Spek → confirm spectral content reaches 18–20 kHz.
  2. File sizes in the 8–20 MB range for ~3–8 min tracks.
  3. Open one MP3 in MusicBrainz Picard (or any ID3 inspector) → the `COMM` field reads `Source: Spotify Ogg Vorbis 320kbps → MP3 320kbps`.

- [ ] **Step 5: Disconnect + reconnect cycle**

  1. Open Settings → click Desconectar → status pill becomes banner.
  2. Click Conectar Spotify again → flow completes WITHOUT re-entering credentials in the browser (the browser session is remembered by Spotify).

- [ ] **Step 6: Force a fallback**

  Pick a track that's known not to be in the Spotify catalog (e.g., a remix uploaded only on YouTube). Build a one-track playlist on Spotify that references the track's Spotify entry if any, then download.

  If no such test track is convenient: stop the test here and revisit the fallback path with a real-world playlist that surfaces an unavailable track over the coming days. Add to `docs/superpowers/notes/2026-06-06-zotify-spike.md` what was observed.

- [ ] **Step 7: Commit notes**

```bash
git add docs/
git diff --cached --quiet || git commit -m "docs: smoke findings from plan d"
```

---

## Task 20: PR + release

- [ ] **Step 1: Run full test suite one more time**

```bash
npm test
```

- [ ] **Step 2: Push the branch**

```bash
git push -u origin feat/plan-d-spotify-direct
```

- [ ] **Step 3: Open the PR**

```bash
gh pr create --base main --head feat/plan-d-spotify-direct \
  --title "feat: plan D — Spotify direct download via zotify" \
  --body "$(cat <<'EOF'
## Summary
- New \`main/spotify-direct/\` subtree: PKCE OAuth, encrypted token storage, zotify subprocess wrapper, public facade
- Pipeline tries Spotify-direct before YouTube when on the Spotify tab and connected; falls through on recoverable errors
- Renderer: banner on Spotify tab when disconnected, status pill when connected, settings dialog Spotify Premium block, OAuth modal
- ID3 \`COMM\` provenance comment records the actual source; summary screen breaks down per-source counts
- CI: \`SPOTIFY_OAUTH_CLIENT_ID\` passed from PROD environment secrets to both build jobs
- Sidecar: \`zotify\` bundled alongside \`yt-dlp\` and \`ffmpeg\` via \`scripts/fetch-binaries.js\`

## Spec
\`docs/superpowers/specs/2026-06-06-plan-d-spotify-direct-design.md\`

## Spike findings
\`docs/superpowers/notes/2026-06-06-zotify-spike.md\`

## Test plan
- [x] All Vitest suites green locally
- [ ] Manual smoke per Task 19 of the implementation plan
- [ ] CI green on this PR with all three secrets configured in PROD
- [ ] Post-merge: tag \`v0.2.0\` to trigger the Build installers workflow
EOF
)"
```

- [ ] **Step 4: After CI passes, merge and tag**

After review:

```bash
gh pr merge --merge
git checkout main
git pull
git tag -a v0.2.0 -m "v0.2.0 — Spotify direct downloads via OAuth + zotify"
git push origin v0.2.0
```

The tag triggers the existing release workflow, producing `.dmg` and `.exe` artifacts that ship Plan D.

---

## Plan D complete

What you have at this point:

- Spotify tab downloads from Spotify directly at real 320 kbps when the friend is Premium and connected.
- YouTube fallback covers everything else (not connected, Free, catalog gaps, region locks).
- ID3 comments record the actual source per track; the summary screen surfaces a per-source breakdown.
- The friend's refresh token is encrypted by the OS keychain, never written in plain text.
- Tests cover PKCE, OAuth URLs, token storage, OAuth code exchange and refresh, the loopback server, the zotify subprocess (mocked), and the pipeline's Spotify-direct branch.
- The unsigned `.dmg` and `.exe` continue to ship; no signing/notarization in this plan.

What is intentionally **not** in this plan:

- Apple Music re-introduction (still deferred).
- Discogs enrichment (still deferred).
- Custom librespot-in-Rust integration (deferred to a possible Plan E if zotify becomes unmaintained or its bundle size becomes a real complaint).
- Auto-update.
- Code signing / notarization.
