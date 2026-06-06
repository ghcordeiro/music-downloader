# Music Downloader

Electron app that downloads tracks from Spotify, YouTube, and SoundCloud as MP3 with full ID3 tagging.

- **Design:** see `docs/superpowers/specs/2026-06-06-music-downloader-design.md`
- **Install instructions for friends:** `docs/INSTALL-mac.md`, `docs/INSTALL-windows.md`
- **Develop:** `npm install`, copy `.env.example` to `.env`, fill in Spotify creds, then `npm run prepare-binaries` and `npm start`.
- **Build:** `npm run dist:mac`, `npm run dist:win`, or `npm run dist` for both. Output under `dist/`.
