import { describe, it, expect } from 'vitest';
import { createPipeline } from '../../main/download/pipeline.js';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const defaultExtras = {
  parseMixType: (t) => ({ cleanTitle: t, mixType: null }),
  enrichment: { lookup: async () => null },
  library: { has: async () => false, register: async () => {} },
  hashPlaylist: () => 'plh',
  hashTrack: () => 'th',
};

describe('pipeline.run — single track happy path', () => {
  it('emits started → done and writes a file', async () => {
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mdrun-'));
    const events = [];
    const calls = { search: 0, download: 0, convert: 0, tag: 0 };

    const pipeline = createPipeline({
      ytdlp: {
        searchYouTubeForTrack: async () => { calls.search++; return { url: 'https://x', title: 'X' }; },
        downloadAudio: async (url, outputTemplate) => {
          calls.download++;
          const tmp = outputTemplate.replace('.%(ext)s', '.opus');
          fs.writeFileSync(tmp, Buffer.from('opus-bytes'));
        },
      },
      convertToMp3: async (input, output) => {
        calls.convert++;
        fs.copyFileSync(input, output);
      },
      writeTags: async () => { calls.tag++; },
      buildFilename: ({ artist, title }) => `${artist} - ${title}.mp3`,
      probeBitrateKbps: async () => 192,
      ...defaultExtras,
    });

    await pipeline.run({
      playlistName: 'PL',
      tracks: [{ name: 'X', artist: 'A', durationSec: 60 }],
      outputDir: outDir,
      onEvent: (e) => events.push(e),
    });

    expect(events.map(e => e.type)).toEqual(['started', 'sourcing', 'done']);
    expect(calls).toEqual({ search: 1, download: 1, convert: 1, tag: 1 });
    expect(fs.existsSync(path.join(outDir, 'PL', 'A - X.mp3'))).toBe(true);
  });
});

describe('pipeline.run — failures', () => {
  it('emits not_found and continues to next track', async () => {
    const events = [];
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mdrun-'));

    const pipeline = createPipeline({
      ytdlp: {
        searchYouTubeForTrack: async ({ title }) => title === 'A' ? null : { url: 'https://x', title: 'B' },
        downloadAudio: async (url, t) => fs.writeFileSync(t.replace('.%(ext)s', '.opus'), Buffer.from('x')),
      },
      convertToMp3: async (i, o) => fs.copyFileSync(i, o),
      writeTags: async () => {},
      buildFilename: ({ artist, title }) => `${artist} - ${title}.mp3`,
      probeBitrateKbps: async () => 192,
      ...defaultExtras,
    });

    const result = await pipeline.run({
      playlistName: 'PL',
      tracks: [
        { name: 'A', artist: 'X' },
        { name: 'B', artist: 'Y' },
      ],
      outputDir: outDir,
      onEvent: (e) => events.push(e),
    });

    expect(events.map(e => e.type)).toEqual(['started', 'sourcing', 'not_found', 'started', 'sourcing', 'done']);
    expect(result.failed).toHaveLength(1);
    expect(result.ok).toHaveLength(1);
  });

  it('stops on AbortSignal between tracks', async () => {
    const events = [];
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mdrun-'));
    const controller = new AbortController();

    const pipeline = createPipeline({
      ytdlp: {
        searchYouTubeForTrack: async () => ({ url: 'https://x', title: 'X' }),
        downloadAudio: async (url, t) => {
          fs.writeFileSync(t.replace('.%(ext)s', '.opus'), Buffer.from('x'));
          controller.abort();
        },
      },
      convertToMp3: async (i, o) => fs.copyFileSync(i, o),
      writeTags: async () => {},
      buildFilename: ({ artist, title }) => `${artist} - ${title}.mp3`,
      probeBitrateKbps: async () => 192,
      ...defaultExtras,
    });

    await pipeline.run({
      playlistName: 'PL',
      tracks: [{ name: 'X', artist: 'A' }, { name: 'Y', artist: 'A' }],
      outputDir: outDir,
      onEvent: (e) => events.push(e),
      signal: controller.signal,
    });

    expect(events.filter(e => e.type === 'started')).toHaveLength(1);
  });
});

describe('pipeline.run — enrichment + library', () => {
  it('skips tracks already in the library', async () => {
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mdrun-'));
    const events = [];

    const pipeline = createPipeline({
      ytdlp: {
        searchYouTubeForTrack: async () => ({ url: 'https://x', title: 'X' }),
        downloadAudio: async (url, t) => fs.writeFileSync(t.replace('.%(ext)s', '.opus'), Buffer.from('x')),
      },
      convertToMp3: async (i, o) => fs.copyFileSync(i, o),
      writeTags: async () => {},
      buildFilename: ({ artist, title }) => `${artist} - ${title}.mp3`,
      probeBitrateKbps: async () => 192,
      parseMixType: (t) => ({ cleanTitle: t, mixType: null }),
      enrichment: { lookup: async () => null },
      library: {
        has: async () => true,
        register: async () => {},
      },
      hashPlaylist: () => 'plh',
      hashTrack: () => 'th',
    });

    await pipeline.run({
      playlistName: 'PL',
      platform: 'spotify',
      sourceId: 'abc',
      tracks: [{ name: 'X', artist: 'A' }],
      outputDir: outDir,
      onEvent: (e) => events.push(e),
    });

    expect(events.map(e => e.type)).toEqual(['started', 'skipped']);
  });

  it('parses mix type and asks enrichment when source lacks label', async () => {
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mdrun-'));
    let enrichmentCalls = 0;
    let receivedTitle = null;
    let receivedSubtitle = null;

    const pipeline = createPipeline({
      ytdlp: {
        searchYouTubeForTrack: async () => ({ url: 'https://x', title: 'X' }),
        downloadAudio: async (url, t) => fs.writeFileSync(t.replace('.%(ext)s', '.opus'), Buffer.from('x')),
      },
      convertToMp3: async (i, o) => fs.copyFileSync(i, o),
      writeTags: async (file, fields) => {
        receivedTitle = fields.title;
        receivedSubtitle = fields.subtitle;
      },
      buildFilename: ({ artist, title, mixType, label }) =>
        `${artist} - ${title}${mixType ? ` (${mixType})` : ''}${label ? ` [${label}]` : ''}.mp3`,
      probeBitrateKbps: async () => 192,
      parseMixType: (t) => t.includes('(Extended)')
        ? { cleanTitle: t.replace(' (Extended)', ''), mixType: 'Extended Mix' }
        : { cleanTitle: t, mixType: null },
      enrichment: { lookup: async () => { enrichmentCalls++; return { label: 'PMR', year: '2013', genre: 'House' }; } },
      library: { has: async () => false, register: async () => {} },
      hashPlaylist: () => 'plh',
      hashTrack: () => 'th',
    });

    await pipeline.run({
      playlistName: 'PL',
      platform: 'youtube',
      sourceId: 'xyz',
      tracks: [{ name: 'Latch (Extended)', artist: 'Disclosure' }],
      outputDir: outDir,
      onEvent: () => {},
    });

    expect(enrichmentCalls).toBe(1);
    expect(receivedTitle).toBe('Latch');
    expect(receivedSubtitle).toBe('Extended Mix');
    expect(fs.existsSync(path.join(outDir, 'PL', 'Disclosure - Latch (Extended Mix) [PMR].mp3'))).toBe(true);
  });
});

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
      hashPlaylist: () => 'plh',
      hashTrack: () => 'th',
      spotifyDirect,
    });
  }

  it('uses Spotify-direct when connected and platform is spotify', async () => {
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mdrun-'));
    const calls = { sd: 0 };
    const pipeline = pipelineWithSpotifyDirect({
      getStatus: async () => ({ connected: true, email: 'a@b', plan: 'premium' }),
      downloadTrack: async (_id, outputPath) => {
        calls.sd++;
        fs.writeFileSync(outputPath, Buffer.from('ogg'));
        return { ok: true, sourceCodec: 'vorbis', sourceBitrateKbps: 320, outputPath };
      },
    });

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
        const e = new Error('not in catalog');
        e.code = 'TRACK_NOT_FOUND_SPOTIFY';
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
    expect(events.map((e) => e.type)).toContain('done');
    expect(result.ok).toHaveLength(1);
    expect(result.ok[0].via).toBe('youtube');
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
