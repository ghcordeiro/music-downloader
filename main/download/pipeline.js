const fsp = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { sanitizeFilename, truncateForOS } = require('../storage/paths.js');
const { buildProvenanceComment } = require('../spotify-direct/provenance.js');

const RECOVERABLE_SPOTIFY = new Set([
  'TRACK_NOT_FOUND_SPOTIFY',
  'REGION_LOCKED',
  'PREMIUM_REQUIRED',
  'ZOTIFY_UNRECOGNIZED',
  'ZOTIFY_BINARY_MISSING',
  'CREDENTIALS_BRIDGE_FAILED',
  'ZOTIFY_TIMEOUT',
  'AUTH_EXPIRED',
  'NOT_CONNECTED',
]);

function uuid() {
  return crypto.randomBytes(8).toString('hex');
}

function okEntry(track, via, fallbackReason = null) {
  return { track, via, fallbackReason };
}

function sourceLabel(via, bitrateKbps, fallbackReason) {
  if (via === 'spotify-direct') return `${bitrateKbps || 320} kbps · Spotify`;
  const kbps = bitrateKbps || 128;
  if (fallbackReason) return `~${kbps} kbps · YouTube (fallback)`;
  return `~${kbps} kbps · YouTube`;
}

function createPipeline(deps) {
  const {
    ytdlp, convertToMp3, writeTags, buildFilename, probeBitrateKbps,
    parseMixType, enrichment, library, hashPlaylist, hashTrack,
    spotifyDirect,
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
          ok.push(okEntry(track, null));
          continue;
        }

        let usedSpotifyDirect = false;
        let spotifyDirectMeta = null;
        let fallbackReason = null;

        if (platform === 'spotify' && spotifyDirect && track.spotifyId) {
          let status;
          try { status = await spotifyDirect.getStatus(); } catch { status = { connected: false }; }

          if (status.connected) {
            onEvent?.({
              type: 'sourcing',
              trackIdx: idx,
              via: 'spotify-direct',
              label: sourceLabel('spotify-direct'),
            });
            const sdOutputPath = path.join(os.tmpdir(), `mdsd-${uuid()}.ogg`);
            try {
              const sd = await spotifyDirect.downloadTrack(track.spotifyId, sdOutputPath, { signal });
              usedSpotifyDirect = true;
              spotifyDirectMeta = { ...sd, plan: status.plan };
            } catch (err) {
              if (signal?.aborted) throw err;
              if (RECOVERABLE_SPOTIFY.has(err.code)) {
                fallbackReason = (err.code || 'unknown').toLowerCase();
              } else {
                throw err;
              }
            }
          }
        }

        let sourceFile;
        let bitrateKbps;
        let sourceCodec;
        let search = null;

        if (usedSpotifyDirect) {
          sourceFile = spotifyDirectMeta.outputPath;
          bitrateKbps = spotifyDirectMeta.sourceBitrateKbps;
          sourceCodec = spotifyDirectMeta.sourceCodec;
        } else {
          onEvent?.({
            type: 'sourcing',
            trackIdx: idx,
            via: 'youtube',
            label: sourceLabel('youtube', null, fallbackReason),
            fallbackReason,
          });
          search = await ytdlp.searchYouTubeForTrack(
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

          sourceFile = await findDownloadedFile(tmpBase);
          bitrateKbps = await probeBitrateKbps(sourceFile);
          sourceCodec = 'opus';
        }

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
        const finalPath = truncateForOS(path.join(targetDir, filename));

        await convertToMp3(sourceFile, finalPath, { bitrateKbps, signal });

        const provenance = buildProvenanceComment({
          source: usedSpotifyDirect ? 'spotify-direct' : (platform === 'soundcloud' ? 'soundcloud' : 'youtube'),
          sourceCodec,
          sourceBitrateKbps: bitrateKbps,
          finalBitrateKbps: bitrateKbps,
          fallbackReason,
          plan: spotifyDirectMeta?.plan,
        });

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
          comment: provenance,
        });

        await fsp.unlink(sourceFile).catch(() => {});
        await library.register(playlistHash, trackHash);
        const via = usedSpotifyDirect ? 'spotify-direct' : 'youtube';
        ok.push(okEntry(track, via, fallbackReason));
        onEvent?.({
          type: 'done',
          trackIdx: idx,
          via,
          bitrateKbps,
          label: sourceLabel(via, bitrateKbps, fallbackReason),
          fallbackReason,
        });
      } catch (err) {
        if (signal?.aborted) throw err;
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
  const match = entries.find((e) => e.startsWith(prefix));
  if (!match) throw new Error(`download output not found for ${tmpBase}`);
  return path.join(dir, match);
}

module.exports = { createPipeline };
