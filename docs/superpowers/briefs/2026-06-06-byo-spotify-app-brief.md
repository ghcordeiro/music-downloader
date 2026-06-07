# Brief 2 — BYO Spotify App (Bring Your Own Client ID)

**Date:** 2026-06-06
**Status:** Pre-spec exploration. Not yet ready for implementation.
**Estimated effort:** 1-2 focused weekends
**Risk level:** Medium (UX friction is the main cost; technically straightforward)

---

## Problem

Plan D ships a single Spotify Developer app's OAuth Client ID embedded in the build. Every friend using the app authenticates against **the same** Spotify Developer app. Spotify limits that app to **25 unique users** in its "Development Mode" allowlist — and you, the project owner, have to manually add each friend's Spotify ID to the dashboard. The cap is hard.

The next gate up is **"Extended Quota Mode,"** which requires submitting the app for Spotify review. For an unofficial downloader, that review will be denied — Spotify will not grant extended quota to an app whose purpose is downloading streams (clear ToS violation).

Result: the app is hard-capped at 25 users from a single Spotify Developer app.

## Goal

Move the OAuth Client ID from "embedded in the build" to "configured per friend." Each friend (or each small DJ collective) creates their own Spotify Developer app in 5 minutes, puts themselves in their own 25-user allowlist, and uses their own Client ID in our app. The 25-user cap becomes per-Client-ID instead of per-app, which removes the global ceiling.

## Goals (concrete)

- A first-time-launch flow asks the friend to either (a) connect their existing Spotify Premium via OAuth using their own Client ID, or (b) keep using the YouTube-only path.
- The OAuth Client ID is treated as a user secret: stored encrypted via `safeStorage` alongside the refresh token.
- A clear, friend-readable setup guide (in Portuguese) ships with the app, walking through creating a Spotify Developer app step-by-step (~5 min).
- An optional "test connection" button validates the Client ID before saving.
- The embedded Client ID stays as a fallback for the project owner's own use, behind a hidden setting, so personal testing is not blocked.

## Non-Goals

- Sharing Client IDs between friends. Each friend has their own.
- Helping the friend get Premium. They either have it or they don't.
- Replacing the playlist-metadata Spotify app (the one that uses Client Credentials for `/v1/playlists/...`). That app stays embedded; it is read-only and the 25-user cap doesn't apply to Client Credentials flow.

## Approach (rough)

This is more involved than Brief 1 because it changes the trust model and the welcome flow.

### Welcome flow change

```
First run:
  → "Onde salvar?"
  → "Conectar Spotify Premium pra baixar em 320?"
    ├ "Não, pode usar YouTube" → done, banner shows on Spotify tab as today
    ├ "Sim, conectar"
        → Modal: "Pra conectar, você precisa criar um app no Spotify Developer Dashboard"
        → Step-by-step instructions in-app + "Abrir Spotify Dashboard" button
        → Friend pastes Client ID + Client Secret-less is enough (PKCE)
        → "Validar" runs the full PKCE flow as a smoke check
        → If OK: stored, status pill replaces banner
```

### Files touched

| Path | Change |
|------|--------|
| `main/storage/spotify-auth.js` | Schema extended: `{ refresh_token, email, product, savedAt, oauthClientId }` |
| `main/spotify-direct/index.js` | `clientIdProvider` reads from the auth store first, falls back to embedded |
| `main/ipc.js` | New IPC: `spotify:saveClientId(clientId)`, `spotify:testConnection()` |
| `renderer/main.js` | Welcome flow gets a new optional step; Settings dialog gets a "Spotify App" section with the Client ID and a "Trocar" button |
| `renderer/index.html` | New welcome step, new settings section |
| `docs/SETUP-spotify-app.md` | Friend-facing guide in Portuguese (with screenshots) |
| `main/storage/config.js` | New flag `useEmbeddedSpotifyApp` for owner-only fallback (default false) |

### Migration for current Plan D users

Friends who already authorized using the embedded Client ID continue to work as long as they remain on your 25-user allowlist. The app should detect the absence of `oauthClientId` in stored credentials and surface a Settings prompt: "Esse app foi configurado com Spotify App compartilhado. Considere criar o seu próprio pra evitar limites." Non-blocking.

## Design decisions left for proper brainstorming

These genuinely need a session — not as small as Brief 1.

1. **First-run UX**: "Optional connection step" or "Mandatory choice"? Optional preserves "amigo leigo" experience; mandatory forces the higher quality. The 25-user limit means even friends who pick YouTube reduce pressure on the embedded Client ID. **Optional** is probably right.

2. **Where the SETUP guide lives**: inside the app as an interactive step, in a separate window, or as an external markdown file? The interactive step has the highest completion rate but the most UI work.

3. **Smoke-test before save**: do we actually run a PKCE round-trip against the Client ID, or just sanity-check the format (32 hex chars)? Round-trip catches typos and bad app config; format check is instant. Probably round-trip in a "quick mode" (cancellable, in-app browser test).

4. **Owner override**: do we hide the embedded Client ID behind an env var or a hidden Settings checkbox? Env var is more developer-friendly; checkbox is more "I might want to fall back to this if my Dashboard goes weird." Pick one.

5. **Settings copy** (Portuguese): how to phrase "you need to create your own Spotify app" without scaring people. "Conectar com seu próprio app Spotify (5 min, instruções na tela)" feels right.

6. **Group accounts**: a small DJ collective might want to share ONE app across 25 people without each person setting up. We could accept that case but should not optimize for it — the Brief 1 + Brief 2 combination is strictly about "individual scaling."

## Test plan

- Unit: `spotify-auth.js` schema migration tests (old payload reads back with default Client ID; new payload roundtrips with embedded Client ID).
- Unit: `spotify-direct/index.js` `clientIdProvider` resolution order (auth store > config flag > embedded).
- Integration: full welcome flow on a fresh user-data directory; verify the Client ID is saved encrypted.
- Manual smoke: walk through the SETUP-spotify-app.md guide as if you were a friend who had never seen the Spotify Dashboard.

## Risk callouts

- **Friend friction**: the 5-min setup is real. Some friends will give up. Mitigation: very clear screenshots in the SETUP guide, and a "skip for now, use YouTube" door.
- **Phishing-shaped UX**: asking a user to paste credentials into an app teaches a bad pattern. Client ID is **not** a credential (it's a public identifier), but we should reinforce this in the UI: "Esse não é seu login do Spotify. É um identificador público do app que você acabou de criar."
- **Spotify Developer terms**: each friend agrees to Spotify's developer terms when they create their app. That's their agreement, not yours. This is actually cleaner legally than embedding one shared app.

## Pairing with Brief 1

Briefs 1 and 2 are strongly complementary:

- Brief 1 alone: strict 320 works but you're still capped at 25 users.
- Brief 2 alone: 25-user cap solved but quality is still inconsistent.
- Briefs 1 + 2: each friend connects their own Premium, strict mode is on, every download is verified-320 or visibly missing.

Recommended sequencing if both are chosen: do Brief 1 first (small, ships immediately, you personally get the strict-320 win), then Brief 2.

---

**Next step if chosen:** Promote to a full spec via the `brainstorming` skill — and unlike Brief 1, this one really needs the conversation because the UX decisions matter. After spec, a 12-15 task implementation plan via `writing-plans`.
