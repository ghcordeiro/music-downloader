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
