const { ipcMain } = require('electron');
const path = require('node:path');
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

let activeAbort = null;

function broadcast(win, channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

function registerIpc({ config, window, userDataDir }) {
  const spotifyClient = createSpotifyClient({
    clientId: process.env.SPOTIFY_CLIENT_ID,
    clientSecret: process.env.SPOTIFY_CLIENT_SECRET,
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
  });

  ipcMain.handle('config:get', () => config.get());
  ipcMain.handle('config:set', (_e, value) => config.set(value));

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
