# Brief 1 — Strict 320 kbps Mode

**Date:** 2026-06-06
**Status:** Pre-spec exploration. Not yet ready for implementation.
**Estimated effort:** 1-2 hours
**Risk level:** Low (small, contained policy change)

---

## Problem

Plan D shipped with a silent fallback: when the Spotify-direct path fails for any reason (track not in catalog, region-locked, librespot transient bug, auth issue), the pipeline falls through to YouTube and downloads ~160 kbps Opus → ~160 kbps MP3 instead.

For a "DJ who has the hard rule that every track must be 320 kbps," this fallback is the worst of both worlds: a corrupted-quality file in their library, no easy way to tell which tracks are master and which are fallback (unless they read the ID3 `COMM` field), and no opportunity to re-acquire the master later.

## Goal

A friend can opt into a "Strict 320" mode in Settings. When enabled:

- The Spotify tab pipeline **does not** fall back to YouTube on Spotify-direct failure.
- Failed tracks are emitted as `not_found` with `reason: 'quality_floor_not_met'` instead of being downloaded at lower quality.
- The Done summary shows a per-status breakdown: `12/14 baixadas em 320 · 2 não baixadas (fonte 320 indisponível)`.
- The list of unobtainable tracks is selectable/copyable so the DJ can hunt them elsewhere.

When disabled (default): current Plan D behavior, transparent fallback.

## Non-Goals

- Changing the YouTube tab. It always uses YouTube; no concept of "strict" applies.
- Changing the SoundCloud tab. Same reasoning.
- Auto-retrying failed tracks later. The DJ wants to know what failed and decide for themselves.
- Setting a numeric quality floor configurable per friend. It's binary: strict-or-not.

## Approach

This is a flag that flows from Settings → IPC → pipeline. No new architecture.

### Files touched

| Path | Change |
|------|--------|
| `main/storage/config.js` | New optional key `strict320Mode: boolean`, defaults to `false` |
| `renderer/index.html` | Settings dialog gets a checkbox row |
| `renderer/main.js` | Wire the checkbox to `config.set({ strict320Mode })` |
| `main/download/pipeline.js` | Read the flag; when `true` and Spotify-direct fails recoverably, skip fallback and emit `not_found` with `quality_floor_not_met` |
| `renderer/tabs/tab.js` | Summary block shows `não baixadas (fonte 320 indisponível)` when relevant |
| `tests/download/pipeline.test.js` | New cases: strict mode + Spotify-direct failure → no YouTube call, track in `failed` with correct reason |

### Behavior matrix

| Spotify connected? | Strict mode? | Spotify-direct outcome | Pipeline action |
|---|---|---|---|
| Yes | Off (default) | Success | Use Spotify, write 320 |
| Yes | Off | Recoverable failure | Fall back to YouTube |
| Yes | **On** | Success | Use Spotify, write 320 |
| Yes | **On** | Recoverable failure | **Skip; mark `quality_floor_not_met`** |
| No | Off | (n/a) | Use YouTube directly |
| No | On | (n/a) | **Use YouTube anyway** (user is on Spotify tab without auth — strict is moot) |

The last row is a UX choice worth surfacing in the Settings copy: "Modo strict só vale quando Spotify Premium está conectado. Sem conexão, a aba Spotify continua usando YouTube como hoje."

## Design decisions left for proper brainstorming

These are small — the brief is honest about it.

1. **Default**: off (preserves current "amigo leigo" behavior) or on (assumes the friend who installed this is a DJ)? For your case as primary user: probably **on** locally, **off** as factory default for new installs.
2. **Per-tab override**: do we ever want strict on YouTube tab too? Currently no — YouTube *is* the source there. Skip unless a real use case emerges.
3. **Summary copy**: "fonte 320 indisponível" or "abaixo do mínimo de 320"? The first reads more naturally. Lock in during spec.

## Test plan

- Unit: pipeline with mocked `spotifyDirect` that throws `TRACK_NOT_FOUND_SPOTIFY`. With strict on, `failed[0].reason === 'quality_floor_not_met'`; with strict off, the track completes via YouTube mock.
- Smoke: real playlist with at least one track known to fail Spotify-direct (region-locked or removed); verify strict-on skips it and strict-off downloads it via YouTube.

## Open question for the user

In your daily DJ flow, do you want strict mode **default-on for fresh installs**, or **default-off and you flip it in Settings**? Answer determines the config default and one line of Settings copy.

---

**Next step if chosen:** Promote to a full spec via the `brainstorming` skill (most of the work is already here), then a 4-5 task implementation plan via `writing-plans`. The full cycle realistically takes about an hour of design conversation plus the 1-2h implementation.
