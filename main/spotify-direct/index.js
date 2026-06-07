const { EventEmitter } = require('node:events');
const { shell } = require('electron');
const { generateCodeVerifier, codeChallenge } = require('./pkce.js');
const { buildAuthorizationUrl } = require('./oauth-urls.js');
const oauth = require('./oauth.js');
const zotify = require('./zotify.js');

function createSpotifyDirect({ store, clientIdProvider }) {
  const ee = new EventEmitter();
  let access = { token: null, refreshToken: null, expiresAt: 0 };

  async function _refreshIfNeeded() {
    if (access.token && Date.now() < access.expiresAt - 5 * 60 * 1000) {
      return {
        accessToken: access.token,
        refreshToken: access.refreshToken,
        expiresIn: Math.max(1, Math.floor((access.expiresAt - Date.now()) / 1000)),
      };
    }
    const persisted = await store.read();
    if (!persisted) throw Object.assign(new Error('not connected'), { code: 'NOT_CONNECTED' });
    try {
      const r = await oauth.refreshAccessToken({
        refreshToken: persisted.refresh_token,
        clientId: clientIdProvider(),
      });
      access = {
        token: r.access_token,
        refreshToken: r.refresh_token || persisted.refresh_token,
        expiresAt: Date.now() + r.expires_in * 1000,
      };
      if (r.refresh_token && r.refresh_token !== persisted.refresh_token) {
        await store.write({
          ...persisted,
          refresh_token: r.refresh_token,
          savedAt: new Date().toISOString(),
        });
      }
      return {
        accessToken: access.token,
        refreshToken: access.refreshToken,
        expiresIn: r.expires_in,
      };
    } catch (err) {
      await store.clear();
      access = { token: null, refreshToken: null, expiresAt: 0 };
      ee.emit('status-changed', { connected: false });
      throw err;
    }
  }

  return {
    on: (...args) => ee.on(...args),

    async getStatus() {
      const persisted = await store.read();
      if (!persisted) return { connected: false };
      return { connected: true, email: persisted.email, plan: persisted.product };
    },

    async connect() {
      ee.emit('status-changed', { connecting: true });

      const verifier = generateCodeVerifier();
      const challenge = codeChallenge(verifier);
      const state = generateCodeVerifier().slice(0, 16);

      const cb = await oauth.createLoopbackCallback();
      const redirectUri = `http://127.0.0.1:${cb.port}/callback`;
      const url = buildAuthorizationUrl({
        clientId: clientIdProvider(),
        redirectUri,
        codeChallenge: challenge,
        state,
      });

      shell.openExternal(url);

      let callbackResult;
      try { callbackResult = await cb.promise; }
      catch (err) {
        ee.emit('status-changed', { connected: false, error: err.message });
        throw err;
      }

      if (callbackResult.state !== state) {
        ee.emit('status-changed', { connected: false, error: 'state mismatch' });
        throw new Error('oauth state mismatch');
      }

      const tokens = await oauth.exchangeCodeForTokens({
        code: callbackResult.code,
        codeVerifier: verifier,
        redirectUri,
        clientId: clientIdProvider(),
      });

      const me = await oauth.fetchUserProfile({ accessToken: tokens.access_token });
      access = {
        token: tokens.access_token,
        refreshToken: tokens.refresh_token,
        expiresAt: Date.now() + tokens.expires_in * 1000,
      };

      await store.write({
        refresh_token: tokens.refresh_token,
        email: me.email,
        product: me.product,
        savedAt: new Date().toISOString(),
      });

      ee.emit('status-changed', { connected: true, email: me.email, plan: me.product });
      return { connected: true, email: me.email, plan: me.product };
    },

    async disconnect() {
      await store.clear();
      access = { token: null, refreshToken: null, expiresAt: 0 };
      ee.emit('status-changed', { connected: false });
    },

    async downloadTrack(spotifyTrackId, outputPath, { signal } = {}) {
      const tokens = await _refreshIfNeeded();
      const trackUrl = `https://open.spotify.com/track/${spotifyTrackId}`;
      try {
        return await zotify.downloadTrack({
          accessToken: tokens.accessToken,
          refreshToken: tokens.refreshToken,
          expiresIn: tokens.expiresIn,
          clientId: clientIdProvider(),
          trackUrl,
          outputPath,
          signal,
        });
      } catch (err) {
        if (err.code === 'AUTH_EXPIRED') {
          await store.clear();
          access = { token: null, refreshToken: null, expiresAt: 0 };
          ee.emit('status-changed', { connected: false, error: 'auth expired' });
        }
        throw err;
      }
    },
  };
}

module.exports = { createSpotifyDirect };
