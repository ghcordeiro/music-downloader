import { describe, it, expect, beforeEach } from 'vitest';
import nock from 'nock';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { createEnrichment } from '../main/enrichment.js';

function tmp() { return fs.mkdtempSync(path.join(os.tmpdir(), 'mb-')); }

describe('createEnrichment', () => {
  beforeEach(() => nock.cleanAll());

  it('looks up a release and returns label, year, genre, mbid', async () => {
    nock('https://musicbrainz.org')
      .get('/ws/2/recording')
      .query(true)
      .reply(200, {
        recordings: [{
          id: 'mbid-1',
          title: 'Around the World',
          'first-release-date': '1997-01-01',
          releases: [{ id: 'rid', label: { name: 'Virgin' } }],
          tags: [{ name: 'house', count: 5 }],
        }],
      });

    const cacheDir = tmp();
    const enrich = createEnrichment({ cacheDir, userAgent: 'mdtest/0.1' });
    const result = await enrich.lookup({ artist: 'Daft Punk', title: 'Around the World' });
    expect(result).toMatchObject({
      label: 'Virgin',
      year: '1997',
      genre: 'house',
      mbid: 'mbid-1',
    });
  });

  it('returns null when no recordings match', async () => {
    nock('https://musicbrainz.org')
      .get('/ws/2/recording')
      .query(true)
      .reply(200, { recordings: [] });

    const enrich = createEnrichment({ cacheDir: tmp(), userAgent: 'mdtest/0.1' });
    const result = await enrich.lookup({ artist: 'X', title: 'Y' });
    expect(result).toBeNull();
  });

  it('caches responses on disk and reuses them without a network call', async () => {
    nock('https://musicbrainz.org')
      .get('/ws/2/recording')
      .query(true)
      .reply(200, { recordings: [{ id: 'mbid-2', title: 'T', releases: [], tags: [] }] });

    const cacheDir = tmp();
    const enrich = createEnrichment({ cacheDir, userAgent: 'mdtest/0.1' });
    const first = await enrich.lookup({ artist: 'A', title: 'T' });
    expect(first.mbid).toBe('mbid-2');

    const second = await enrich.lookup({ artist: 'A', title: 'T' });
    expect(second.mbid).toBe('mbid-2');
  });
});
