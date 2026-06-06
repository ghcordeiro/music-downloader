# Plan D — Spotify Direct Download Design Document

**Date:** 2026-06-06
**Status:** Approved by user; ready for implementation planning
**Extends:** `docs/superpowers/specs/2026-06-06-music-downloader-design.md` (the original Music Downloader spec)

---

## 1. Context

Plans A, B, and C delivered the Music Downloader as a working Electron app that downloads playlists from Spotify, YouTube, and SoundCloud as MP3 files. The Spotify path works by using the Spotify Web API to read the *track list*, then downloading the *audio* from YouTube. This is the same trick every open-source playlist downloader uses, but it caps real audio quality at YouTube's ceiling: Opus ~160 kbps for most videos, occasionally AAC ~256 kbps.

For the project owner — a DJ — this cap is the practical complaint. Real DJ use needs source quality at or near 320 kbps so spectral content reaches ~20 kHz in Spek-style analysis. The shipped v0.1.0 produces MP3 files at 192 kbps in the container header, but the underlying audio data is the ~160 kbps Opus from YouTube, which cuts at ~16 kHz.

Plan D adds a second source for the Spotify tab: a direct download from Spotify itself, using `zotify` (Python wrapper around `librespot`) as a bundled sidecar. Each friend connects their own Spotify Premium account via an OAuth flow; the app stores their refresh token encrypted by the OS keychain; downloads stream the master Ogg Vorbis 320 kbps audio Spotify serves and re-encode to MP3 320 with full provenance in the ID3 comment.

The existing YouTube path is preserved as a fallback. Friends who do not connect (or do not have Premium) keep getting the v0.1.x behavior unchanged.

## 2. Goals

- A friend who has Spotify Premium can click a single "Conectar Spotify" button, complete OAuth in their default browser, and from that moment on every download from the Spotify tab pulls real 320 kbps source from Spotify itself.
- The friend's refresh token is stored encrypted by the OS keychain (`safeStorage`) and is never written in plain text to disk.
- No friend, including those without Premium and those who never connect, loses any feature. The YouTube path remains the fallback.
- Failures specific to Spotify (track removed, region-locked, Premium-required, transient API issues) fall back to YouTube transparently, with the actual source recorded in the ID3 comment so the user can tell honestly later.
- The "summary" screen at the end of a playlist surfaces the breakdown ("45 via Spotify, 3 via YouTube, 2 não encontradas") so the user — especially a DJ — can spot tracks that did not get master-quality audio.
- The project owner can ship the first usable version in roughly two focused weekends, gated by a 2-3 hour technical spike at the very beginning that confirms zotify can be authenticated from our Electron-driven OAuth flow.

## 3. Non-Goals

- **Embedding a shared Premium account.** No credentials of the project owner (or anyone) are bundled. Each friend uses their own.
- **A service-account approach** (dedicated Premium account paid by the project owner). Risk to that account is high (multi-device limits, anomalous-pattern bans) and the cost is recurring.
- **Removing or rewriting the YouTube path.** YouTube continues to handle the YouTube tab, SoundCloud tab, and the Spotify-tab fallback.
- **Supporting the Spotify catalog from non-Spotify tabs.** The YouTube and SoundCloud tabs are unaffected by this work. You do not paste Spotify URLs into them.
- **In-app browser.** The OAuth flow opens the user's default system browser via `shell.openExternal`. No embedded webview.
- **A "use lower quality on purpose" toggle.** When connected, the app always tries Spotify first. Quality of the downloaded file follows what the user's plan grants (Premium → 320, Free → 160). There is no UI for downgrading on purpose.
- **Spotify Web Playback SDK or Spotify Connect Device mode.** This plan uses zotify, which wraps librespot as a downloader, not as a Spotify Connect endpoint.
- **Custom librespot integration in Node/Rust.** Deferred to a possible Plan E. Plan D explicitly chooses zotify for the maturity-vs-bundle-size trade-off (zotify ships a Python runtime, adding ~100 MB; the integration risk is small enough that this is worth the disk cost).

## 4. Stack & High-Level Architecture

Plan D **extends, never replaces** Plans A/B/C. The renderer, IPC layout, ID3 tagging, filename builder, and pipeline orchestrator all stay. A small new subtree is added under `main/spotify-direct/`, and `main/download/pipeline.js` gains one optional step that runs before the existing YouTube path — only when the platform is Spotify and the user is connected.

- **`main/spotify-direct/`** holds the OAuth flow, the zotify subprocess wrapper, and the public facade. It is the only directory that knows about Spotify protocol details.
- **`main/storage/spotify-auth.js`** isolates persistence and `safeStorage` encryption.
- **`zotify`** is bundled per OS/arch the same way `yt-dlp` and `ffmpeg` are: as a sidecar binary under `binaries/<os-arch>/`. zotify is shipped as a single-file executable produced by PyInstaller from the upstream zotify project (or a pinned fork if upstream churn becomes a problem).
- **`main/download/pipeline.js`** is the only existing file in the download path that changes. It gains a single conditional branch.

The contract between `main/spotify-direct/index.js` and the rest of the app is small and stable:

```javascript
{
  async connect(): Promise<{ status, email, plan }>,
  async disconnect(): Promise<void>,
  async getStatus(): Promise<{ connected: boolean, email?, plan? }>,
  async downloadTrack(spotifyTrackId, outputPath, options): Promise<{
    ok: true,
    sourceCodec: string,
    sourceBitrateKbps: number,
    outputPath: string,
  }>,
  on(event, callback)   // 'status-changed' is the only event
}
```

When the upstream zotify project breaks (or Spotify changes its streaming protocol), only `spotify-direct/` is affected. Migrating later to a custom librespot wrapper (Plan E) means replacing this single facade implementation; no other module changes.

## 5. Folder Structure

```
main/
├── spotify-direct/                ← NEW
│   ├── index.js                   ← public facade (see contract above)
│   ├── zotify.js                  ← subprocess wrapper around the sidecar
│   └── oauth.js                   ← PKCE flow + token refresh
├── storage/
│   └── spotify-auth.js            ← NEW: encrypted token storage via safeStorage
├── download/
│   └── pipeline.js                ← MODIFIED: optional Spotify-direct step before YouTube
├── ipc.js                         ← MODIFIED: new channels for connect/disconnect/status
├── preload.js                     ← MODIFIED: expose window.api.spotifyAccount.*
└── (everything else: unchanged)

renderer/
├── tabs/
│   └── spotify.js                 ← MODIFIED: banner when disconnected, status pill when connected
└── main.js                        ← MODIFIED: Settings dialog gets a "Spotify Premium" block

binaries/
├── mac-arm64/{yt-dlp, ffmpeg, ffprobe, zotify}      ← +zotify
├── mac-x64/{yt-dlp, ffmpeg, ffprobe, zotify}        ← +zotify
└── win-x64/{yt-dlp.exe, ffmpeg.exe, ffprobe.exe, zotify.exe}  ← +zotify.exe

scripts/
└── fetch-binaries.js              ← MODIFIED: download zotify too

electron-builder.yml               ← MODIFIED: extraResources for zotify
```

## 6. OAuth + Token Storage

### 6.1 Flow type

**Authorization Code with PKCE.** Spotify supports it, and it is the recommended OAuth flow for native and desktop applications because no client secret is shipped in the client. Implicit Grant is deprecated by Spotify; Client Credentials does not grant user-level access; Authorization Code without PKCE would require shipping the client secret.

### 6.2 Step-by-step

1. The user clicks "Conectar Spotify" in the tab banner or in Settings.
2. The app generates a `code_verifier` (random 64-character URL-safe string) and a `code_challenge` (SHA-256 hash, base64url-encoded).
3. The app starts a loopback HTTP listener on `http://127.0.0.1:<random_port>/callback`. The port is chosen from the kernel's range of free ephemeral ports; if it cannot bind, it retries up to three times before raising `LoopbackBindFailed`.
4. The app constructs the authorization URL:
   ```
   https://accounts.spotify.com/authorize
     ?client_id=<SPOTIFY_OAUTH_CLIENT_ID>
     &response_type=code
     &redirect_uri=http://127.0.0.1:<port>/callback
     &code_challenge_method=S256
     &code_challenge=<challenge>
     &scope=streaming user-read-private user-read-email
     &state=<random_csrf_token>
   ```
5. The app opens the system browser at that URL via `shell.openExternal`. The renderer simultaneously shows a modal: "Aguardando autorização no Spotify…" with "Tentar de novo" and "Cancelar" buttons.
6. The user logs in on Spotify and approves the requested scopes.
7. Spotify redirects to `http://127.0.0.1:<port>/callback?code=<auth_code>&state=<csrf>`.
8. The loopback server receives the callback, validates `state` against the one it sent, responds with a small HTML page reading "Pode fechar essa aba ✅", then shuts down.
9. The app exchanges the code for tokens: `POST https://accounts.spotify.com/api/token` with `grant_type=authorization_code`, `code`, `redirect_uri`, `client_id`, and `code_verifier`.
10. Spotify responds with `access_token` (1h TTL), `refresh_token` (long-lived), `expires_in`, `token_type`, and `scope`.
11. The app calls `GET /v1/me` with the access token to retrieve the user's email and `product` field (`premium` or `free` or `open`).
12. The app encrypts `{refresh_token, email, product, savedAt}` via `safeStorage.encryptString` and writes to `spotify-auth.enc` in the userData directory. The access token is held in process memory only and never persisted.
13. The status-changed event fires with `{connected: true, email, plan}`. The renderer drops the banner and shows the status pill.

### 6.3 Token refresh

Before any operation requiring auth (download start, status check, etc.):

- If the in-memory access token has more than 5 minutes left, use it.
- Otherwise, `POST /api/token` with `grant_type=refresh_token` and the stored refresh token.
- Update the in-memory access token. If Spotify returns a new refresh token in the response, persist it.
- If the refresh call returns 400 or 401, treat as `AuthExpired`: clear `spotify-auth.enc`, emit `disconnected`, and let the pipeline fall back to YouTube. The next render of the Spotify tab shows the banner again.

### 6.4 Storage

```
~/Library/Application Support/MusicDownloader/spotify-auth.enc   (macOS)
%APPDATA%/MusicDownloader/spotify-auth.enc                       (Windows)
```

Encrypted via Electron's `safeStorage`:
- **macOS**: backed by the Keychain (a per-app, per-user key).
- **Windows**: backed by DPAPI (a per-user key).

If `safeStorage.isEncryptionAvailable()` returns false (rare; happens on some Mac configurations with a broken Keychain), the app shows a Tier-2 message: "Não foi possível guardar a credencial com segurança. Verifique o acesso ao Keychain e tente de novo."

The plaintext contents: `{refresh_token, email, product, savedAt}`. The access token is never persisted.

### 6.5 Scopes

| Scope | Why |
|-------|-----|
| `streaming` | Required by Spotify for high-bitrate streaming. Premium-only effect; granted to Free users but they still cap at 160. |
| `user-read-private` | Lets `/v1/me` return the `product` field so the UI can show "Premium" or "Free". |
| `user-read-email` | Lets `/v1/me` return the email for the "Connected as ..." display. |

No write scopes are requested; the app never modifies the user's Spotify account.

### 6.6 Spotify Developer App registration

This requires a **second** Spotify Developer app, separate from the one used for playlist metadata (Client Credentials Flow). The reasons:

- Different redirect URIs. The metadata app needs none; the OAuth app needs `http://127.0.0.1:*`.
- Failure isolation. If one app's credentials are revoked, the other still works.
- Quotas are tracked per app.

The project owner registers the app at `developer.spotify.com/dashboard`, configures the redirect URI to `http://127.0.0.1:*` (Spotify accepts the wildcard for loopback addresses), and copies the Client ID. PKCE removes the need to ship a client secret. The Client ID becomes a new GitHub Secret named `SPOTIFY_OAUTH_CLIENT_ID` and is embedded into the build by the existing `embed-spotify.js` flow (extended to handle the new key).

### 6.7 Integration risk with zotify

zotify uses `librespot-python` under the hood, which has its own authentication mechanism (historically username/password, more recently OAuth-derived AP credentials following Spotify's mid-2024 deprecation of password auth). Our app obtains a Spotify Web API access token via PKCE. **The bridge between our access token and zotify's auth state is the largest implementation risk** in this plan. Possible approaches, to be validated in the implementation spike:

1. zotify reads credentials from a known file location (`librespot-python` typically uses `~/.librespot-python/credentials.json` or similar). We write into that file before invoking zotify.
2. zotify accepts an access token via a CLI flag or environment variable.
3. We use the `librespot-auth` helper to convert our OAuth access token to an AP token in the format zotify expects.

**Plan D Task 1 is a focused 2-3 hour spike that confirms one of these works** before any UI or storage work begins. If all three fail, the plan pivots to bundling librespot directly with custom auth orchestration (Approach B in the brainstorm); the design document is updated accordingly.

## 7. Pipeline Integration

### 7.1 Where the new step lives

`main/download/pipeline.js` already iterates over tracks. For each track, it runs: skip-if-cached → search YouTube → yt-dlp download → ffprobe → ffmpeg → enrichment → tagging → register.

Plan D inserts one optional step between "skip-if-cached" and "search YouTube":

```
For each track:
  a. library.has() ? → emit('skipped'), continue
  b. NEW: if platform === 'spotify' AND spotifyDirect.getStatus().connected:
       const outputPath = `${os.tmpdir()}/mddl-${uuid()}.ogg`
       attempt = await spotifyDirect.downloadTrack(track.spotifyId, outputPath)
       if attempt.ok:
         sourceFile = attempt.outputPath          // same path we passed in
         sourceCodec = attempt.sourceCodec        // e.g., 'vorbis'
         sourceBitrateKbps = attempt.sourceBitrateKbps
         goto step e               // skip search + yt-dlp
       else if attempt.error.recoverable:
         log + fall through to step c (YouTube path)
       else:
         throw                     // hard error: AbortSignal, disk full, etc.
  c. ytdlp.searchYouTubeForTrack(...)        // unchanged
  d. ytdlp.downloadAudio(...)                // unchanged
  e. probeBitrateKbps(sourceFile)            // works for both Vorbis and Opus
  f. convertToMp3(sourceFile, finalPath, { bitrateKbps })   // unchanged
  g. enrichment.lookup() if label missing   // unchanged (Spotify path already has label)
  h. tagging.writeTags(...) with provenance comment reflecting the actual source
  i. library.register() + emit('done')
```

YouTube and SoundCloud tabs do not enter step (b). They go straight from (a) to (c).

### 7.2 Fallback decisions

| Situation | Behavior |
|-----------|----------|
| Spotify-direct not connected | Skip (b) silently, go to (c) |
| `TrackNotFoundOnSpotify` (catalog removal) | Fall through to (c), provenance notes "Spotify fallback: not in catalog" |
| `RegionLocked` | Fall through, note region |
| `PremiumRequired` (Premium-only track, user is Free) | Fall through, note Premium-required |
| `RateLimited` (HTTP 429 from zotify's internal calls) | Wait Retry-After, retry once, then fall through |
| `AuthExpired` mid-pipeline | Clear stored credentials, emit `disconnected`, fall through for this track and remaining tracks |
| User cancels (AbortSignal) | Propagate — no fallback |
| Disk full | Propagate — no fallback |

Fallback is silent in the UI during the download. The per-track icon flow (`↻ → ✓`) is identical. The actual source is recorded in the ID3 `COMM` frame and surfaced in the summary breakdown (see 8.2).

### 7.3 Honest provenance in ID3 comment

The `COMM` field gains the actual source for every track:

| Actual source | Comment string |
|---------------|----------------|
| Spotify direct (Premium account) | `Source: Spotify Ogg Vorbis 320kbps → MP3 320kbps` |
| Spotify direct (Free account, 160 cap) | `Source: Spotify Ogg Vorbis 160kbps → MP3 160kbps` |
| YouTube after Spotify fallback | `Source: YouTube Opus <N>kbps → MP3 <N>kbps (Spotify fallback: <reason>)` |
| YouTube straight (not connected, or YouTube tab) | `Source: YouTube Opus <N>kbps → MP3 <N>kbps` |
| SoundCloud | `Source: SoundCloud <codec> <N>kbps → MP3 <N>kbps` |

A DJ can grep the comment field later to identify tracks that did not get master-quality audio and re-download them when conditions change.

### 7.4 Performance

zotify, like the Spotify desktop client, observes Spotify's internal rate limits and is broadly comparable in throughput to `yt-dlp` against YouTube. Empirically: roughly 30 seconds per 4-minute track on a decent home connection. Plan D keeps the sequential per-playlist pipeline (one track at a time). Spotify allows roughly 5 concurrent "Connect devices" per account; a single sequential downloader does not approach this limit.

## 8. UI Changes

### 8.1 Spotify tab banner (disconnected)

When the friend opens the Spotify tab and `spotifyDirect.getStatus().connected === false`, a banner appears at the top of the panel, above the URL input:

```
┌────────────────────────────────────────────────────────────┐
│ 🎵 Conecte sua conta Spotify pra baixar em 320 kbps        │
│    Sem conectar, ainda funciona via YouTube (até 160 kbps) │
│                                       [ Conectar Spotify ] │
└────────────────────────────────────────────────────────────┘
```

The banner is dismissible with a small "×" in the corner. Dismissal writes `spotifyBannerDismissedAt` to `config.json` and suppresses the banner for 7 days. After 7 days, it reappears.

### 8.2 Spotify tab status pill (connected)

When connected:

```
✓ Conectado como guilherme@gmail.com  ·  Premium · 320 kbps      [Desconectar]
```

For Free users:

```
⚠ Conectado como amigo@gmail.com  ·  Free · 160 kbps (upgrade pra 320)  [Desconectar]
```

### 8.3 Settings dialog

A new section in the Settings dialog, between "Pasta de saída" and "Histórico":

```
Spotify Premium:
  ✓ Conectado como guilherme@gmail.com
  Plano: Premium (baixa em 320 kbps)
  [ Desconectar ]
```

When disconnected:

```
Spotify Premium:
  Não conectado.
  Sem conexão, downloads do Spotify usam YouTube.
  [ Conectar Spotify ]
```

### 8.4 OAuth-in-progress modal

When the user clicks "Conectar":

1. The button shows an inline spinner and the label "Abrindo navegador…" for ~1 second.
2. The default browser opens at the Spotify authorization URL.
3. The renderer shows a modal:

```
┌──────────────────────────────────────────┐
│ Aguardando autorização no Spotify…       │
│                                          │
│ Se você fechou o navegador sem querer,   │
│ clique em "Tentar de novo".              │
│                                          │
│       [ Tentar de novo ]  [ Cancelar ]   │
└──────────────────────────────────────────┘
```

4. On successful callback, the modal closes automatically. The browser tab shows a static success page ("Pode fechar essa aba ✅").
5. After 5 minutes without a callback, the modal switches to a "Tempo esgotado" state and the loopback server shuts down.

### 8.5 Renderer IPC events

The renderer subscribes via `window.api.spotifyAccount.onStatusChange(callback)`. Events:

| Event | When | UI effect |
|-------|------|-----------|
| `connecting` | "Conectar" was clicked, browser opened | Modal shown |
| `connected` | Callback received and tokens stored | Modal closed, banner → status pill |
| `disconnected` | User clicked "Desconectar", or token revoked mid-use | Status pill → banner |
| `connection-failed` | OAuth error (denied, timeout, network) | Modal switches to error message |

### 8.6 Summary screen breakdown

Plan A/B/C's summary screen shows "48 / 50 músicas baixadas". Plan D extends this with a per-source breakdown when the Spotify tab was the source:

```
                  48 / 50
              músicas baixadas
        
        ┌────────────────────────────┐
        │ 45 via Spotify             │
        │ 3 via YouTube (fallback)   │
        │ 2 não encontradas           │
        └────────────────────────────┘
        
        [ Ver pasta ]  [ Baixar outra playlist ]
```

If everything came from one source (all Spotify-direct, or all YouTube because not connected), the breakdown is collapsed to one line; no need to surface a zero count.

### 8.7 Unchanged elements

The per-track download icons (`↻`, `✓`, `✗`, `·`), the progress bar, the preview screen, and the cancel flow are identical to Plans A/B/C. The fallback between Spotify-direct and YouTube is invisible to the UI mid-download.

## 9. Errors, Configuration, Recovery

### 9.1 Tier 1 — silent and recoverable (auto-fallback)

- `TrackNotFoundOnSpotify` (catalog removal, dead link)
- `RegionLocked`
- `PremiumRequired` (Premium-only track for a Free account)
- `RateLimited` (HTTP 429; respect Retry-After once, then fall through)
- `ZotifyTransientError` (any non-zero exit code zotify produces that does not match a typed error)

Each appears in the per-source breakdown of the summary screen and the ID3 comment of the affected track. No modal, no banner, no log.

### 9.2 Tier 2 — recoverable by the user (UI surfaces it)

- `OAuthDenied` (user clicked "Cancel" on Spotify): modal switches to "Autorização cancelada. Tente de novo se mudar de ideia."
- `OAuthTimeout` (no callback within 5 minutes): modal switches to "Tempo esgotado."
- `AuthExpired` (refresh token revoked at Spotify or password change): app clears `spotify-auth.enc`, emits `disconnected`, banner reappears, next download falls back to YouTube. A one-time toast: "Sua conexão com o Spotify expirou. Reconecte pra voltar a baixar em alta qualidade."
- `LoopbackBindFailed` (cannot acquire any of three attempted ports): modal: "Não consegui abrir uma porta local para o login do Spotify. Feche outros apps que possam estar usando portas e tente de novo."

### 9.3 Tier 3 — unexpected (logged, UUID modal)

- `ZotifyBinaryMissing` (sidecar absent from bundle, e.g., build packaging error)
- `ZotifyUnrecognizedError` (exit code not mapped to a tier-1 or tier-2 error)
- `EncryptionFailed` (`safeStorage.encryptString` threw, e.g., Keychain access denied)

All three log to `logs/error-YYYY-MM-DD.log` with a short UUID and surface the existing Tier-3 modal: "Erro inesperado. Anote o código e mande pra quem te passou o app."

### 9.4 Configuration files

```
~/Library/Application Support/MusicDownloader/                (macOS)
%APPDATA%/MusicDownloader/                                    (Windows)
│
├── config.json
│   {
│     "outputDir": "...",
│     "firstRunCompleted": true,
│     "spotifyBannerDismissedAt": "2026-06-15T17:33:00Z"  ← NEW
│   }
│
├── spotify-auth.enc                                          ← NEW
│   (encrypted via safeStorage; contents below decrypted)
│   {
│     "refresh_token": "AQ...",
│     "email": "guilherme@gmail.com",
│     "product": "premium",
│     "savedAt": "2026-06-06T20:14:11Z"
│   }
│
└── (cache/, logs/, library.json: unchanged)
```

`spotifyBannerDismissedAt` is checked before rendering the banner. If less than 7 days have passed, the banner is suppressed for that session.

### 9.5 Recovery / consistency

The `library.json` skip-if-exists registry already tracks completed downloads by track hash. Plan D does not change the registry. A track that completed via Spotify-direct is registered exactly like a track that completed via YouTube; subsequent runs of the same playlist skip both.

If the app crashes mid-download with a Spotify-direct download in flight, the temp Ogg Vorbis file is orphaned in `os.tmpdir()`. On the next launch, no cleanup is required: the OS evicts `/tmp` periodically; on Windows, `%TEMP%` accumulates but does not block other downloads. The next playlist resume detects the track is not in the library, retries Spotify-direct, and proceeds.

## 10. Testing Strategy

### 10.1 Unit (Vitest)

- **PKCE crypto** (`generateCodeVerifier`, `codeChallenge`): round-trip against RFC 7636 examples.
- **OAuth URL builder**: query-string encoding, scope joining, state parameter included.
- **`storage/spotify-auth.js`**: encrypt → write → read → decrypt round-trip with `safeStorage` mocked to return a known buffer.
- **Token refresh logic**: given an expired in-memory token, calls Spotify's token endpoint with the stored refresh token, updates in-memory state, persists if a new refresh token is returned.
- **Provenance comment builder**: given `(actualSource, sourceCodec, sourceBitrateKbps, finalBitrateKbps, fallbackReason?)`, returns the correct comment string.
- **Summary breakdown formatter**: given a list of per-track results, returns the user-facing breakdown.

### 10.2 Integration (Vitest + nock)

- **Full OAuth happy path**: simulate clicking Connect → loopback server starts on a free port → nock intercepts the redirect → nock intercepts `POST /api/token` → token is saved → `/v1/me` mock returns Premium → status event fires `connected` with `{email, plan: 'premium'}`.
- **Token expired mid-download**: nock returns 401 for the first authenticated call, 200 for the refresh + retry. Verify the operation completes transparently.
- **Refresh token revoked**: nock returns 400 on refresh. Verify `spotify-auth.enc` is cleared and the `disconnected` event fires.
- **`state` mismatch on callback**: simulate a callback with the wrong `state` value. Verify the OAuth flow aborts and `OAuthDenied` (or a related typed error) is raised.

### 10.3 Subprocess mocking (zotify)

Same pattern Plan A used for `yt-dlp`: `spyOn(child_process, 'spawn')` and return a fake child process emitting stdout/stderr and an exit code. Tests cover:

- Exit code 0 with an output file present → pipeline advances to ffprobe.
- Exit code that maps to `TrackNotFoundOnSpotify` → pipeline falls back to YouTube.
- Exit code that maps to `AuthExpired` → emits `disconnected` and falls back.
- Spawn `error` event (binary missing on disk) → `ZotifyBinaryMissing` Tier-3.

### 10.4 End-to-end smoke (manual, before each release containing Plan D)

A Spotify Premium account owned by the project owner, plus a 5-track test playlist of known songs. Procedure:

1. Click **Conectar Spotify** → authorize in browser → verify status pill appears with the correct email and "Premium".
2. Paste the test playlist URL → download all 5 tracks.
3. For each MP3:
   - Open in Spek → verify spectral content reaches at least 18–20 kHz.
   - File size is in the 8–20 MB range for typical lengths.
   - ID3 comment reads `Source: Spotify Ogg Vorbis 320kbps → MP3 320kbps`.
   - Filename follows the established format.
4. Click **Desconectar** → verify banner reappears.
5. Reconnect → verify it does not re-prompt for login (refresh token reused) and lands directly back on the status pill.
6. Manually invalidate the OAuth client (toggle redirect URI in Spotify Dashboard) → try to connect → verify a clear Tier-2 error appears in the modal.

### 10.5 Spike (Task 1 of Plan D)

A focused 2-3 hour spike, executed before any other Plan D work begins, validates the zotify-auth bridge:

- Authenticate to Spotify via the PKCE flow described in Section 6, in a throwaway script (not yet wired into the app).
- Feed the resulting access token to `zotify` via at least one of the three approaches (file location, CLI flag/env var, librespot-auth converter).
- Download a known track at 320 kbps as Ogg Vorbis.
- Confirm zotify exits 0 and writes a parseable file.

If none of the approaches work, the plan pauses and the design document is updated to switch to bundling librespot directly with custom auth orchestration (Approach B in the brainstorm).

### 10.6 Not tested automatically

- Real browser opening (covered by manual smoke).
- Loopback HTTP server against real local ports (covered by integration tests with mocked HTTP and by manual smoke).
- zotify against live Spotify in CI. Test account quotas and protocol risk outweigh the benefit; manual smoke is sufficient.

## 11. Dependencies & External Risks

### 11.1 Per-OS zotify binaries

The project must produce or obtain single-file zotify executables for `mac-arm64`, `mac-x64`, and `win-x64`. Two paths:

- Use prebuilt releases from the upstream zotify project if available for all three targets.
- Build them from source via PyInstaller in CI on the matching runner OS, pinning a known-good zotify commit. This is the safer path because zotify upstream has historically not maintained binary releases for all platforms consistently.

CI integration: `scripts/fetch-binaries.js` is extended to include zotify, with `--platform=mac` downloading both arm64 and x64 builds, and `--platform=win` downloading the Windows build.

### 11.2 zotify upstream churn

zotify follows changes to Spotify's protocol via librespot. Both projects are active but have, historically, had multi-week windows of brokenness after major Spotify changes. Plan D's design isolates zotify behind `spotify-direct/index.js`; when zotify breaks, the YouTube fallback keeps the app functional. The project owner pins a known-good zotify version per release and updates it deliberately, after smoke testing.

### 11.3 Spotify protocol changes

Spotify has historically not actively pursued individual users of librespot or its wrappers, including high-profile projects like `spotdl` that exist openly on GitHub. The legal exposure profile for distributing this app to friends is no greater than v0.1.x's existing exposure for using the Spotify Web API to read playlist metadata. Both are technically ToS violations; neither has produced enforcement against individual users at this scale.

Spotify could, in any given month, change the streaming protocol in a way that breaks librespot. Plan D's fallback to YouTube ensures the app keeps working through such windows.

### 11.4 GitHub Secret addition

A new secret, `SPOTIFY_OAUTH_CLIENT_ID`, is added to the PROD environment in the GitHub repository settings. `scripts/embed-spotify.js` is extended to recognize this key and inject it as a third field (`oauthClientId`) in the generated `main/spotify-creds.js`. The existing placeholder guardrail rejects empty or placeholder values for this key as well.

## 12. Open Questions / Future Work

- **Plan E — custom librespot wrapper**: if zotify becomes unmaintained, or its bundle size becomes a real complaint from friends, replace the sidecar with a thin Rust wrapper around `librespot` and own the integration end to end. The design contract in Section 4 (`spotify-direct/index.js` facade) is intentionally implementation-agnostic to make this swap small.
- **Discogs enrichment for non-Spotify sources**: still deferred from the original spec. Plan D does not change this.
- **Apple Music re-introduction**: still deferred from the original spec.
- **Multi-friend concurrent downloads from same account**: out of scope. Each friend has their own Spotify account and runs the app locally; concurrency between friends is not coordinated.
- **Auto-update**: still deferred from the original spec. If friends start downloading new releases regularly, `electron-updater` becomes worth considering.

## 13. Migration from v0.1.x

Plan D is purely additive. Friends running v0.1.x receive v0.2.0 (which ships Plan D), open the app, see the new banner on the Spotify tab, and may choose to connect or ignore. If they ignore, the app behaves exactly as v0.1.x did. If they connect, subsequent Spotify-tab downloads use the new path.

No data migration is required. `config.json` simply gains an optional new key (`spotifyBannerDismissedAt`); older versions ignore it cleanly. The library, downloaded files, and userData layout are unchanged.
