# Strict 320 kbps Mode Design Document

**Date:** 2026-06-07
**Status:** Approved by user; ready for implementation planning
**Extends:** `docs/superpowers/specs/2026-06-06-music-downloader-design.md` and `docs/superpowers/specs/2026-06-06-plan-d-spotify-direct-design.md`
**Pre-spec exploration:** `docs/superpowers/briefs/2026-06-06-strict-320-mode-brief.md`

---

## 1. Context

Plan D shipped (v0.2.0) with a silent fallback: when the Spotify-direct path fails for any recoverable reason (track not in catalog, region-locked, librespot transient bug, auth issue), the pipeline drops down to the YouTube path and downloads ~160 kbps Opus → ~160 kbps MP3 instead. For a non-DJ "amigo leigo" this is the right default: every track in the playlist ends up on disk, even if a few are at lower quality than the rest.

For a DJ — the project owner's primary use case — that fallback breaks a hard rule: every track must be 320 kbps. A library mixed with a few 160 kbps files is worse than a library missing those tracks: the DJ would rather know what failed and re-acquire it from another source than have a corrupted-quality file hiding in a folder of master-quality ones.

Strict 320 kbps Mode is a per-install toggle that flips that policy. When on, recoverable Spotify-direct failures are surfaced as skipped tracks instead of YouTube-quality fallbacks. The list of skipped tracks is presented for follow-up.

## 2. Goals

- A friend (or the project owner) can flip "Modo strict 320 kbps" in the Settings dialog. The choice persists across launches.
- When the toggle is on and the friend is connected to Spotify Premium:
  - Tracks that Spotify-direct downloads successfully reach the disk at 320 kbps as today.
  - Tracks that Spotify-direct fails for any recoverable reason are NOT silently fallen back to YouTube. They are marked `quality_floor_not_met` and listed in the Done summary.
- The Done summary, when strict mode produced any skips, surfaces a copyable list of the skipped tracks so the DJ can re-acquire them elsewhere.
- Fresh installs default the toggle to **on**. The project owner — who is the primary user the project is now optimizing for — and any DJ-shaped friend gets the strict behavior without setup.
- The toggle is honored across re-runs of the same playlist: the library does not register a `quality_floor_not_met` track, so a future run with strict off (or with Spotify-direct now working) will re-try it.

## 3. Non-Goals

- **Configurable quality floor** (e.g., a dropdown for 192/256/320). Binary on/off only. Adding numeric configurability adds UI surface and decision fatigue for negligible benefit.
- **Per-tab override.** Strict mode applies to the Spotify tab; the YouTube and SoundCloud tabs are unchanged. YouTube and SoundCloud *are* the source there — there is no fallback to be strict about.
- **A new error tier for "skipped by strict mode."** Strict skips reuse the existing tier-1 silent path (recoverable, recorded in summary). No modal, no banner, no log line.
- **Automatic retry of skipped tracks on the next run.** The DJ explicitly chooses when to retry by re-running the playlist URL with the toggle in their preferred state.
- **A separate "audited" history view** showing which library entries were 320 vs 160. The existing ID3 `COMM` provenance field already records the actual source per track.
- **Migration prompts** for existing installs to flip the toggle on. The default applies to fresh installs only; existing installs keep their current behavior unless the user touches Settings.

## 4. Behavior Matrix

The strict toggle interacts with the Plan D fallback rules in exactly one place: the Spotify tab when the Spotify-direct path is attempted and returns a recoverable error.

| Tab | Connected to Spotify Premium? | Strict 320 mode? | Spotify-direct outcome | Pipeline action |
|-----|-------------------------------|------------------|------------------------|-----------------|
| Spotify | Yes | on (default) | Success | Use Spotify, write 320, register |
| Spotify | Yes | on (default) | Recoverable failure | **Skip, push to `failed` with `reason: 'quality_floor_not_met'`**, do NOT register |
| Spotify | Yes | off | Success | Use Spotify, write 320, register |
| Spotify | Yes | off | Recoverable failure | Fall back to YouTube, write at YouTube bitrate, register (current Plan D behavior) |
| Spotify | No | on | (Spotify-direct not attempted) | YouTube path, register (strict has no effect when there is no Spotify source) |
| Spotify | No | off | (Spotify-direct not attempted) | YouTube path, register |
| YouTube | (n/a) | (n/a) | (n/a) | YouTube path (unchanged) |
| SoundCloud | (n/a) | (n/a) | (n/a) | SoundCloud path (unchanged) |

**Subtle but important:** when strict is on and the friend is NOT connected to Spotify Premium, the Spotify tab still uses YouTube — strict is moot because there is no 320 source available to require. The Settings copy spells this out explicitly so no one wonders why their YouTube-tab-shaped Spotify downloads still happen.

## 5. Architecture

This change is small and contained. No new modules, no new dependencies, no new sidecar binaries.

### Components touched

| Path | Action |
|------|--------|
| `main/storage/config.js` | Defaults schema gains `strict320Mode: true`; `set()` continues to merge arbitrary keys (no change needed there) |
| `main/download/pipeline.js` | New `pipelineOptions.strict320Mode` parameter; when true and Spotify-direct returns a recoverable error, do not fall through to YouTube — push to `failed` with `reason: 'quality_floor_not_met'` and skip `library.register()` |
| `main/ipc.js` | `download:start` reads `strict320Mode` from config before invoking the pipeline; passes it through |
| `renderer/index.html` | Settings dialog gains a new row for the toggle below the Spotify Premium section |
| `renderer/main.js` | Wires the checkbox: reads current value when opening Settings; writes to `config.set({ strict320Mode })` on toggle |
| `renderer/tabs/tab.js` | Done-state summary renderer shows a "fonte 320 indisponível" callout when any failed track has `reason === 'quality_floor_not_met'`, including a copy-to-clipboard button for the list |

### What "recoverable failure" means in code

`main/spotify-direct/zotify.js` throws typed errors with `code` set to one of:

- `TRACK_NOT_FOUND_SPOTIFY`
- `REGION_LOCKED`
- `PREMIUM_REQUIRED`
- `AUTH_EXPIRED`
- `ZOTIFY_UNRECOGNIZED`

Plus `NOT_CONNECTED` is treated by the pipeline as "no Spotify-direct attempt was made."

The pipeline already has a `recoverable` set (Plan D Task 11). Strict mode reuses the same set: any error in that set, with strict on, triggers a `quality_floor_not_met` skip instead of the YouTube fallback. Non-recoverable errors (cancellation, disk-full) propagate unchanged regardless of strict.

### Pipeline pseudocode change

The relevant snippet in `main/download/pipeline.js` today (post-Plan D):

```javascript
} catch (err) {
  const recoverable = ['TRACK_NOT_FOUND_SPOTIFY', 'REGION_LOCKED', 'PREMIUM_REQUIRED',
                      'ZOTIFY_UNRECOGNIZED', 'AUTH_EXPIRED', 'NOT_CONNECTED'];
  if (recoverable.includes(err.code)) {
    fallbackReason = err.code.toLowerCase();
    // (continues to YouTube path)
  } else {
    throw err;
  }
}
```

Becomes:

```javascript
} catch (err) {
  const recoverable = ['TRACK_NOT_FOUND_SPOTIFY', 'REGION_LOCKED', 'PREMIUM_REQUIRED',
                      'ZOTIFY_UNRECOGNIZED', 'AUTH_EXPIRED', 'NOT_CONNECTED'];
  if (recoverable.includes(err.code)) {
    if (strict320Mode) {
      onEvent?.({ type: 'not_found', trackIdx: idx, reason: 'quality_floor_not_met' });
      failed.push({ track, reason: 'quality_floor_not_met' });
      continue;  // skip the rest of this track; do NOT register in library
    }
    fallbackReason = err.code.toLowerCase();
    // (continues to YouTube path)
  } else {
    throw err;
  }
}
```

## 6. UI Changes

### Settings dialog row

Below the existing "Spotify Premium" block, before "Histórico", a new row:

```
─────────────
Qualidade:
  ☑ Modo strict 320 kbps
     Tracks que não tiverem fonte em 320 kbps são puladas em vez de
     baixadas em qualidade menor. Só faz efeito quando Spotify Premium
     está conectado.
─────────────
```

The checkbox is bound to `config.strict320Mode`. Toggling it persists immediately. Reflects current value when the dialog opens.

### Done-state summary

The Plan D summary already breaks down "X via Spotify · Y via YouTube" when both sources contributed. Strict mode adds one more line when relevant:

```
                    12 / 14
              músicas baixadas em 320

        ⚠ 2 não baixadas (fonte 320 indisponível):
          • Talpa — Malfunction
          • Burn In Noise, Loud, Libra — A Real Good Time (Libra Remix)

        [ Copiar lista ]  [ Ver pasta ]  [ Baixar outra playlist ]
```

- The "Copiar lista" button copies the list of skipped tracks (one per line, format `Artist — Title`) to the clipboard for easy pasting into a search bar elsewhere.
- The callout appears only when at least one `failed[].reason === 'quality_floor_not_met'`.
- The "baixadas em 320" wording is used only when strict is on. When strict is off, the existing "músicas baixadas" wording stays.

### No banner or modal

Strict mode does not show a banner or modal anywhere else in the UI. The setting is in Settings, the consequence shows in the Done summary, that is the complete UI surface. The toggle is for the friend who reads Settings; the consequence is for the friend who sees what didn't download.

## 7. Migration / Compatibility

- **Fresh installs** (no existing `config.json`): the defaults function returns `strict320Mode: true`. User sees strict behavior immediately.
- **Existing installs upgrading to this version**: `config.json` does not contain `strict320Mode`. The defaults function fills the missing key with `true`. Effectively: existing installs also flip to strict on upgrade.

This is a behavior change for existing users. It is the deliberate choice — strict is what the project's primary user wants, and the friend population that downloaded v0.2.0 is small enough that the surprise is manageable. The release notes for v0.2.1 should call this out:

> "Modo strict 320 kbps agora vem ligado por padrão. Se preferir o comportamento anterior (fallback automático pro YouTube quando o Spotify falha), desligue em Configurações → Qualidade."

## 8. Errors, Configuration, Recovery

### Error taxonomy

Strict mode introduces no new error tiers. The skip is tier-1 (recoverable silent), surfaced only in the summary. The track does not go into the error log. The `quality_floor_not_met` reason string is a deliberately unique value so future analytics or debugging can grep for it.

### Configuration

`config.json` gains one key:

```json
{
  "outputDir": "...",
  "firstRunCompleted": true,
  "spotifyBannerDismissedAt": "2026-06-15T17:33:00Z",
  "strict320Mode": true
}
```

No other files change. No new directories. No new external state.

### Recovery from a strict skip

A track marked `quality_floor_not_met` is intentionally **not** registered in `library.json`. This means:

- Re-running the same playlist with strict on and the same root cause (e.g., still region-locked) will re-skip it (correct).
- Re-running the same playlist with strict off will retry it, fall back to YouTube, write the file, and register (correct).
- Re-running the same playlist with strict on after the root cause resolves (e.g., Spotify token refreshed, track re-added to catalog) will retry Spotify-direct and succeed (correct).

This is the right behavior precisely because library registration is the marker of "permanently done." A strict-skipped track is "not done yet" — the DJ should be able to come back to it later.

## 9. Testing Strategy

### Unit (Vitest)

- **`config.js` defaults**: a fresh install (empty `userDataDir`) reads back `strict320Mode: true`. A file with explicit `false` reads back `false`.
- **`pipeline.js` strict on, recoverable error**: mock `spotifyDirect.downloadTrack` to throw `{ code: 'TRACK_NOT_FOUND_SPOTIFY' }`. With `strict320Mode: true`, assert:
  - `failed[0].reason === 'quality_floor_not_met'`
  - `library.register` was NOT called for the track
  - `ytdlp.searchYouTubeForTrack` was NOT called for the track
- **`pipeline.js` strict on, non-recoverable error**: with `signal.aborted`, the error still propagates as today.
- **`pipeline.js` strict off, recoverable error**: existing Plan D Task 11 test still passes (YouTube fallback called).
- **`pipeline.js` strict on, Spotify success**: track completes normally; no behavior difference.

### Integration

The summary renderer (`renderer/tabs/tab.js`) is exercised through manual smoke. No headless renderer tests added.

### Manual smoke (before tagging v0.2.1)

1. Open Settings → confirm "Modo strict 320 kbps" exists and reflects current value (default on for fresh install).
2. Toggle off → close dialog → reopen → confirm value persisted.
3. Toggle on → download a playlist known to contain at least one Premium-locked or region-locked track.
4. Confirm:
   - Successful tracks land at 320 in the output folder.
   - The locked track is NOT in the output folder.
   - Summary shows "X / Y músicas baixadas em 320" with a "fonte 320 indisponível" callout listing the locked track.
   - "Copiar lista" button copies the expected text to clipboard.
5. Toggle off → re-run the same playlist URL.
6. Confirm the previously-skipped track now downloads via YouTube and lands in the folder.

## 10. Open Questions / Future Work

- **Sticky vs. session-only strict**: the toggle is sticky in `config.json`. If friends ever want a session-only override ("just this download, fall back to YouTube"), a session-state override above the playlist preview could be added later. Not in scope here.
- **Visual indication on the Spotify tab when strict is on**: not in this design. The Done summary suffices. If real-use friction emerges (friends not realizing why tracks didn't download), a small "strict on" indicator next to the connect pill is a one-hour follow-up.
- **Per-playlist strict override**: out of scope. The strict toggle is a global preference; per-playlist behavior would multiply UI surface for marginal benefit.
- **Telemetry / aggregate "% strict-skipped"**: not collected. This app does not phone home.

## 11. Notes for the Implementation Plan

- Branch: `feat/strict-320-mode` (already created).
- Estimated effort: 1-2 focused hours.
- Release vehicle: `v0.2.1` patch release. Same workflow path as v0.2.0; no new GitHub Secrets required.
- The implementation should land in a single PR with one commit per task. The TDD shape mirrors Plan A: write the failing test, run, implement, run, commit.
