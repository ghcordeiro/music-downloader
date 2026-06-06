const fsp = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { sanitizeFilename } = require('../storage/paths.js');

function uuid() {
  return crypto.randomBytes(8).toString('hex');
}

function createPipeline(deps) {
  const {
    ytdlp, convertToMp3, writeTags, buildFilename, probeBitrateKbps,
    parseMixType, enrichment, library, hashPlaylist, hashTrack,
  } = deps;

  async function run({ playlistName, platform, sourceId, tracks, outputDir, onEvent, signal }) {
    const targetDir = path.join(outputDir, sanitizeFilename(playlistName));
    await fsp.mkdir(targetDir, { recursive: true });

    const playlistHash = hashPlaylist({ platform, sourceId });
    const ok = [];
    const failed = [];

    for (let idx = 0; idx < tracks.length; idx++) {
      if (signal?.aborted) break;
      const track = tracks[idx];
      onEvent?.({ type: 'started', trackIdx: idx, name: track.name, artist: track.artist });

      try {
        const trackHash = hashTrack({ artist: track.artist, title: track.name });
        if (await library.has(playlistHash, trackHash)) {
          onEvent?.({ type: 'skipped', trackIdx: idx });
          ok.push(track);
          continue;
        }

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

        const { cleanTitle, mixType } = parseMixType(track.name);

        let enriched = {
          label: track.label || '',
          year: track.year || '',
          genre: '',
          isrc: track.isrc || '',
          mbid: '',
        };
        if (!enriched.label) {
          const mb = await enrichment.lookup({
            artist: track.artist,
            title: cleanTitle,
            isrc: enriched.isrc || undefined,
          });
          if (mb) {
            enriched = {
              label: mb.label || enriched.label,
              year: mb.year || enriched.year,
              genre: mb.genre || enriched.genre,
              isrc: mb.isrc || enriched.isrc,
              mbid: mb.mbid || '',
            };
          }
        }

        const filename = buildFilename({
          artist: track.artist,
          title: cleanTitle,
          mixType,
          label: enriched.label,
        });
        const finalPath = path.join(targetDir, filename);

        await convertToMp3(sourceFile, finalPath, { bitrateKbps, signal });

        await writeTags(finalPath, {
          title: cleanTitle,
          subtitle: mixType || '',
          artist: track.artist,
          album: playlistName,
          trackNumber: `${idx + 1}/${tracks.length}`,
          year: enriched.year,
          publisher: enriched.label,
          genre: enriched.genre,
          isrc: enriched.isrc,
          comment: `Source: ${search.title} → MP3 ${bitrateKbps}kbps${enriched.mbid ? ` | MB: ${enriched.mbid}` : ''}`,
        });

        await fsp.unlink(sourceFile).catch(() => {});
        await library.register(playlistHash, trackHash);
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
