const { ipcMain, dialog, safeStorage } = require('electron');
const path = require('node:path');
const fsp = require('node:fs/promises');
const fssync = require('node:fs');
const { parseSpotifyUrl, createSpotifyClient } = require('./platforms/spotify.js');
const youtube = require('./platforms/youtube.js');
const soundcloud = require('./platforms/soundcloud.js');
const { createPipeline } = require('./download/pipeline.js');
const ytdlp = require('./download/ytdlp.js');
const ffmpeg = require('./download/ffmpeg.js');
const { writeTags } = require('./tagging.js');
const { buildFilename, parseMixType } = require('./filename.js');
const { revealInExplorer } = require('./storage/paths.js');
const { createEnrichment } = require('./enrichment.js');
const { createLibrary, hashPlaylist, hashTrack } = require('./storage/library.js');
const errors = require('./errors.js');
const { createSpotifyDirect } = require('./spotify-direct/index.js');
const { createSpotifyAuthStore } = require('./storage/spotify-auth.js');

let activeAbort = null;

function broadcast(win, channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

function makeLogger(userDataDir) {
  const logsDir = path.join(userDataDir, 'logs');
  fssync.mkdirSync(logsDir, { recursive: true });
  const errFile = path.join(logsDir, `error-${new Date().toISOString().slice(0, 10)}.log`);
  return (err, ref) => {
    const line = `${new Date().toISOString()} [${ref || '------'}] ${err?.stack || err?.message || String(err)}\n`;
    try { fssync.appendFileSync(errFile, line); } catch { /* ignore */ }
  };
}

function registerIpc({ config, window, userDataDir }) {
  const { loadSpotifyCreds } = require('./load-spotify-creds.js');
  const creds = loadSpotifyCreds();
  const spotifyClient = createSpotifyClient(creds);

  const spotifyDirectStore = createSpotifyAuthStore(userDataDir, safeStorage);
  const spotifyDirect = createSpotifyDirect({
    store: spotifyDirectStore,
    clientIdProvider: () => creds.oauthClientId || creds.clientId,
    redirectUriProvider: () => creds.oauthRedirectUri || process.env.SPOTIFY_OAUTH_REDIRECT_URI || null,
    callbackPortProvider: () => {
      // Fixed loopback port (default 8888). Register http://127.0.0.1:8888/callback
      // in the Spotify dashboard. A fixed port matches deterministically; Spotify's
      // dynamic-port loopback match proved unreliable ("Not matching configuration").
      const raw = creds.oauthCallbackPort || process.env.SPOTIFY_OAUTH_CALLBACK_PORT || '8888';
      const n = parseInt(raw, 10);
      return Number.isFinite(n) && n > 0 ? n : 8888;
    },
  });

  spotifyDirect.on('status-changed', (payload) => {
    broadcast(window, 'spotify:status-changed', payload);
  });

  const enrichment = createEnrichment({
    cacheDir: path.join(userDataDir, 'cache', 'musicbrainz'),
    userAgent: 'MusicDownloader/0.1 (https://github.com/yourrepo)',
  });

  const library = createLibrary(userDataDir);

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

  ipcMain.handle('config:get', () => config.get());
  ipcMain.handle('config:set', (_e, value) => config.set(value));

  ipcMain.handle('dialog:pickFolder', async (_e, current) => {
    const result = await dialog.showOpenDialog({
      defaultPath: current,
      properties: ['openDirectory', 'createDirectory'],
      title: 'Onde salvar as músicas?',
    });
    if (result.canceled || result.filePaths.length === 0) return { ok: false };
    return { ok: true, path: result.filePaths[0] };
  });

  ipcMain.handle('library:reset', async () => {
    try {
      await fsp.unlink(path.join(userDataDir, 'library.json'));
    } catch { /* file may not exist */ }
    return { ok: true };
  });

  ipcMain.handle('spotify:status', async () => spotifyDirect.getStatus());

  ipcMain.handle('spotify:connect', async () => {
    try { return { ok: true, data: await spotifyDirect.connect() }; }
    catch (err) { return errorPayload(err); }
  });

  ipcMain.handle('spotify:disconnect', async () => {
    await spotifyDirect.disconnect();
    return { ok: true };
  });

  ipcMain.handle('spotify:fetch', async (_e, url) => {
    try {
      const parsed = parseSpotifyUrl(url);
      const data = await spotifyClient.fetchPlaylist(parsed);
      const enriched = await spotifyClient.attachAlbumLabels(data.tracks);
      return { ok: true, data: { ...data, tracks: enriched, platform: 'spotify', sourceId: parsed.id } };
    } catch (err) {
      return errorPayload(err);
    }
  });

  ipcMain.handle('youtube:fetch', async (_e, url) => {
    try {
      const parsed = youtube.parseYouTubeUrl(url);
      const data = await youtube.fetchPlaylistOrVideo(parsed);
      return { ok: true, data: { ...data, platform: 'youtube', sourceId: parsed.id } };
    } catch (err) {
      return errorPayload(err);
    }
  });

  ipcMain.handle('soundcloud:fetch', async (_e, url) => {
    try {
      const parsed = soundcloud.parseSoundCloudUrl(url);
      const data = await soundcloud.fetchPlaylistOrTrack(parsed);
      return { ok: true, data: { ...data, platform: 'soundcloud', sourceId: parsed.url } };
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

  ipcMain.handle('download:cancel', () => {
    if (activeAbort) activeAbort.abort();
    return { ok: true };
  });

  ipcMain.handle('shell:openFolder', (_e, target) => {
    revealInExplorer(target);
    return { ok: true };
  });
}

module.exports = { registerIpc };
