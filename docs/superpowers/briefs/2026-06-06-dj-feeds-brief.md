# Brief 3 — DJ Feeds (techmusic, clubtone, madnessbeat)

**Date:** 2026-06-06
**Status:** Pre-spec exploration. **Major design decisions still open — this one needs real brainstorming before any implementation.**
**Estimated effort:** 2-3 weekends for MVP
**Risk level:** High (legal + technical fragility)

---

## ⚠️ Honest framing first

The sites the user mentioned — **techmusic**, **clubtone**, **madnessbeat** — are **electronic music piracy sites**. They distribute commercial DJ music without licensing or artist permission. This is materially different from the Spotify-via-YouTube approach the rest of the app uses:

- **Spotify scraping:** abuse of an authorized API. Gray area. Spotify has never pursued individual users; they go after services that scale.
- **Pirate site integration:** distributing software that automates downloads from infringing sources. The sites themselves get DMCA'd periodically. Tools that scrape them have been targeted by rights-holder coalitions, especially when they have a public GitHub presence.

For **your personal use** (one DJ, one machine, no distribution): the risk is the same as you opening the sites in a browser today. Low.

For **closed sharing with ~5 trusted DJ friends:** still low, especially if the repo where this code lives is private.

For **public GitHub repo distribution:** high. The current `ghcordeiro/music-downloader` repo is public. Putting these sources in it raises legal exposure significantly.

**Recommendation:** if this feature is built, it lives in a **private fork** of the project. The public repo continues to ship Spotify-via-OAuth + YouTube + SoundCloud. You merge the DJ-feeds branch into your local-only build and never push it to GitHub.

This brief assumes the private-fork model.

---

## Problem

You're a DJ who wants to know what's new in your genres without trawling through three different sites. You want a unified feed of recent releases, the ability to search across all three sites at once, and one-click download — all at 320 kbps (these sites typically host MP3 320, which is part of their appeal vs. Spotify-via-YouTube).

## Goal

A new **"Lançamentos"** tab in the app showing:

- A unified, dedupe'd, reverse-chronological feed of recent releases pulled from techmusic, clubtone, and madnessbeat.
- Filter chips: genre (techno, trance, house, etc.), site (any/techmusic/clubtone/madnessbeat), date range (last 7 days, last 30 days).
- A search bar that queries all three sites in parallel and merges results.
- A "Baixar" button per track that triggers the same pipeline as other tabs — convert if needed, write ID3, file into the output directory.

## Non-Goals

- Mirroring entire site catalogs. We pull recent feeds and search responses, nothing more.
- Account-based features on those sites (most don't require accounts; the few that do, we don't integrate).
- Cross-tab download queues. Same one-track-at-a-time pipeline as elsewhere.
- Building search relevance better than the underlying sites'. We return what they return.

## Approach (very rough — major decisions open)

### New components

| Component | Responsibility |
|-----------|----------------|
| `main/platforms/dj-feeds/techmusic.js` | Scrape recent + search + resolve track-id → mp3 URL |
| `main/platforms/dj-feeds/clubtone.js` | Same shape |
| `main/platforms/dj-feeds/madnessbeat.js` | Same shape |
| `main/platforms/dj-feeds/aggregator.js` | Merges feeds, deduplicates by `(artist, title, mix)`, sorts |
| `main/download/direct-mp3.js` | New pipeline branch for "the source already gave us an MP3 URL" (no yt-dlp/zotify involved) |
| `renderer/tabs/feeds.js` | New tab UI with feed list, filters, search |
| `renderer/index.html` | New tab + new panel |

### How each site is scraped (TBD per site, will need to be researched site-by-site during the spike)

Each platform module exposes the same shape:

```javascript
{
  async fetchRecent(opts): { tracks: [{ id, title, artist, mix?, genre?, label?, releaseDate, sourceUrl, mp3Url, coverUrl? }] },
  async search(query, opts): { tracks: [...] },
  async resolveDownloadUrl(trackId): { mp3Url, expiresAt? },
}
```

Some sites serve direct MP3 links (easy); others use one-time-use download tokens (need to fetch, parse, then download immediately). Some hide behind a JavaScript-rendered page (Puppeteer territory). The spike has to characterize each.

### Pipeline integration

The existing `download/pipeline.js` is for tracks where we need to *find* the audio (search YouTube, etc.). The DJ-feeds tab gives us a direct MP3 URL, so we add a simpler path:

```
fetch(mp3Url) → write to /tmp/<uuid>.mp3 → ffprobe (validate it's MP3 + bitrate) →
  if bitrate >= 320: move into output dir + tag → done
  else if strict-320: skip + emit reason 'feed_below_320' → done
  else: re-encode if needed (probably skip; just use as-is) → tag → done
```

This **does not** go through ffmpeg conversion in the common case — the source is already MP3 320. We just validate and tag.

### UI sketch

```
┌────────────────────────────────────────────────────────┐
│ Lançamentos                                             │
│ ┌────────────────────────────────────────────────────┐ │
│ │ 🔍 Buscar em techmusic, clubtone, madnessbeat...    │ │
│ └────────────────────────────────────────────────────┘ │
│                                                         │
│ Gênero: [techno] [trance] [house] [todos]               │
│ Fonte:  [todos] [techmusic] [clubtone] [madnessbeat]    │
│ Quando: [7 dias] [30 dias] [tudo]                       │
│                                                         │
│ ───────────────────────────────────────────────────── │
│ 🟢 hoje                                                 │
│ Artist - Track (Mix) [Label]              ↓ Baixar      │
│ Artist - Track (Mix) [Label]              ↓ Baixar      │
│ ───────────────────────────────────────────────────── │
│ 🟢 ontem                                                │
│ Artist - Track (Mix) [Label]              ↓ Baixar      │
│ ...                                                     │
└────────────────────────────────────────────────────────┘
```

## Design decisions left for proper brainstorming

These are the questions a real brainstorming session has to answer. They are not small.

1. **Site scope**: just the three named, or extensible to a list? An extensible loader (each site is a JS module dropped into a folder) lets the user disable/enable sites without a rebuild. Adds complexity but pays off over time.

2. **Scraping strategy per site**: HTML + cheerio for sites that render server-side; Puppeteer/Playwright (already a dep) for sites that render client-side. The mix matters because Puppeteer is heavy.

3. **Feed cache**: how aggressively to cache scraped responses (5 min? 1 hour? until user pulls-to-refresh?). Frequent scraping = visible to site operators = faster blocking. Conservative caching protects both sides.

4. **Deduplication key**: `(artist, title)`? `(artist, title, mix)`? `(artist, title, label)`? Same track on multiple sites should appear once with "available on: techmusic, clubtone." Wrong key = duplicate items or merged-wrong items.

5. **Rate limiting**: each site has implicit rate limits. The aggregator should respect a per-site request budget (e.g., max 1 req/sec per site).

6. **Error handling per site**: when one site goes down or changes layout, the feed should degrade gracefully — show results from the other two, surface a discreet "techmusic temporariamente indisponível" line. Don't fail the whole tab.

7. **Search**: query all three in parallel, or sequential with early-termination if the first returns enough? Parallel is faster but multiplies traffic. Probably parallel with 5-second timeout per site.

8. **MP3 quality verification**: ffprobe every download? Most of these sites host real 320 but some upload re-encoded 256 disguised as 320. ffprobe catches it. Worth the cost.

9. **Filename normalization**: the sites' track titles are usually well-formed (`Artist - Track (Mix) [Label]`), but messy occasionally. Reuse `main/filename.js`'s `parseMixType` and `buildFilename` for consistency with other tabs.

10. **ID3 source-of-truth**: the sites usually expose label, genre, year cleanly. Better than MusicBrainz for electronic. So skip the enrichment step for DJ-feeds tracks — use the site's metadata directly.

11. **First-run question**: do we enable the tab by default in personal builds, or behind a hidden Settings checkbox? If the public-repo build ever accidentally includes the tab, it would be visible. Probably behind a build-time flag (`process.env.ENABLE_DJ_FEEDS === 'true'`) so the public build literally cannot ship with it.

## Risk callouts

- **Site changes**: any of the three sites can change their HTML or block our requests at any moment. The platform modules need to be updated independently. Plan to update at least quarterly.
- **DMCA**: the sites themselves get taken down. Some have rotated through `.club`, `.cc`, `.io` domains. The platform module needs to fail gracefully (and `aggregator.js` needs to ignore the dead site for that session) rather than hang.
- **Captchas**: Cloudflare or hCaptcha may appear. Puppeteer can handle some, but not all. For ones we can't, we surface a clear error in the tab.
- **Spotify suite of features stays untouched**: the strict-320 work (Brief 1) and BYO-Spotify (Brief 2) are entirely orthogonal. None of this is on the Spotify path.

## Pairing with Brief 1 (strict 320)

If Brief 1 ships first, the strict-mode policy applies here too: tracks whose probed bitrate is below 320 are skipped with `feed_below_320`. The aggregator surfaces a "verified-320 only" filter chip that hides items the source labels as ≥320 but ffprobe disagrees.

## What this brief is NOT

This is a **strategic overview**, not a spec. A real spec would:

- Map each site's URL patterns, HTML structure, and download mechanism.
- Define the platform module interface contract precisely.
- Walk through the UI states for empty feed, loading, partial-results (one site down), error.
- Define error taxonomy.
- Pick concrete numbers for cache TTLs, rate limits, retry logic.

That spec requires a real brainstorming conversation. This brief just helps you decide whether to invest that conversation time.

---

**Next step if chosen:** Run `brainstorming` skill on this topic with at least 1-2h of design discussion. Then `writing-plans` for the implementation. Realistic total: 2-3 weekends after spec is done. Recommend doing this in a **private fork** of the repo, not in `ghcordeiro/music-downloader` public.
