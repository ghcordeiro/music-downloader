# Music Downloader — Design Document

**Date:** 2026-06-06
**Status:** Approved by user; ready for implementation planning
**Supersedes:** Current `apple-playlist-downloader` repo (Apple Music + Spotify CLI tool)

---

## 1. Context

The current project (`apple-playlist-downloader`) is a Node.js CLI that downloads Apple Music and Spotify playlists by scraping metadata and fetching audio from YouTube. It requires `npm install`, terminal use, and (for Spotify) manual creation of API credentials at the Spotify Developer Dashboard. That setup excludes non-technical users.

This redesign turns the project into a desktop application distributed to **non-technical friends**. The friend downloads a single installer, double-clicks, and uses a window-based UI. No terminal, no `npm`, no Spotify dashboard.

The DJ workflow context is preserved: filenames follow the `Artist - Title (Mix) [Label]` convention common in Rekordbox/Traktor libraries, and ID3 tags are written completely.

## 2. Goals

- A friend with zero programming knowledge can install and use the app on macOS or Windows.
- Three platforms supported in MVP: **Spotify, YouTube, SoundCloud** (single tracks and playlists).
- Audio is saved as **MP3 at the source bitrate** (no artificial inflation), with ID3 tags including title, artist, album (= playlist name), track number, year, label, ISRC when available, genre when available, and embedded cover art.
- Filename format: `{Artist} - {Title} ({MixType}) [{Label}].mp3`, with graceful degradation when fields are missing.
- The download pipeline is resilient: a single failed track does not stop the playlist; missing metadata does not stop the file from being saved.
- The user (project owner) can ship a first usable version in 2–3 weekends.

## 3. Non-Goals (Explicitly Out of Scope)

- **Apple Music** (kept in code today, removed from MVP). The 558-line scraper is fragile and Apple changes the HTML frequently. May be re-added later as a separate `platforms/applemusic.js` module if proven useful.
- **Beatport and other paid music stores.** Their full audio is gated behind purchase + DRM. Without login and purchase, only 2-minute previews are accessible. Out of MVP and likely out of scope permanently.
- **Public web hosting.** The app is local-only — distributed as an installer, not as a hosted service. This is a deliberate legal-exposure choice.
- **Auto-detection of platform from URL.** The user clicks the platform tab first. This avoids fragile URL-pattern detection.
- **Configurable audio bitrate UI.** The app always converts to MP3 at the detected source bitrate. No dropdown, no settings page for it. This reduces decisions for the non-technical user.
- **Authentication for the friend** (no login, no account). Spotify Web API credentials are embedded in the build.
- **Discogs integration in MVP.** MusicBrainz covers label lookup for non-Spotify sources. Discogs may be added post-MVP if MusicBrainz coverage proves insufficient for electronic music.
- **Code signing in MVP.** The app ships unsigned with clear instructions for friends ("right-click → Open" on macOS, "More info → Run anyway" on Windows). Apple Developer Program ($99/yr) is a possible future addition.

## 4. Stack & High-Level Architecture

- **Electron** for cross-platform desktop (macOS + Windows).
- **Main process** (Node.js): file system access, subprocess spawning, HTTP calls, business logic. Evolves the existing JavaScript code.
- **Renderer process** (Chromium): UI only. Vanilla HTML/CSS/JS, no frontend framework. The app is simple enough that React/Svelte would add ceremony without benefit.
- **Preload script** + `contextBridge`: secure, narrow exposure of main APIs to renderer. Renderer never gets direct access to `fs` or `child_process`.

**Embedded sidecars:**
- `yt-dlp` (~30 MB) — handles YouTube and SoundCloud metadata and audio download.
- `ffmpeg` (~80 MB) — handles audio re-container/re-encode to MP3 and probes source bitrate via `ffprobe`.

**Final installer size:** ~150 MB. The user accepted this after reviewing alternatives (Tauri reduces by only ~20 MB once sidecars are factored in; Neutralino is less mature; Node SEA has a confusing browser-tab UX).

## 5. Folder Structure

```
music-downloader/
├── package.json
├── electron-builder.yml          # build config for .dmg and .exe
│
├── main/                         # Node.js main process
│   ├── index.js                  # Electron bootstrap, window creation
│   ├── ipc.js                    # IPC handler registry; delegates to modules
│   ├── preload.js                # contextBridge: exposes window.api.*
│   ├── platforms/
│   │   ├── youtube.js            # URL → {playlistName, coverUrl, tracks}
│   │   ├── soundcloud.js         # same contract
│   │   └── spotify.js            # same contract; uses embedded credentials
│   ├── download/
│   │   ├── pipeline.js           # orchestrates: search → download → enrich → tag
│   │   └── ytdlp.js              # wrapper around yt-dlp binary
│   ├── enrichment.js             # MusicBrainz lookup with disk cache
│   ├── tagging.js                # writes complete ID3 tags
│   ├── filename.js               # pure functions: parse mix type, build filename
│   ├── storage/
│   │   ├── config.js             # ~/Application Support/.../config.json
│   │   ├── library.js            # tracks already-downloaded hashes
│   │   └── paths.js              # cross-platform path helpers, binary resolution
│   └── errors.js                 # error classes with Portuguese user messages
│
├── renderer/                     # Frontend (Chromium)
│   ├── index.html
│   ├── styles.css
│   ├── main.js                   # tab routing, global state
│   └── tabs/
│       ├── spotify.js
│       ├── youtube.js
│       └── soundcloud.js
│
├── binaries/                     # sidecars per OS/arch
│   ├── mac-arm64/  (yt-dlp, ffmpeg, ffprobe)
│   ├── mac-x64/    (yt-dlp, ffmpeg, ffprobe)
│   └── win-x64/    (yt-dlp.exe, ffmpeg.exe, ffprobe.exe)
│
└── assets/
    └── icon.png / icon.icns / icon.ico
```

**Isolation principle:** each `platforms/*.js` is an island. It receives a URL and returns a `{playlistName, coverUrl, tracks[]}` shape. It does not know about downloading. The download pipeline does not know which platform the tracks came from. When a platform breaks (and they will), only its file is affected.

## 6. User Interface

The window has three tabs at the top: **Spotify**, **YouTube**, **SoundCloud**, each colored to its brand. Each tab is a self-contained flow with five states:

| # | State | What the user sees |
|---|-------|--------------------|
| 1 | Empty | URL input with platform-specific placeholder; "Buscar" button. |
| 2 | Loading metadata | Spinner after "Buscar" is clicked. |
| 3 | Preview | Playlist name, cover, track count, total duration; "Cancelar" and "Baixar N músicas" buttons. |
| 4 | Downloading | Overall progress bar (`12 / 50`); scrollable per-track list with status icons (`✓` done, `↻` in progress, blank = queued, `✗` not found). "Cancelar" button. |
| 5 | Done | Summary card (`48 / 50`), warning about not-found tracks, "Ver pasta" (opens Finder/Explorer) and "Baixar outra playlist" buttons. |

**First-run flow:** the first time the app opens, a welcome screen asks where to save music. Default: `~/Music/Music Downloader/`. Stored in config; never asked again unless the user goes into settings.

**Settings:** a gear icon in the top-right. Contains only: output folder. No bitrate, no genre tagging toggle, no advanced options — keeping the surface minimal for non-technical users.

**Single-track vs. playlist:** the same UI handles both. If the URL points to a single track, the preview shows "1 música" and a single-row download.

**Design choices excluded by intent:**
- No download history UI (the output folder is the history).
- No queue across multiple playlists (download one at a time per tab; tabs are independent).
- No URL auto-detection (the tab determines the platform).

## 7. Backend Modules

Each module is described by **what it does, how you use it, and what it depends on**.

### `main/index.js` — Electron bootstrap
- **What:** opens the BrowserWindow, loads `renderer/index.html`, registers IPC handlers, installs `before-quit` handler that cancels in-flight downloads cleanly.
- **Depends on:** `electron`, `ipc.js`.

### `main/preload.js` — secure bridge
- **What:** exposes `window.api` to the renderer via `contextBridge`. The renderer can call `window.api.spotify.fetchPlaylist(url)`, `window.api.download.start(...)`, `window.api.config.get()`, `window.api.shell.openFolder(path)`, and subscribe to `window.api.download.onProgress(callback)`.
- **Does not:** expose `fs`, `child_process`, or any unsanitized native APIs.
- **Depends on:** `electron`.

### `main/ipc.js` — IPC router
- **What:** registers `ipcMain.handle(...)` for each channel; validates input; delegates to the correct module.
- **Does not:** contain business logic.
- **Depends on:** `platforms/*`, `download/pipeline`, `storage/config`.

### `main/platforms/spotify.js`
- **What:** input: a Spotify URL (playlist, album, track, or `spotify.link/...` shortened). Output: `{playlistName, coverUrl, tracks: [{name, artist, durationSec, coverUrl, isrc, year, label}]}`.
- **How:**
  - Resolves shortened URLs via HEAD redirect.
  - Extracts ID from `open.spotify.com/{type}/{id}`.
  - Gets access token via Client Credentials Flow; caches in memory until expiry.
  - Calls `/v1/playlists/{id}` (or `/albums/{id}`, `/tracks/{id}`), paginates `next` for playlists > 100 tracks.
  - Batches `/v1/albums?ids=...` (20 per call) to fetch label for each unique album.
- **Depends on:** `axios`, embedded credentials (build-time `process.env`).

### `main/platforms/youtube.js`
- **What:** same contract. Handles single videos and playlists. Channels are rejected with a friendly error.
- **How:** `yt-dlp --dump-json --flat-playlist <url>` for fast metadata.
- **Depends on:** `yt-dlp` (via `download/ytdlp.js`).

### `main/platforms/soundcloud.js`
- **What:** same contract.
- **How:** `yt-dlp` natively supports SoundCloud. Same approach as YouTube.
- **Depends on:** `yt-dlp`.

### `main/download/pipeline.js` — orchestrator
- **What:** input: `{platform, playlistName, tracks[], outputDir, signal}`. Output: `{ok: [...], failed: [{track, reason}]}`. Emits progress events during the run.
- **For each track, in sequence:**
  1. Compute track hash; if `library.has(hash)`, emit `skipped`, continue.
  2. **Search:** for Spotify/SoundCloud-via-search and any case without a direct URL, run `yt-dlp "ytsearch1:{artist} - {name}" --dump-json`. If no result, emit `not_found`, continue.
  3. **Download:** `yt-dlp -f bestaudio -o /tmp/{uuid}.%(ext)s <videoURL>`.
  4. **Probe source bitrate:** `ffprobe -v error -show_streams /tmp/{uuid}.opus`.
  5. **Convert:** `ffmpeg -i /tmp/{uuid}.opus -c:a libmp3lame -b:a {sourceBitrate}k {outputPath}`.
  6. **Enrich:** if metadata is incomplete (YouTube/SoundCloud sources), call `enrichment.lookup({artist, title, isrc})` for label/year/genre.
  7. **Tag:** call `tagging.write(mp3Path, tags)`.
  8. **Register:** `library.register(playlistHash, trackHash)`; delete `/tmp/{uuid}.opus`.
  9. Emit `done`.
- **Cancellable:** accepts an `AbortSignal`. When triggered, kills the active `yt-dlp` / `ffmpeg` subprocess and deletes any partial `/tmp` file.
- **Sequential** (not parallel): YouTube rate-limits aggressive parallel searches, and MusicBrainz is hard-limited to 1 req/sec.
- **Depends on:** `ytdlp.js`, `enrichment.js`, `tagging.js`, `filename.js`, `storage/library.js`, `storage/paths.js`.

### `main/download/ytdlp.js` — binary wrapper
- **What:** functions `searchAndGetVideoUrl(query)`, `downloadAudio(url, outputTemplate, signal)`, `getPlaylistMetadata(url)`. Each spawns the `yt-dlp` subprocess and parses output.
- **Resolves binary path** automatically based on `process.platform` and `process.arch`.
- **Depends on:** binaries in `binaries/`.

### `main/enrichment.js` — MusicBrainz lookup with cache
- **What:** input: `{artist, title, isrc?}`. Output: `{label, year, genre, isrc, mbid} | null`.
- **How:**
  - If `isrc` provided (from Spotify): direct lookup by ISRC → exact match.
  - Otherwise: `release/?query=artist:{artist} AND recording:{title}` → take best match by score.
  - Hash key for cache: `sha1(isrc || `${artist}::${title}`)`. Cached responses live in `cache/musicbrainz/{hash}.json`.
- **Respects** MusicBrainz rate limit of 1 req/sec via an in-process throttle.
- **Returns null** on no match; pipeline tags the file with whatever it already has.
- **Depends on:** `axios`, `storage/paths.js`.

### `main/tagging.js` — ID3 writer
- **What:** writes a complete set of ID3 tags to the MP3 file.
- **Always writes:** title (clean, without mix), artist, album (= playlist name), albumArtist, trackNumber (`NN/total`), comment (source provenance — see below).
- **Writes when available:** subtitle (= mix type), year, publisher (= label), genre, ISRC, embedded cover art.
- **Comment field (provenance):** e.g., `Source: YouTube Opus 251kbps → MP3 251kbps | MB: <mbid>`. Lets the user (DJ) tell honestly later which files came from where and at what real quality.
- **Depends on:** `node-id3`.

### `main/filename.js` — pure functions
- **What:** `parseMixType(title) → {cleanTitle, mixType | null}` and `buildFilename({artist, title, mixType, label}) → string`.
- **Mix detection:** regex on the end of the title looking for `(Original Mix)`, `(Extended Mix)`, `(Extended)`, `(Radio Edit)`, `(Club Mix)`, `(Dub Mix)`, `(Acoustic)`, `(Live)`, `(<X> Remix)`, `(<X>'s Remix)`, and `- Original Mix` style suffixes. Variations are normalized (e.g., `(Extended)` → "Extended Mix").
- **Never assumes "Original Mix"** when not detected. Pop tracks would otherwise get a wrong mix label.
- **Filename assembly with graceful degradation:**
  - All fields: `Daft Punk - Around the World (Original Mix) [Virgin].mp3`
  - No mix: `Daft Punk - Around the World [Virgin].mp3`
  - No label: `Disclosure - Latch (Extended Mix).mp3`
  - Neither: `Beyoncé - Halo.mp3`
- After assembly, applies platform-specific sanitization from `storage/paths.js` (removes illegal characters, enforces length).
- **Depends on:** `storage/paths.js`.

### `main/storage/config.js`
- **What:** read/write `config.json` containing `outputDir`, `firstRunCompleted`.
- **Path:** `app.getPath('userData')`.
- **Depends on:** `electron.app`, `fs`.

### `main/storage/library.js`
- **What:** prevents re-download. Stores `{playlistHash → [trackHashes]}` in `library.json`. Methods: `has(playlistHash, trackHash)`, `register(playlistHash, trackHash)`.
- **Hashes:** `sha1(artist + title)` for tracks; `sha1(platform + sourceUrl)` for playlists.
- **Depends on:** `fs`.

### `main/storage/paths.js`
- **What:** cross-platform path and filename helpers.
- **Exports:** `sanitizeFilename(name)`, `resolveBinary(name)` (returns absolute path to OS/arch-specific binary), `revealInExplorer(path)` (opens Finder/Explorer at a folder), `truncateForOS(path)` (enforces 260-char limit on Windows).
- **Depends on:** `path`, `child_process`, `process.platform`, `process.arch`.

### `main/errors.js`
- **What:** typed error classes: `SpotifyAuthError`, `PlaylistNotFound`, `NetworkError`, `BinaryMissing`, `DiskFull`, `InvalidUrl`, `UnexpectedError`. Each has a `userMessage` property in Portuguese for the UI.

## 8. Data Flow — Spotify Playlist Download (Canonical Example)

### Phase A — Fetch metadata (~1s)

1. Renderer calls `window.api.spotify.fetchPlaylist(url)`.
2. Preload → IPC → `ipc.js` handler validates URL pattern, delegates to `platforms/spotify.js`.
3. `spotify.js`:
   - Resolves `spotify.link/...` if needed.
   - Extracts playlist ID.
   - Gets or refreshes access token.
   - Calls `/v1/playlists/{id}`, paginates if necessary.
   - Batches `/v1/albums?ids=...` for label per album.
4. Returns `{playlistName, coverUrl, tracks[]}` to renderer.
5. Renderer transitions to **Preview** state.

### Phase B — Download (30s–10min)

6. User clicks "Baixar". Renderer calls `window.api.download.start({...})`; subscribes to `onProgress`.
7. `pipeline.js` creates `{outputDir}/{sanitize(playlistName)}/`.
8. For each track, runs steps 1–9 of the orchestrator (see Section 7).
9. Renderer receives progress events, updates per-track list and overall bar.
10. Pipeline returns `{ok, failed}`; renderer shows **Done** state with summary.

### IPC Progress Event Contract

The pipeline emits four event types only:

| Event | Payload | UI effect |
|-------|---------|-----------|
| `started` | `{trackIdx, name, artist}` | row shows ↻ spinner |
| `done` | `{trackIdx}` | row shows ✓ |
| `not_found` | `{trackIdx, reason}` | row shows ✗ red |
| `skipped` | `{trackIdx}` | row shows "já existe" |

### YouTube and SoundCloud

Identical from step 7 onward. Phase A differs: `platforms/youtube.js` and `platforms/soundcloud.js` use `yt-dlp --flat-playlist` and receive direct video URLs, so the pipeline can skip the YouTube-search step within step 2 of the orchestrator.

## 9. Filename & Metadata Specification

### Filename format
```
{Artist} - {Title} ({MixType}) [{Label}].mp3
```

**Examples:**
- Full data: `Daft Punk - Around the World (Original Mix) [Virgin].mp3`
- No mix detected: `Daft Punk - Around the World [Virgin].mp3`
- No label found: `Disclosure - Latch (Extended Mix).mp3`
- Neither: `Beyoncé - Halo.mp3`

### Mix type sources

Parsed by regex from the track title. Recognized patterns include parenthesized suffixes (`(Original Mix)`, `(Extended Mix)`, `(Extended)`, `(Radio Edit)`, `(Club Mix)`, `(Dub Mix)`, `(Acoustic)`, `(Live)`, `(<X>'s Remix)`, `(<X> Remix)`) and dash-suffix forms (`- Original Mix`, `- Extended Mix`). Normalization rules:
- `(Extended)` → "Extended Mix"
- `(Radio Edit)` → "Radio Edit"
- `(<X>'s Remix)` and `(<X> Remix)` → preserved as-is

When no pattern matches, `mixType` is `null` and the parenthesized group is omitted from the filename.

### Label sources

| Platform | Label source |
|----------|--------------|
| Spotify  | `/v1/albums?ids=...` (`label` field) |
| YouTube  | MusicBrainz lookup (via `enrichment.js`) |
| SoundCloud | MusicBrainz lookup |

When no label is found, the bracketed group is omitted.

### ID3 tags written

| Tag | Source |
|-----|--------|
| title (TIT2) | clean title (without mix suffix) |
| subtitle (TIT3) | mix type when present (e.g., "Original Mix", "Extended Mix"). Omitted when null. |
| artist (TPE1) | track artist |
| album (TALB) | playlist name |
| albumArtist (TPE2) | "Various Artists" for playlists; single artist for albums |
| trackNumber (TRCK) | `N/total` |
| year (TYER) | Spotify release date / MusicBrainz first release |
| publisher (TPUB) | label (Spotify or MusicBrainz) |
| genre (TCON) | MusicBrainz tags (when available) |
| ISRC (TSRC) | Spotify / MusicBrainz |
| Cover art (APIC) | Spotify cover (preferred) / YouTube thumbnail / MusicBrainz cover archive |
| Comment (COMM) | provenance string (see below) |

Splitting the mix into TIT3 (instead of leaving it inside the title) matches how Rekordbox, Traktor, and Engine DJ display tracks: the main title field stays readable, and the mix variant is shown as a subtitle hint.

**Provenance comment** (`comment` field, language `eng`): `Source: <platform> <codec> <bitrate>kbps → MP3 <bitrate>kbps | MB: <mbid>`. Lets the project owner (a DJ) honestly tell later what the real source quality was.

## 10. Errors, Configuration, Recovery

### Error taxonomy

**Tier 1 — Recoverable silently** (pipeline continues, reports in final summary):
- Track not found on YouTube → added to `failed` with reason `not_found`.
- Spotify 429 → respect `Retry-After`, retry.
- Token expired (401) → refresh and retry once.
- MusicBrainz lookup failed → proceed without enrichment.
- Cover image download failed → proceed without embedded cover.

**Tier 2 — Recoverable by user** (clear inline message in Portuguese, action provided):
- Invalid URL → "Esse link não parece ser do Spotify" under the input.
- Output folder unwritable → "Não consigo escrever em {X}, escolha outra pasta".
- No internet → toast "Sem internet, verifique sua conexão" + "Tentar de novo" button.
- Disk full → modal "Espaço insuficiente. Libere espaço e tente novamente".

**Tier 3 — Unexpected (logged for the project owner)**:
- Missing or corrupt `yt-dlp` / `ffmpeg`.
- Spotify credentials revoked.
- Unhandled bug.
→ Logged to `logs/error-YYYY-MM-DD.log`; modal shows "Erro inesperado. Código: {short-uuid}" so the friend can copy a short ID.

**No stack traces are shown to the user, ever.** All UI messages are in Portuguese without technical jargon.

### Configuration

```
~/Library/Application Support/MusicDownloader/   (macOS)
%APPDATA%/MusicDownloader/                        (Windows)
│
├── config.json              # outputDir, firstRunCompleted
├── spotify-token.json       # cached access token + expiry
├── library.json             # {playlistHash → [trackHashes]}
├── cache/
│   └── musicbrainz/         # {hash}.json per lookup
└── logs/
    ├── app.log              # rotates at 5 MB
    └── error-YYYY-MM-DD.log # tier-3 errors only
```

**Why cache MusicBrainz:** 1 req/sec limit means 50 tracks = 50s of lookups. Caching makes subsequent runs (and future playlists sharing artists) effectively instant.

### Crash recovery

No explicit "resume session" feature is needed. `library.json` records each successfully completed track. After a crash or unexpected close:
- The user reopens the app, pastes the same URL, sees the preview again.
- Clicks "Baixar".
- The pipeline detects already-completed tracks via `library.has(...)`, skips them, downloads only the remainder.

The UI in this case shows a banner: "30 já baixadas, vou baixar as 20 restantes." This is a natural consequence of skip-if-exists; no extra state machine.

## 11. Testing Strategy

### Unit (Vitest)

Pure or near-pure functions, fast and deterministic.

- **`filename.js`**:
  - Mix parsing across all recognized patterns + edge cases (multiple parens, parens inside title)
  - Graceful filename degradation across all combinations of present/absent fields
  - Sanitization of illegal characters per platform
- **`platforms/spotify.js`**: URL parser (playlist, album, track, shortened, with `?si=...` query).
- **`enrichment.js`**: response parsing from MusicBrainz fixtures (label/year/genre/ISRC extraction).
- **`storage/library.js`**: hash + has + register round-trip.

### Integration (Vitest + nock)

HTTP-mocked, deterministic.

- **Spotify API**: pagination over `next` cursor, 429 with `Retry-After` handling, 401 token refresh flow.
- **MusicBrainz**: hit + miss + cached hit (verifies cache writes and reads).

### End-to-end smoke (manual, before each release)

A fixed 3-track test playlist owned by the user, plus equivalent test URLs for YouTube and SoundCloud. Smoke checklist:
1. Filenames match the format spec.
2. ID3 tags are complete, verified in MusicBrainz Picard or another ID3 inspector.
3. Cover art embeds correctly.
4. Re-running with the same URL produces zero new downloads.
5. Cancelling mid-download cleans up `/tmp` and leaves the registered tracks intact.

### Not tested automatically

- The end-to-end `download/pipeline.js` against real `yt-dlp` and live network — covered by manual smoke.
- The Electron renderer UI — simple enough that a state-machine test framework adds more risk than value. Covered by manual smoke.

## 12. Cross-Platform Concerns

| Concern | macOS | Windows |
|---------|-------|---------|
| Path separator | `/` | `\` (always via `path.join`) |
| Illegal filename chars | mostly tolerant | `< > : " / \ \| ? *` forbidden |
| Path length limit | ~1024 | **260 chars (MAX_PATH)** — truncate filename if exceeded |
| Default text encoding | UTF-8 | force UTF-8 when writing |
| `yt-dlp` binary name | `yt-dlp` | `yt-dlp.exe` |
| "Open folder" action | `open <dir>` | `explorer <dir>` |
| Notarization needed | yes, to avoid Gatekeeper warning (deferred) | not present; "Unknown publisher" warning shown |

All OS-specific logic is concentrated in `main/storage/paths.js`. The rest of the code is OS-agnostic.

## 13. Distribution

- **Build tool:** `electron-builder`.
- **macOS:** `.dmg` for Intel and Apple Silicon (two builds, both shipped).
- **Windows:** `.exe` installer (NSIS).
- **Sidecars** are downloaded once at `postinstall` time during development and included in the build. A small `scripts/fetch-binaries.js` handles this so the repo does not contain large binaries.
- **Spotify credentials** are read from `.env` at build time and inlined into the bundle. `.env` is git-ignored. A `.env.example` is committed.
- **Unsigned distribution** initially. The release notes include short instructions:
  - macOS: "Se aparecer 'Não foi possível verificar o desenvolvedor', clique com o botão direito no app e escolha Abrir."
  - Windows: "Se aparecer 'O Windows protegeu seu PC', clique em 'Mais informações' e depois 'Executar mesmo assim'."

## 14. Open Questions / Future Work

- **Apple Music re-introduction:** if/when the project owner finds it valuable enough to invest in keeping the scraper alive, a new `platforms/applemusic.js` adheres to the same contract; a fourth tab is added; no other code changes needed.
- **Discogs integration:** if MusicBrainz coverage proves weak for electronic music, add `enrichment-discogs.js` as a preferred source. Requires the owner to embed a Discogs personal access token.
- **Notarization & code signing:** if friends report Gatekeeper friction in practice, the owner can pay for Apple Developer Program ($99/yr) and the `electron-builder` config flips a flag.
- **Multi-playlist queue:** explicitly out of MVP. If demanded later, the orchestrator already supports it conceptually (one playlist per pipeline invocation; a queue is just a list of invocations).
- **Self-update:** Electron supports it via `electron-updater`. Deferred until friends report the install/update friction.

## 15. Migration from Current Codebase

The current `apple-playlist-downloader` repo contains reusable pieces but no Electron scaffolding. The implementation plan should:

1. Initialize the Electron project structure on a new branch (`music-downloader-electron`) in the existing repo, so commits and PR reviews stay traceable against the current code.
2. Port `getSpotifyPlaylist.js` → `main/platforms/spotify.js`, adding the album label batch call.
3. Port `getDownloadLink.js` and the download logic of `app.js` → `main/download/`, splitting into `pipeline.js` and `ytdlp.js`.
4. Port ID3 tag writing → `main/tagging.js`, adding ISRC, label, genre, and the honest provenance comment.
5. Add new modules from scratch: `main/platforms/youtube.js`, `main/platforms/soundcloud.js`, `main/enrichment.js`, `main/filename.js`, `main/storage/{config,library,paths}.js`, `main/errors.js`.
6. Build the renderer from scratch following Section 6.
7. Remove `app.js`, `app-spotify.js`, `src/getPlaylist.js` (Apple Music) once Electron flow is verified.

Apple Music code is removed in MVP. It can return later as a new module without disturbing the rest.
