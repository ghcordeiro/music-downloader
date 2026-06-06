import { describe, it, expect, vi } from 'vitest';
import { createPipeline } from '../../main/download/pipeline.js';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

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
    });

    await pipeline.run({
      playlistName: 'PL',
      tracks: [{ name: 'X', artist: 'A', durationSec: 60 }],
      outputDir: outDir,
      onEvent: (e) => events.push(e),
    });

    expect(events.map(e => e.type)).toEqual(['started', 'done']);
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

    expect(events.map(e => e.type)).toEqual(['started', 'not_found', 'started', 'done']);
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
