# Music Downloader — Plan B: Multi-Platform + DJ-Quality Metadata

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the Plan A foundation with two more platforms (YouTube, SoundCloud), DJ-style filenames with parsed mix types and labels, MusicBrainz enrichment for non-Spotify sources, ID3 subtitle (TIT3) for the mix variant, and a library that prevents re-downloads.

**Architecture:** Two new platform modules (`youtube.js`, `soundcloud.js`) adhering to the same contract the Spotify module already uses. A new `enrichment.js` module hits MusicBrainz with disk-cached responses to fill in label/year/genre for YT and SC tracks. A new `library.js` records what was successfully downloaded per playlist so re-runs skip the rest. `filename.js` gains a mix-type parser. `tagging.js` gains TIT3 and the rest of the spec's tags. The renderer grows two more tabs that reuse the same five-state machine.

**Tech Stack:** Same as Plan A — Electron, Node.js, `axios`, `node-id3`, Vitest, `nock`. No new runtime dependencies.

**Prerequisite:** Plan A is fully implemented and the test suite passes (`npm test`). Branch is still `music-downloader-electron`.

---

## File map

| Path | Action | Purpose |
|------|--------|---------|
| `main/filename.js` | modify | Add `parseMixType`, integrate into `buildFilename` |
| `main/tagging.js` | modify | Write TIT3 (subtitle), publisher, genre, ISRC |
| `main/enrichment.js` | create | MusicBrainz lookup with disk cache |
| `main/storage/library.js` | create | Skip-if-exists registry |
| `main/download/pipeline.js` | modify | Call `enrichment.lookup` and `library.has`/`register` |
| `main/platforms/youtube.js` | create | URL parse + `yt-dlp --flat-playlist` |
| `main/platforms/soundcloud.js` | create | URL parse + `yt-dlp --flat-playlist` |
| `main/ipc.js` | modify | Register `youtube:fetch`, `soundcloud:fetch` handlers |
| `main/preload.js` | modify | Expose `window.api.youtube` and `.soundcloud` |
| `renderer/index.html` | modify | Add YouTube and SoundCloud tab panels |
| `renderer/styles.css` | modify | Per-tab brand colors |
| `renderer/main.js` | modify | Tab routing across three tabs |
| `renderer/tabs/youtube.js` | create | YouTube tab logic (reuses spotify pattern) |
| `renderer/tabs/soundcloud.js` | create | SoundCloud tab logic |
| `tests/filename.test.js` | modify | Tests for mix parsing |
| `tests/tagging.test.js` | modify | Tests for TIT3 and other tags |
| `tests/enrichment.test.js` | create | Unit + nock for MusicBrainz |
| `tests/storage/library.test.js` | create | Round-trip tests |
| `tests/platforms/youtube.test.js` | create | URL parser tests |
| `tests/platforms/soundcloud.test.js` | create | URL parser tests |
| `tests/download/pipeline.test.js` | modify | Enrichment + library integration tests |

---

## Task 1: `filename.js` — `parseMixType`

**Files:**
- Modify: `main/filename.js`
- Modify: `tests/filename.test.js`

- [ ] **Step 1: Append failing tests**

Append to `tests/filename.test.js`:

```javascript
import { parseMixType } from '../main/filename.js';

describe('parseMixType', () => {
  it('extracts parenthesized "Original Mix" and returns the clean title', () => {
    expect(parseMixType('Around the World (Original Mix)'))
      .toEqual({ cleanTitle: 'Around the World', mixType: 'Original Mix' });
  });

  it('normalizes "(Extended)" to "Extended Mix"', () => {
    expect(parseMixType('Latch (Extended)'))
      .toEqual({ cleanTitle: 'Latch', mixType: 'Extended Mix' });
  });

  it('recognizes "(Radio Edit)" verbatim', () => {
    expect(parseMixType('Hit (Radio Edit)'))
      .toEqual({ cleanTitle: 'Hit', mixType: 'Radio Edit' });
  });

  it('preserves named remixes', () => {
    expect(parseMixType("Latch (Disclosure's Remix)"))
      .toEqual({ cleanTitle: 'Latch', mixType: "Disclosure's Remix" });
    expect(parseMixType('Latch (Disclosure Remix)'))
      .toEqual({ cleanTitle: 'Latch', mixType: 'Disclosure Remix' });
  });

  it('handles dash-suffix forms', () => {
    expect(parseMixType('Around the World - Original Mix'))
      .toEqual({ cleanTitle: 'Around the World', mixType: 'Original Mix' });
  });

  it('returns null mix when no pattern matches', () => {
    expect(parseMixType('Halo')).toEqual({ cleanTitle: 'Halo', mixType: null });
  });

  it('does not invent "Original Mix" for tracks without it', () => {
    expect(parseMixType('Espresso').mixType).toBeNull();
  });
});
```

- [ ] **Step 2: Run — expect failure**

```bash
npm test -- tests/filename.test.js
```

Expected: `parseMixType` import fails.

- [ ] **Step 3: Implement `parseMixType` in `main/filename.js`**

Add to the top of the file:

```javascript
const KNOWN_LITERAL = [
  'Original Mix',
  'Extended Mix',
  'Radio Edit',
  'Club Mix',
  'Dub Mix',
  'Acoustic',
  'Live',
];

const NORMALIZATIONS = new Map([
  ['Extended', 'Extended Mix'],
]);

function normalizeMix(mix) {
  const trimmed = mix.trim();
  if (NORMALIZATIONS.has(trimmed)) return NORMALIZATIONS.get(trimmed);
  return trimmed;
}

function parseMixType(title) {
  if (typeof title !== 'string') return { cleanTitle: '', mixType: null };

  // Trailing parens: " (something)"
  const parens = title.match(/^(.*?)\s*\(([^()]+)\)\s*$/);
  if (parens) {
    const inside = parens[2].trim();
    if (
      KNOWN_LITERAL.includes(inside) ||
      /Remix$/i.test(inside) ||
      NORMALIZATIONS.has(inside) ||
      /'s\s+Remix$/i.test(inside)
    ) {
      return { cleanTitle: parens[1].trim(), mixType: normalizeMix(inside) };
    }
  }

  // Dash suffix: " - Original Mix"
  const dashMatch = title.match(/^(.*?)\s+-\s+([A-Za-z][A-Za-z ']*)\s*$/);
  if (dashMatch) {
    const candidate = dashMatch[2].trim();
    if (KNOWN_LITERAL.includes(candidate) || NORMALIZATIONS.has(candidate)) {
      return { cleanTitle: dashMatch[1].trim(), mixType: normalizeMix(candidate) };
    }
  }

  return { cleanTitle: title.trim(), mixType: null };
}
```

Update exports at the bottom of the file:

```javascript
module.exports = { buildFilename, parseMixType };
```

- [ ] **Step 4: Run — expect pass**

```bash
npm test -- tests/filename.test.js
```

Expected: all tests pass (including the older ones).

- [ ] **Step 5: Commit**

```bash
git add main/filename.js tests/filename.test.js
git commit -m "feat(filename): parseMixType with normalization and named remixes"
```

---

## Task 2: `filename.js` — `buildFilename` integrates the mix

**Files:**
- Modify: `main/filename.js`
- Modify: `tests/filename.test.js`

- [ ] **Step 1: Append failing tests**

```javascript
describe('buildFilename with mix and label', () => {
  it('renders both when present', () => {
    expect(buildFilename({
      artist: 'Daft Punk',
      title: 'Around the World',
      mixType: 'Original Mix',
      label: 'Virgin',
    })).toBe('Daft Punk - Around the World (Original Mix) [Virgin].mp3');
  });

  it('omits both when absent', () => {
    expect(buildFilename({
      artist: 'Beyoncé',
      title: 'Halo',
      mixType: null,
      label: '',
    })).toBe('Beyoncé - Halo.mp3');
  });

  it('renders only mix when label is absent', () => {
    expect(buildFilename({
      artist: 'Disclosure',
      title: 'Latch',
      mixType: 'Extended Mix',
      label: '',
    })).toBe('Disclosure - Latch (Extended Mix).mp3');
  });

  it('renders only label when mix is absent', () => {
    expect(buildFilename({
      artist: 'Daft Punk',
      title: 'Around the World',
      mixType: null,
      label: 'Virgin',
    })).toBe('Daft Punk - Around the World [Virgin].mp3');
  });
});
```

- [ ] **Step 2: Run — expect failure**

```bash
npm test -- tests/filename.test.js
```

The existing `buildFilename` ignores `mixType`, so the first three new tests fail.

- [ ] **Step 3: Update `buildFilename` in `main/filename.js`**

Replace the existing `buildFilename` with:

```javascript
function buildFilename({ artist, title, mixType, label }) {
  const a = sanitizeFilename(artist || 'Unknown');
  const t = sanitizeFilename(title || 'untitled');
  const mixPart = mixType ? ` (${sanitizeFilename(mixType)})` : '';
  const labelPart = label && label.trim()
    ? ` [${sanitizeFilename(label.trim())}]`
    : '';
  return `${a} - ${t}${mixPart}${labelPart}.mp3`;
}
```

- [ ] **Step 4: Run — expect pass**

```bash
npm test -- tests/filename.test.js
```

- [ ] **Step 5: Commit**

```bash
git add main/filename.js tests/filename.test.js
git commit -m "feat(filename): include mix type in built filename"
```

---

## Task 3: `tagging.js` — TIT3 (subtitle) and extra fields

**Files:**
- Modify: `main/tagging.js`
- Modify: `tests/tagging.test.js`

- [ ] **Step 1: Append failing tests**

Append to `tests/tagging.test.js`:

```javascript
describe('writeTags — DJ-quality fields', () => {
  it('writes subtitle (TIT3), publisher, genre, ISRC', async () => {
    const file = copyFixture();
    await writeTags(file, {
      title: 'Latch',
      subtitle: 'Extended Mix',
      artist: 'Disclosure',
      album: 'My Playlist',
      trackNumber: '1/1',
      year: '2013',
      publisher: 'PMR',
      genre: 'House',
      isrc: 'GBUM71300001',
      comment: 'Source: Spotify',
    });
    const tags = NodeID3.read(file);
    expect(tags.subtitle).toBe('Extended Mix');
    expect(tags.publisher).toBe('PMR');
    expect(tags.genre).toBe('House');
    expect(tags.ISRC || tags.isrc).toBe('GBUM71300001');
  });

  it('omits subtitle when not provided', async () => {
    const file = copyFixture();
    await writeTags(file, {
      title: 'Halo',
      artist: 'Beyoncé',
      album: 'Pop',
      trackNumber: '1/1',
      comment: 'Source: Spotify',
    });
    const tags = NodeID3.read(file);
    expect(tags.subtitle || '').toBe('');
  });
});
```

- [ ] **Step 2: Run — expect failure**

```bash
npm test -- tests/tagging.test.js
```

The existing `writeTags` never writes `subtitle`.

- [ ] **Step 3: Update `main/tagging.js`**

Replace the file with:

```javascript
const NodeID3 = require('node-id3');

async function writeTags(filePath, fields) {
  const tags = {
    title: fields.title || '',
    artist: fields.artist || '',
    album: fields.album || '',
    albumArtist: fields.albumArtist || 'Various Artists',
    trackNumber: fields.trackNumber || '',
    year: fields.year || '',
    comment: { language: 'eng', text: fields.comment || '' },
  };
  if (fields.subtitle) tags.subtitle = fields.subtitle;
  if (fields.publisher) tags.publisher = fields.publisher;
  if (fields.genre) tags.genre = fields.genre;
  if (fields.isrc) tags.ISRC = fields.isrc;
  if (fields.imageBuffer && fields.imageMime) {
    tags.image = {
      mime: fields.imageMime,
      type: { id: 3, name: 'Front Cover' },
      description: 'Cover',
      imageBuffer: fields.imageBuffer,
    };
  }
  const ok = NodeID3.write(tags, filePath);
  if (!ok) throw new Error(`failed to write ID3 tags to ${filePath}`);
}

module.exports = { writeTags };
```

- [ ] **Step 4: Run — expect pass**

```bash
npm test -- tests/tagging.test.js
```

- [ ] **Step 5: Commit**

```bash
git add main/tagging.js tests/tagging.test.js
git commit -m "feat(tagging): write subtitle (TIT3), publisher, genre, ISRC"
```

---

## Task 4: `main/enrichment.js` — MusicBrainz lookup with disk cache

**Files:**
- Create: `main/enrichment.js`
- Create: `tests/enrichment.test.js`

- [ ] **Step 1: Write the failing tests**

In `tests/enrichment.test.js`:

```javascript
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

    // Second call should NOT hit the network.
    const second = await enrich.lookup({ artist: 'A', title: 'T' });
    expect(second.mbid).toBe('mbid-2');
    // nock would throw if a request slipped past with no matching mock.
  });
});
```

- [ ] **Step 2: Run — expect failure**

```bash
npm test -- tests/enrichment.test.js
```

- [ ] **Step 3: Implement `main/enrichment.js`**

```javascript
const axios = require('axios');
const fs = require('node:fs/promises');
const fssync = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

function keyFor({ artist, title, isrc }) {
  if (isrc) return `isrc:${isrc}`;
  return `q:${(artist || '').toLowerCase()}::${(title || '').toLowerCase()}`;
}

function hash(s) {
  return crypto.createHash('sha1').update(s).digest('hex');
}

function pickGenre(tags) {
  if (!Array.isArray(tags) || tags.length === 0) return '';
  const ranked = [...tags].sort((a, b) => (b.count || 0) - (a.count || 0));
  return (ranked[0] && ranked[0].name) || '';
}

function pickLabel(releases) {
  if (!Array.isArray(releases)) return '';
  for (const r of releases) {
    if (r?.label?.name) return r.label.name;
    if (r?.['label-info']?.[0]?.label?.name) return r['label-info'][0].label.name;
  }
  return '';
}

function createEnrichment({ cacheDir, userAgent, rateLimitMs = 1100 }) {
  fssync.mkdirSync(cacheDir, { recursive: true });
  let lastCall = 0;

  async function throttle() {
    const now = Date.now();
    const wait = Math.max(0, lastCall + rateLimitMs - now);
    if (wait > 0) await new Promise(r => setTimeout(r, wait));
    lastCall = Date.now();
  }

  async function readCache(k) {
    try {
      const buf = await fs.readFile(path.join(cacheDir, hash(k) + '.json'), 'utf8');
      return JSON.parse(buf);
    } catch { return undefined; }
  }
  async function writeCache(k, value) {
    await fs.writeFile(path.join(cacheDir, hash(k) + '.json'), JSON.stringify(value), 'utf8');
  }

  function _mapRecording(rec) {
    if (!rec) return null;
    return {
      mbid: rec.id || '',
      label: pickLabel(rec.releases),
      year: (rec['first-release-date'] || '').slice(0, 4),
      genre: pickGenre(rec.tags),
      isrc: Array.isArray(rec.isrcs) ? rec.isrcs[0] || '' : '',
    };
  }

  async function lookup({ artist, title, isrc } = {}) {
    const k = keyFor({ artist, title, isrc });
    const cached = await readCache(k);
    if (cached !== undefined) return cached;

    await throttle();

    let query;
    if (isrc) {
      query = `isrc:${isrc}`;
    } else {
      const safe = s => (s || '').replace(/"/g, '');
      query = `artist:"${safe(artist)}" AND recording:"${safe(title)}"`;
    }

    try {
      const resp = await axios.get('https://musicbrainz.org/ws/2/recording', {
        params: { query, fmt: 'json', limit: 1, inc: 'releases+tags+labels' },
        headers: { 'User-Agent': userAgent },
        timeout: 10_000,
      });
      const rec = (resp.data?.recordings || [])[0];
      const mapped = rec ? _mapRecording(rec) : null;
      await writeCache(k, mapped);
      return mapped;
    } catch (err) {
      // network failure: do not pollute cache; pipeline will proceed without enrichment
      return null;
    }
  }

  return { lookup };
}

module.exports = { createEnrichment };
```

- [ ] **Step 4: Run — expect pass**

```bash
npm test -- tests/enrichment.test.js
```

- [ ] **Step 5: Commit**

```bash
git add main/enrichment.js tests/enrichment.test.js
git commit -m "feat(enrichment): musicbrainz lookup with rate limit and disk cache"
```

---

## Task 5: `main/storage/library.js` — skip-if-exists registry

**Files:**
- Create: `main/storage/library.js`
- Create: `tests/storage/library.test.js`

- [ ] **Step 1: Write the failing tests**

In `tests/storage/library.test.js`:

```javascript
import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createLibrary, hashPlaylist, hashTrack } from '../../main/storage/library.js';

function tmp() { return fs.mkdtempSync(path.join(os.tmpdir(), 'lib-')); }

describe('library', () => {
  let dir;
  beforeEach(() => { dir = tmp(); });

  it('returns false for unseen tracks', async () => {
    const lib = createLibrary(dir);
    expect(await lib.has('pl1', 't1')).toBe(false);
  });

  it('registers a track then reports has=true', async () => {
    const lib = createLibrary(dir);
    await lib.register('pl1', 't1');
    expect(await lib.has('pl1', 't1')).toBe(true);
  });

  it('persists across instances', async () => {
    const a = createLibrary(dir);
    await a.register('pl1', 't1');
    const b = createLibrary(dir);
    expect(await b.has('pl1', 't1')).toBe(true);
  });

  it('hashes are stable', () => {
    expect(hashTrack({ artist: 'Daft Punk', title: 'Around the World' }))
      .toBe(hashTrack({ artist: 'Daft Punk', title: 'Around the World' }));
    expect(hashPlaylist({ platform: 'spotify', sourceId: 'abc' }))
      .toBe(hashPlaylist({ platform: 'spotify', sourceId: 'abc' }));
  });
});
```

- [ ] **Step 2: Run — expect failure**

```bash
npm test -- tests/storage/library.test.js
```

- [ ] **Step 3: Implement `main/storage/library.js`**

```javascript
const fs = require('node:fs/promises');
const fssync = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

function hashTrack({ artist, title }) {
  return crypto.createHash('sha1')
    .update(`${(artist || '').toLowerCase()}::${(title || '').toLowerCase()}`)
    .digest('hex');
}

function hashPlaylist({ platform, sourceId }) {
  return crypto.createHash('sha1')
    .update(`${platform}::${sourceId}`)
    .digest('hex');
}

function createLibrary(dir) {
  fssync.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'library.json');

  async function readAll() {
    try {
      return JSON.parse(await fs.readFile(file, 'utf8'));
    } catch { return {}; }
  }
  async function writeAll(obj) {
    await fs.writeFile(file, JSON.stringify(obj, null, 2), 'utf8');
  }

  return {
    async has(playlistHash, trackHash) {
      const all = await readAll();
      return Array.isArray(all[playlistHash]) && all[playlistHash].includes(trackHash);
    },
    async register(playlistHash, trackHash) {
      const all = await readAll();
      if (!Array.isArray(all[playlistHash])) all[playlistHash] = [];
      if (!all[playlistHash].includes(trackHash)) all[playlistHash].push(trackHash);
      await writeAll(all);
    },
  };
}

module.exports = { createLibrary, hashTrack, hashPlaylist };
```

- [ ] **Step 4: Run — expect pass**

```bash
npm test -- tests/storage/library.test.js
```

- [ ] **Step 5: Commit**

```bash
git add main/storage/library.js tests/storage/library.test.js
git commit -m "feat(library): persistent skip-if-exists registry"
```

---

## Task 6: Pipeline — integrate enrichment, mix parsing, library

**Files:**
- Modify: `main/download/pipeline.js`
- Modify: `tests/download/pipeline.test.js`

- [ ] **Step 1: Append failing tests**

```javascript
import { createPipeline } from '../../main/download/pipeline.js';

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
```

- [ ] **Step 2: Run — expect failure**

```bash
npm test -- tests/download/pipeline.test.js
```

- [ ] **Step 3: Update `main/download/pipeline.js`**

Replace the file with:

```javascript
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
        // For platforms without native label (YouTube/SoundCloud), ask MusicBrainz.
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
```

- [ ] **Step 4: Run — expect pass**

```bash
npm test -- tests/download/pipeline.test.js
```

- [ ] **Step 5: Commit**

```bash
git add main/download/pipeline.js tests/download/pipeline.test.js
git commit -m "feat(pipeline): integrate mix parsing, enrichment, and library skip"
```

---

## Task 7: `main/platforms/youtube.js`

**Files:**
- Create: `main/platforms/youtube.js`
- Create: `tests/platforms/youtube.test.js`

- [ ] **Step 1: Write failing URL-parsing tests**

In `tests/platforms/youtube.test.js`:

```javascript
import { describe, it, expect } from 'vitest';
import { parseYouTubeUrl } from '../../main/platforms/youtube.js';

describe('parseYouTubeUrl', () => {
  it('parses a watch URL', () => {
    expect(parseYouTubeUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ'))
      .toEqual({ type: 'video', id: 'dQw4w9WgXcQ', url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' });
  });

  it('parses youtu.be short URLs', () => {
    expect(parseYouTubeUrl('https://youtu.be/dQw4w9WgXcQ'))
      .toMatchObject({ type: 'video', id: 'dQw4w9WgXcQ' });
  });

  it('parses playlist URLs', () => {
    const u = 'https://www.youtube.com/playlist?list=PLxxxx';
    expect(parseYouTubeUrl(u)).toEqual({ type: 'playlist', id: 'PLxxxx', url: u });
  });

  it('rejects channel URLs in MVP', () => {
    expect(() => parseYouTubeUrl('https://www.youtube.com/@channel'))
      .toThrow();
  });

  it('rejects non-YouTube URLs', () => {
    expect(() => parseYouTubeUrl('https://example.com/x')).toThrow();
  });
});
```

- [ ] **Step 2: Run — expect failure**

```bash
npm test -- tests/platforms/youtube.test.js
```

- [ ] **Step 3: Implement `main/platforms/youtube.js`**

```javascript
const { runYtDlp } = require('../download/ytdlp.js');
const { InvalidUrlError } = require('../errors.js');

function parseYouTubeUrl(rawUrl) {
  const url = (rawUrl || '').trim();
  try {
    const u = new URL(url);
    if (u.hostname === 'youtu.be') {
      const id = u.pathname.replace(/^\//, '');
      if (id) return { type: 'video', id, url };
    }
    if (u.hostname.endsWith('youtube.com') || u.hostname.endsWith('youtube-nocookie.com')) {
      if (u.pathname === '/watch' && u.searchParams.get('v')) {
        return { type: 'video', id: u.searchParams.get('v'), url };
      }
      if (u.pathname === '/playlist' && u.searchParams.get('list')) {
        return { type: 'playlist', id: u.searchParams.get('list'), url };
      }
    }
  } catch { /* fall through */ }
  throw new InvalidUrlError(url);
}

async function fetchPlaylistOrVideo(parsed) {
  if (parsed.type === 'video') {
    const out = await runYtDlp(['--dump-json', '--no-warnings', '--no-playlist', parsed.url]);
    const meta = JSON.parse(out.trim());
    return {
      playlistName: meta.title || 'Single track',
      coverUrl: meta.thumbnail || '',
      tracks: [{
        name: meta.title || '',
        artist: meta.uploader || meta.channel || 'Unknown',
        durationSec: Math.floor(meta.duration || 0),
        coverUrl: meta.thumbnail || '',
        isrc: '',
        year: '',
        label: '',
        directUrl: meta.webpage_url || parsed.url,
      }],
    };
  }
  // playlist
  const out = await runYtDlp([
    '--dump-json', '--flat-playlist', '--no-warnings', parsed.url,
  ]);
  const lines = out.trim().split('\n').filter(Boolean);
  if (lines.length === 0) {
    return { playlistName: 'Playlist', coverUrl: '', tracks: [] };
  }
  // first line is sometimes the playlist meta; safer to detect by presence of 'entries' style
  let playlistName = 'Playlist';
  const tracks = [];
  for (const line of lines) {
    const item = JSON.parse(line);
    if (item._type === 'playlist' && item.title) {
      playlistName = item.title;
      continue;
    }
    if (item.id) {
      tracks.push({
        name: item.title || '',
        artist: item.uploader || item.channel || 'Unknown',
        durationSec: Math.floor(item.duration || 0),
        coverUrl: item.thumbnails?.[0]?.url || '',
        isrc: '',
        year: '',
        label: '',
        directUrl: item.url || `https://www.youtube.com/watch?v=${item.id}`,
      });
    }
  }
  return { playlistName, coverUrl: '', tracks };
}

module.exports = { parseYouTubeUrl, fetchPlaylistOrVideo };
```

- [ ] **Step 4: Run — expect pass**

```bash
npm test -- tests/platforms/youtube.test.js
```

- [ ] **Step 5: Commit**

```bash
git add main/platforms/youtube.js tests/platforms/youtube.test.js
git commit -m "feat(youtube): url parser and playlist/video fetch via yt-dlp"
```

---

## Task 8: `main/platforms/soundcloud.js`

**Files:**
- Create: `main/platforms/soundcloud.js`
- Create: `tests/platforms/soundcloud.test.js`

- [ ] **Step 1: Write failing tests**

In `tests/platforms/soundcloud.test.js`:

```javascript
import { describe, it, expect } from 'vitest';
import { parseSoundCloudUrl } from '../../main/platforms/soundcloud.js';

describe('parseSoundCloudUrl', () => {
  it('parses a track URL', () => {
    const u = 'https://soundcloud.com/artist/track-name';
    expect(parseSoundCloudUrl(u)).toEqual({ type: 'track', url: u });
  });

  it('parses a set (playlist) URL', () => {
    const u = 'https://soundcloud.com/artist/sets/album-name';
    expect(parseSoundCloudUrl(u)).toEqual({ type: 'playlist', url: u });
  });

  it('rejects non-SoundCloud URLs', () => {
    expect(() => parseSoundCloudUrl('https://example.com/x')).toThrow();
  });
});
```

- [ ] **Step 2: Run — expect failure**

```bash
npm test -- tests/platforms/soundcloud.test.js
```

- [ ] **Step 3: Implement `main/platforms/soundcloud.js`**

```javascript
const { runYtDlp } = require('../download/ytdlp.js');
const { InvalidUrlError } = require('../errors.js');

function parseSoundCloudUrl(rawUrl) {
  const url = (rawUrl || '').trim();
  try {
    const u = new URL(url);
    if (!u.hostname.endsWith('soundcloud.com')) throw new Error('not soundcloud');
    // /sets/ in path means playlist; otherwise track
    if (u.pathname.includes('/sets/')) return { type: 'playlist', url };
    if (u.pathname.split('/').filter(Boolean).length >= 2) return { type: 'track', url };
  } catch { /* fall through */ }
  throw new InvalidUrlError(url);
}

async function fetchPlaylistOrTrack(parsed) {
  if (parsed.type === 'track') {
    const out = await runYtDlp(['--dump-json', '--no-warnings', parsed.url]);
    const meta = JSON.parse(out.trim());
    return {
      playlistName: meta.title || 'Single track',
      coverUrl: meta.thumbnail || '',
      tracks: [{
        name: meta.title || '',
        artist: meta.uploader || 'Unknown',
        durationSec: Math.floor(meta.duration || 0),
        coverUrl: meta.thumbnail || '',
        isrc: '',
        year: '',
        label: '',
        directUrl: meta.webpage_url || parsed.url,
      }],
    };
  }
  const out = await runYtDlp(['--dump-json', '--flat-playlist', '--no-warnings', parsed.url]);
  const lines = out.trim().split('\n').filter(Boolean);
  let playlistName = 'SoundCloud Set';
  const tracks = [];
  for (const line of lines) {
    const item = JSON.parse(line);
    if (item._type === 'playlist' && item.title) {
      playlistName = item.title;
      continue;
    }
    if (item.id || item.url) {
      tracks.push({
        name: item.title || '',
        artist: item.uploader || 'Unknown',
        durationSec: Math.floor(item.duration || 0),
        coverUrl: item.thumbnails?.[0]?.url || '',
        isrc: '',
        year: '',
        label: '',
        directUrl: item.url,
      });
    }
  }
  return { playlistName, coverUrl: '', tracks };
}

module.exports = { parseSoundCloudUrl, fetchPlaylistOrTrack };
```

- [ ] **Step 4: Run — expect pass**

```bash
npm test -- tests/platforms/soundcloud.test.js
```

- [ ] **Step 5: Commit**

```bash
git add main/platforms/soundcloud.js tests/platforms/soundcloud.test.js
git commit -m "feat(soundcloud): url parser and metadata via yt-dlp"
```

---

## Task 9: IPC + preload — add `youtube:fetch`, `soundcloud:fetch`, wire enrichment + library

**Files:**
- Modify: `main/ipc.js`
- Modify: `main/preload.js`

- [ ] **Step 1: Update `main/ipc.js`**

Replace the file with:

```javascript
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
```

- [ ] **Step 2: Update `main/preload.js`**

Add YouTube and SoundCloud blocks. Replace the file with:

```javascript
const { contextBridge, ipcRenderer } = require('electron');

const onProgressListeners = new Set();
ipcRenderer.on('download:progress', (_e, evt) => {
  for (const fn of onProgressListeners) fn(evt);
});

contextBridge.exposeInMainWorld('api', {
  config: {
    get: () => ipcRenderer.invoke('config:get'),
    set: (value) => ipcRenderer.invoke('config:set', value),
  },
  spotify: {
    fetchPlaylist: (url) => ipcRenderer.invoke('spotify:fetch', url),
  },
  youtube: {
    fetchPlaylist: (url) => ipcRenderer.invoke('youtube:fetch', url),
  },
  soundcloud: {
    fetchPlaylist: (url) => ipcRenderer.invoke('soundcloud:fetch', url),
  },
  download: {
    start: (payload) => ipcRenderer.invoke('download:start', payload),
    cancel: () => ipcRenderer.invoke('download:cancel'),
    onProgress: (cb) => {
      onProgressListeners.add(cb);
      return () => onProgressListeners.delete(cb);
    },
  },
  shell: {
    openFolder: (target) => ipcRenderer.invoke('shell:openFolder', target),
  },
});
```

- [ ] **Step 3: Wire `userDataDir` in `main/index.js`**

Modify the `registerIpc` call in `main/index.js` so it passes the user data directory:

```javascript
registerIpc({ config, window, userDataDir: app.getPath('userData') });
```

- [ ] **Step 4: Run all tests for no regressions**

```bash
npm test
```

- [ ] **Step 5: Commit**

```bash
git add main/ipc.js main/preload.js main/index.js
git commit -m "feat(ipc): add youtube/soundcloud fetchers and wire enrichment+library"
```

---

## Task 10: Renderer — add YouTube and SoundCloud panels

**Files:**
- Modify: `renderer/index.html`
- Modify: `renderer/styles.css`

- [ ] **Step 1: Add tabs and panels to `renderer/index.html`**

In the `<nav class="tabs">` block, replace the single Spotify tab button with:

```html
<nav class="tabs">
  <button class="tab active" data-tab="spotify">Spotify</button>
  <button class="tab" data-tab="youtube">YouTube</button>
  <button class="tab" data-tab="soundcloud">SoundCloud</button>
</nav>
```

Then after the existing `<div class="panel" id="spotifyPanel">...</div>` block, add two more panels with the same internal structure (states empty → done) but different IDs:

```html
<div class="panel" id="youtubePanel" hidden>
  <div class="state state-empty" data-state="empty">
    <p>Cole o link de uma playlist ou vídeo do YouTube:</p>
    <input id="youtubeUrl" placeholder="https://www.youtube.com/watch?v=..." />
    <div class="row-right"><button id="youtubeFetch">Buscar</button></div>
  </div>
  <div class="state state-loading" data-state="loading" hidden><p>Carregando…</p></div>
  <div class="state state-preview" data-state="preview" hidden>
    <div class="preview">
      <img id="youtubeCover" alt="" />
      <div>
        <div id="youtubeName"></div>
        <div id="youtubeMeta"></div>
      </div>
    </div>
    <div class="row-right">
      <button id="youtubePreviewCancel">Cancelar</button>
      <button id="youtubePreviewStart">Baixar</button>
    </div>
  </div>
  <div class="state state-downloading" data-state="downloading" hidden>
    <div class="bar"><div id="youtubeBar" class="bar-fill"></div></div>
    <div id="youtubeCounter"></div>
    <ul id="youtubeTrackList"></ul>
    <div class="row-right"><button id="youtubeDownloadCancel">Cancelar</button></div>
  </div>
  <div class="state state-done" data-state="done" hidden>
    <div id="youtubeSummary"></div>
    <div class="row-right">
      <button id="youtubeOpenFolder">Ver pasta</button>
      <button id="youtubeAnother">Baixar outra playlist</button>
    </div>
  </div>
  <div class="state state-error" data-state="error" hidden>
    <div id="youtubeErrorMessage"></div>
    <div class="row-right"><button id="youtubeErrorRetry">Voltar</button></div>
  </div>
</div>

<div class="panel" id="soundcloudPanel" hidden>
  <div class="state state-empty" data-state="empty">
    <p>Cole o link de uma faixa ou set do SoundCloud:</p>
    <input id="soundcloudUrl" placeholder="https://soundcloud.com/..." />
    <div class="row-right"><button id="soundcloudFetch">Buscar</button></div>
  </div>
  <div class="state state-loading" data-state="loading" hidden><p>Carregando…</p></div>
  <div class="state state-preview" data-state="preview" hidden>
    <div class="preview">
      <img id="soundcloudCover" alt="" />
      <div>
        <div id="soundcloudName"></div>
        <div id="soundcloudMeta"></div>
      </div>
    </div>
    <div class="row-right">
      <button id="soundcloudPreviewCancel">Cancelar</button>
      <button id="soundcloudPreviewStart">Baixar</button>
    </div>
  </div>
  <div class="state state-downloading" data-state="downloading" hidden>
    <div class="bar"><div id="soundcloudBar" class="bar-fill"></div></div>
    <div id="soundcloudCounter"></div>
    <ul id="soundcloudTrackList"></ul>
    <div class="row-right"><button id="soundcloudDownloadCancel">Cancelar</button></div>
  </div>
  <div class="state state-done" data-state="done" hidden>
    <div id="soundcloudSummary"></div>
    <div class="row-right">
      <button id="soundcloudOpenFolder">Ver pasta</button>
      <button id="soundcloudAnother">Baixar outra playlist</button>
    </div>
  </div>
  <div class="state state-error" data-state="error" hidden>
    <div id="soundcloudErrorMessage"></div>
    <div class="row-right"><button id="soundcloudErrorRetry">Voltar</button></div>
  </div>
</div>
```

- [ ] **Step 2: Add brand colors to `renderer/styles.css`**

Append:

```css
.tab[data-tab="youtube"].active { color: #ff0000; border-bottom-color: #ff0000; }
.tab[data-tab="soundcloud"].active { color: #ff5500; border-bottom-color: #ff5500; }
button#youtubeFetch, button#youtubePreviewStart, button#youtubeAnother { background: #ff0000; color: white; }
button#soundcloudFetch, button#soundcloudPreviewStart, button#soundcloudAnother { background: #ff5500; color: white; }
```

- [ ] **Step 3: Commit**

```bash
git add renderer/index.html renderer/styles.css
git commit -m "feat(renderer): add youtube and soundcloud panels and brand colors"
```

---

## Task 11: Renderer — generic tab controller factory

To avoid copy-pasting the Spotify tab logic, extract the state machine into a factory used by all three tabs.

**Files:**
- Create: `renderer/tabs/tab.js`
- Modify: `renderer/tabs/spotify.js`
- Create: `renderer/tabs/youtube.js`
- Create: `renderer/tabs/soundcloud.js`
- Modify: `renderer/main.js`

- [ ] **Step 1: Write the factory in `renderer/tabs/tab.js`**

```javascript
const $ = (s, root = document) => root.querySelector(s);

function escapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

export function initTab(config) {
  const {
    panelId, urlInputId, fetchBtnId,
    previewCoverId, previewNameId, previewMetaId,
    previewCancelId, previewStartId,
    barId, counterId, trackListId, downloadCancelId,
    summaryId, openFolderId, anotherId,
    errorMessageId, errorRetryId,
    fetchPlaylistFn,
  } = config;

  const panel = $(panelId);
  let currentData = null;
  let currentTotal = 0;
  let completed = 0;

  function showState(name) {
    panel.querySelectorAll('.state').forEach(el => { el.hidden = el.dataset.state !== name; });
  }

  function renderPreview(data) {
    $(previewNameId).textContent = data.playlistName;
    $(previewMetaId).textContent = `${data.platform === 'spotify' ? 'Spotify' : data.platform === 'youtube' ? 'YouTube' : 'SoundCloud'} · ${data.tracks.length} ${data.tracks.length === 1 ? 'música' : 'músicas'}`;
    if (data.coverUrl) $(previewCoverId).src = data.coverUrl;
  }

  function renderTrackList(tracks) {
    const ul = $(trackListId);
    ul.innerHTML = '';
    tracks.forEach((t, i) => {
      const li = document.createElement('li');
      li.dataset.idx = i;
      li.innerHTML = `<span class="num">${i + 1}</span><span class="name">${escapeHtml(t.artist)} — ${escapeHtml(t.name)}</span><span class="status"></span>`;
      ul.appendChild(li);
    });
  }

  function setTrackStatus(idx, icon) {
    const li = $(trackListId).querySelector(`li[data-idx="${idx}"]`);
    if (li) li.querySelector('.status').textContent = icon;
  }

  function showError(msg) {
    $(errorMessageId).textContent = msg;
    showState('error');
  }

  $(fetchBtnId).addEventListener('click', async () => {
    const url = $(urlInputId).value.trim();
    if (!url) return;
    showState('loading');
    const resp = await fetchPlaylistFn(url);
    if (!resp.ok) { showError(resp.userMessage || 'Falha ao buscar.'); return; }
    currentData = resp.data;
    renderPreview(currentData);
    showState('preview');
  });

  $(previewCancelId).addEventListener('click', () => {
    currentData = null;
    showState('empty');
  });

  $(previewStartId).addEventListener('click', async () => {
    currentTotal = currentData.tracks.length;
    completed = 0;
    renderTrackList(currentData.tracks);
    $(counterId).textContent = `0 / ${currentTotal}`;
    $(barId).style.width = '0%';
    showState('downloading');

    const unsub = window.api.download.onProgress((evt) => {
      if (evt.type === 'started') setTrackStatus(evt.trackIdx, '↻');
      else if (evt.type === 'done') { setTrackStatus(evt.trackIdx, '✓'); completed++; }
      else if (evt.type === 'not_found') { setTrackStatus(evt.trackIdx, '✗'); completed++; }
      else if (evt.type === 'skipped') { setTrackStatus(evt.trackIdx, '·'); completed++; }
      $(counterId).textContent = `${completed} / ${currentTotal}`;
      $(barId).style.width = `${Math.round((completed / currentTotal) * 100)}%`;
    });

    const resp = await window.api.download.start({
      playlistName: currentData.playlistName,
      platform: currentData.platform,
      sourceId: currentData.sourceId,
      tracks: currentData.tracks,
    });
    unsub();
    if (!resp.ok) { showError(resp.userMessage || 'Erro ao baixar.'); return; }

    const okCount = resp.data.ok.length;
    const failed = resp.data.failed.length;
    $(summaryId).innerHTML =
      `<div style="font-size:28px;font-weight:700;">${okCount} / ${currentTotal}</div>` +
      `<div>músicas baixadas</div>` +
      (failed ? `<div style="margin-top:8px;color:#cc6633">⚠ ${failed} não encontradas</div>` : '');
    showState('done');
  });

  $(downloadCancelId).addEventListener('click', () => window.api.download.cancel());

  $(openFolderId).addEventListener('click', async () => {
    const cfg = await window.api.config.get();
    await window.api.shell.openFolder(`${cfg.outputDir}/${currentData.playlistName}`);
  });

  $(anotherId).addEventListener('click', () => {
    $(urlInputId).value = '';
    showState('empty');
  });

  $(errorRetryId).addEventListener('click', () => showState('empty'));

  showState('empty');
}
```

- [ ] **Step 2: Replace `renderer/tabs/spotify.js`**

```javascript
import { initTab } from './tab.js';

export function initSpotifyTab() {
  initTab({
    panelId: '#spotifyPanel',
    urlInputId: '#spotifyUrl',
    fetchBtnId: '#spotifyFetch',
    previewCoverId: '#previewCover',
    previewNameId: '#previewName',
    previewMetaId: '#previewMeta',
    previewCancelId: '#previewCancel',
    previewStartId: '#previewStart',
    barId: '#bar',
    counterId: '#counter',
    trackListId: '#trackList',
    downloadCancelId: '#downloadCancel',
    summaryId: '#summary',
    openFolderId: '#openFolder',
    anotherId: '#anotherPlaylist',
    errorMessageId: '#errorMessage',
    errorRetryId: '#errorRetry',
    fetchPlaylistFn: (url) => window.api.spotify.fetchPlaylist(url),
  });
}
```

- [ ] **Step 3: Create `renderer/tabs/youtube.js`**

```javascript
import { initTab } from './tab.js';

export function initYoutubeTab() {
  initTab({
    panelId: '#youtubePanel',
    urlInputId: '#youtubeUrl',
    fetchBtnId: '#youtubeFetch',
    previewCoverId: '#youtubeCover',
    previewNameId: '#youtubeName',
    previewMetaId: '#youtubeMeta',
    previewCancelId: '#youtubePreviewCancel',
    previewStartId: '#youtubePreviewStart',
    barId: '#youtubeBar',
    counterId: '#youtubeCounter',
    trackListId: '#youtubeTrackList',
    downloadCancelId: '#youtubeDownloadCancel',
    summaryId: '#youtubeSummary',
    openFolderId: '#youtubeOpenFolder',
    anotherId: '#youtubeAnother',
    errorMessageId: '#youtubeErrorMessage',
    errorRetryId: '#youtubeErrorRetry',
    fetchPlaylistFn: (url) => window.api.youtube.fetchPlaylist(url),
  });
}
```

- [ ] **Step 4: Create `renderer/tabs/soundcloud.js`**

```javascript
import { initTab } from './tab.js';

export function initSoundcloudTab() {
  initTab({
    panelId: '#soundcloudPanel',
    urlInputId: '#soundcloudUrl',
    fetchBtnId: '#soundcloudFetch',
    previewCoverId: '#soundcloudCover',
    previewNameId: '#soundcloudName',
    previewMetaId: '#soundcloudMeta',
    previewCancelId: '#soundcloudPreviewCancel',
    previewStartId: '#soundcloudPreviewStart',
    barId: '#soundcloudBar',
    counterId: '#soundcloudCounter',
    trackListId: '#soundcloudTrackList',
    downloadCancelId: '#soundcloudDownloadCancel',
    summaryId: '#soundcloudSummary',
    openFolderId: '#soundcloudOpenFolder',
    anotherId: '#soundcloudAnother',
    errorMessageId: '#soundcloudErrorMessage',
    errorRetryId: '#soundcloudErrorRetry',
    fetchPlaylistFn: (url) => window.api.soundcloud.fetchPlaylist(url),
  });
}
```

- [ ] **Step 5: Update `renderer/main.js`**

```javascript
import { initSpotifyTab } from './tabs/spotify.js';
import { initYoutubeTab } from './tabs/youtube.js';
import { initSoundcloudTab } from './tabs/soundcloud.js';

const $ = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => Array.from(root.querySelectorAll(s));

async function init() {
  const cfg = await window.api.config.get();
  if (!cfg.firstRunCompleted) {
    showWelcome(cfg);
  } else {
    showMain();
  }
}

function showWelcome(cfg) {
  $('#welcome').hidden = false;
  $('#welcomeFolder').textContent = `📁 ${cfg.outputDir}`;
  $('#welcomeStart').addEventListener('click', async () => {
    await window.api.config.set({ firstRunCompleted: true });
    $('#welcome').hidden = true;
    showMain();
  });
}

function showMain() {
  $('#main').hidden = false;
  initSpotifyTab();
  initYoutubeTab();
  initSoundcloudTab();
  wireTabSwitching();
}

function wireTabSwitching() {
  const tabs = $$('.tab');
  const panels = {
    spotify: $('#spotifyPanel'),
    youtube: $('#youtubePanel'),
    soundcloud: $('#soundcloudPanel'),
  };
  tabs.forEach((btn) => {
    btn.addEventListener('click', () => {
      tabs.forEach(t => t.classList.toggle('active', t === btn));
      Object.entries(panels).forEach(([name, el]) => { el.hidden = name !== btn.dataset.tab; });
    });
  });
}

init().catch(console.error);
```

- [ ] **Step 6: Commit**

```bash
git add renderer/main.js renderer/tabs/tab.js renderer/tabs/spotify.js renderer/tabs/youtube.js renderer/tabs/soundcloud.js
git commit -m "feat(renderer): generic tab factory and three tabs wired"
```

---

## Task 12: End-to-end smoke for all three platforms

- [ ] **Step 1: Pre-flight**

```bash
test -f .env || echo "MISSING .env"
test -x binaries/mac-arm64/yt-dlp -o -x binaries/mac-x64/yt-dlp -o -x binaries/win-x64/yt-dlp.exe || echo "MISSING yt-dlp"
```

- [ ] **Step 2: Prepare URLs**
  - **Spotify:** the same 2-3 track playlist used in Plan A smoke.
  - **YouTube:** a short public playlist with 2-3 videos.
  - **SoundCloud:** a public set with 2-3 tracks (or one track).

- [ ] **Step 3: Run the app**

```bash
npm start
```

- [ ] **Step 4: Smoke each tab**

For each tab in turn:
1. Paste the URL and click "Buscar".
2. Preview shows correct name + count.
3. Click "Baixar". Track list animates with ✓ marks.
4. Done screen shows `N / N`.
5. "Ver pasta" opens the folder.
6. Open one MP3 and verify:
   - Filename matches `Artist - Title (Mix) [Label].mp3` (mix and label may be absent if the source has neither and MusicBrainz did not find them — that is the spec's graceful degradation).
   - ID3 tags: TIT2 (clean title), TIT3 (mix when present), TPE1, TALB, TRCK, TPUB, TCON, comment with `Source: ...` and `MB: ...` when enrichment hit.

- [ ] **Step 5: Re-run with the same URL — verify skip**

Repeat step 4 for any tab. Expected: every track shows "·" (skip) and the download finishes in under a second. The MP3s are not re-downloaded.

- [ ] **Step 6: Re-run with the OUTPUT FOLDER deleted but library kept**

Delete the output folder for one playlist on disk. Re-run. Expected: still skips (library is the source of truth in Plan B; folder presence is not). If you want a re-download, manually clear the entry in `library.json`. Note this as Plan C polish.

- [ ] **Step 7: Commit any notes**

```bash
git add docs/
git diff --cached --quiet || git commit -m "docs: smoke findings from plan B"
```

---

## Plan B complete

What you have at this point:
- Three platform tabs: Spotify, YouTube, SoundCloud.
- DJ-style filenames with mix type and label: `Artist - Title (Mix) [Label].mp3`.
- ID3 tags: TIT2, TIT3 (subtitle), TPE1, TALB, TPE2, TRCK, TYER, TPUB, TCON, TSRC, APIC, COMM (with provenance).
- MusicBrainz enrichment for non-Spotify sources (with disk cache).
- Skip-if-exists library so re-runs of the same URL are near-instant.

What is intentionally **not yet** present:
- Distributable installer (`.dmg` / `.exe`) — Plan C.
- Bundled binaries that work on machines without `brew install ffmpeg` — Plan C.
- Settings dialog (output folder change, library reset) — Plan C.
- Code-signing instructions for friends — Plan C.
- Full tier-2 / tier-3 error UI polish — Plan C.
- Removal of legacy `app.js`, `src/getPlaylist.js`, and other Apple Music code — Plan C cleanup.
