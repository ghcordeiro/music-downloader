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
    } catch {
      return null;
    }
  }

  return { lookup };
}

module.exports = { createEnrichment };
