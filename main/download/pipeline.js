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
