# Zotify ↔ OAuth Bridge Spike — Findings

**Date:** 2026-06-06
**Outcome:** SUCCESS

## Approach that worked

librespot OAuth token bridge → stored `credentials.json` at a configurable path, then zotify with `--credentials-location`.

The plan's Approach 1 (writing raw `access_token` to `~/.zotify/credentials.json`) does **not** work. Zotify reads librespot's stored credential format via `Session.Builder.stored_file()`:

```json
{
  "username": "<spotify_user_id>",
  "credentials": "<base64 reusable auth>",
  "type": "AUTHENTICATION_STORED_SPOTIFY"
}
```

The bridge (`main/spotify-direct/credentials-bridge.py`):

1. Receives OAuth `access_token`, `refresh_token`, `expires_in`, and `client_id` from our PKCE flow.
2. Uses `librespot.oauth.OAuth.ingest_token_response()` to build `AUTHENTICATION_SPOTIFY_TOKEN` credentials.
3. Creates a librespot `Session` with `store_credentials=True` and `stored_credential_file=<path>`.
4. On successful `authenticate()`, librespot writes the reusable credential file zotify expects.
5. zotify is invoked with `--credentials-location <path>` and `--download-format vorbis`.

## Reproducing the success

```bash
# Install zotify + librespot (kokarare1212 fork via zotify-dev)
python3 -m venv ~/.zotify-venv
source ~/.zotify-venv/bin/activate
pip install "git+https://github.com/zotify-dev/zotify.git"

# After PKCE OAuth (Node spike or app connect flow), run bridge:
python3 main/spotify-direct/credentials-bridge.py \
  <oauth_client_id> <access_token> <refresh_token> <expires_in> /tmp/zotify-creds.json

# Download via zotify
zotify --credentials-location /tmp/zotify-creds.json \
  --root-path /tmp/zotify-out --output "{id}.{ext}" \
  --download-format vorbis \
  "https://open.spotify.com/track/1pKYYY0dkg23sQQXi0Q5zN"
```

## Surprises

- `pip install zotify` on PyPI fails; install from `git+https://github.com/zotify-dev/zotify.git`.
- `https://zotify.xyz` SSL cert mismatch; use GitHub directly.
- zotify CLI uses `--download-format` (not `--audio-format` from the plan spike script).
- librespot ships `OAuth.ingest_token_response()` and `get_credentials()` — no separate `librespot-auth` package needed.
- zotify entrypoint is `python -m zotify`, not a standalone PyInstaller binary; bundle via venv + launcher in `fetch-binaries.js`.

## Implication for Plan D

- Implementation proceeds. Section 6.7 of the spec is resolved.
- `main/spotify-direct/zotify.js` calls `credentials-bridge.py` before spawning zotify.
- `scripts/fetch-binaries.js` bundles zotify as venv + launcher script per OS/arch.
