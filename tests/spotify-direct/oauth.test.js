import { describe, it, expect, beforeEach } from 'vitest';
import nock from 'nock';
import http from 'node:http';
import {
  exchangeCodeForTokens,
  refreshAccessToken,
  fetchUserProfile,
  createLoopbackCallback,
} from '../../main/spotify-direct/oauth.js';

beforeEach(() => nock.cleanAll());

describe('exchangeCodeForTokens', () => {
  it('POSTs the right form body and returns the parsed tokens', async () => {
    nock('https://accounts.spotify.com')
      .post('/api/token')
      .reply(200, {
        access_token: 'AT', refresh_token: 'RT', expires_in: 3600,
        token_type: 'Bearer', scope: 'streaming user-read-private user-read-email',
      });

    const out = await exchangeCodeForTokens({
      code: 'THECODE',
      codeVerifier: 'VERIFIER',
      redirectUri: 'http://127.0.0.1:5101/callback',
      clientId: 'CID',
    });
    expect(out).toMatchObject({ access_token: 'AT', refresh_token: 'RT', expires_in: 3600 });
  });

  it('throws a typed AuthError on 400 from Spotify', async () => {
    nock('https://accounts.spotify.com')
      .post('/api/token')
      .reply(400, { error: 'invalid_grant' });
    await expect(exchangeCodeForTokens({
      code: 'X', codeVerifier: 'V', redirectUri: 'R', clientId: 'C',
    })).rejects.toThrow(/oauth/i);
  });
});

describe('refreshAccessToken', () => {
  it('uses the refresh_token grant', async () => {
    nock('https://accounts.spotify.com')
      .post('/api/token')
      .reply(200, { access_token: 'NEW', expires_in: 3600 });
    const out = await refreshAccessToken({ refreshToken: 'RT', clientId: 'CID' });
    expect(out.access_token).toBe('NEW');
  });
});

describe('fetchUserProfile', () => {
  it('returns email and product', async () => {
    nock('https://api.spotify.com')
      .get('/v1/me')
      .matchHeader('Authorization', 'Bearer ABC')
      .reply(200, { email: 'a@b.c', product: 'premium', id: 'uid' });
    const out = await fetchUserProfile({ accessToken: 'ABC' });
    expect(out).toEqual({ email: 'a@b.c', product: 'premium', id: 'uid' });
  });
});

function fetchOnce(port, pathAndQuery) {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port, path: pathAndQuery }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => resolve({ status: res.statusCode, body }));
    }).on('error', reject);
  });
}

describe('createLoopbackCallback', () => {
  it('resolves with { code, state } when /callback receives them', async () => {
    const cb = await createLoopbackCallback();
    expect(cb.port).toBeGreaterThan(0);
    setTimeout(() => { fetchOnce(cb.port, '/callback?code=THECODE&state=ST'); }, 5);
    const result = await cb.promise;
    expect(result).toEqual({ code: 'THECODE', state: 'ST' });
  });

  it('serves "Pode fechar" HTML on the callback response', async () => {
    const cb = await createLoopbackCallback();
    setTimeout(() => { fetchOnce(cb.port, '/callback?code=A&state=B'); }, 5);
    await cb.promise;
    cb.cleanup();
  });

  it('rejects with TimeoutError after the timeout elapses', async () => {
    const cb = await createLoopbackCallback({ timeoutMs: 50 });
    await expect(cb.promise).rejects.toThrow(/timeout/i);
    cb.cleanup();
  });

  it('rejects when the loopback receives no code', async () => {
    const cb = await createLoopbackCallback();
    setTimeout(() => { fetchOnce(cb.port, '/callback?error=access_denied'); }, 5);
    await expect(cb.promise).rejects.toThrow(/access_denied|denied/i);
    cb.cleanup();
  });
});
