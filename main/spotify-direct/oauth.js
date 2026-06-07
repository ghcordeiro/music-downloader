const http = require('node:http');
const axios = require('axios');

class OAuthError extends Error {
  constructor(message, status, body) {
    super(`oauth: ${message}`);
    this.status = status;
    this.body = body;
  }
}

async function exchangeCodeForTokens({ code, codeVerifier, redirectUri, clientId }) {
  try {
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      client_id: clientId,
      code_verifier: codeVerifier,
    }).toString();
    const r = await axios.post('https://accounts.spotify.com/api/token', body, {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      timeout: 15_000,
    });
    return r.data;
  } catch (err) {
    if (err.response) throw new OAuthError(err.response.data?.error || 'code exchange failed', err.response.status, err.response.data);
    throw new OAuthError(err.message, 0, null);
  }
}

async function refreshAccessToken({ refreshToken, clientId }) {
  try {
    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: clientId,
    }).toString();
    const r = await axios.post('https://accounts.spotify.com/api/token', body, {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      timeout: 15_000,
    });
    return r.data;
  } catch (err) {
    if (err.response) throw new OAuthError(err.response.data?.error || 'refresh failed', err.response.status, err.response.data);
    throw new OAuthError(err.message, 0, null);
  }
}

async function fetchUserProfile({ accessToken }) {
  const r = await axios.get('https://api.spotify.com/v1/me', {
    headers: { Authorization: `Bearer ${accessToken}` },
    timeout: 10_000,
  });
  return { email: r.data.email, product: r.data.product, id: r.data.id };
}

async function createLoopbackCallback({ timeoutMs = 5 * 60 * 1000, port = 0, host = '127.0.0.1' } = {}) {
  let resolveFn;
  let rejectFn;
  const promise = new Promise((res, rej) => { resolveFn = res; rejectFn = rej; });

  const server = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://127.0.0.1');
    if (u.pathname !== '/callback') {
      res.writeHead(404); res.end(); return;
    }
    const code = u.searchParams.get('code');
    const state = u.searchParams.get('state');
    const error = u.searchParams.get('error');

    if (error) {
      res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end('<h2>Falha na autorização. Volte ao app e tente de novo.</h2>');
      rejectFn(new Error(`oauth callback error: ${error}`));
      return;
    }
    if (!code) {
      res.writeHead(400); res.end();
      rejectFn(new Error('oauth callback missing code'));
      return;
    }

    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end('<h2>Pode fechar essa aba ✅</h2>');
    resolveFn({ code, state });
  });

  const listenPort = port > 0 ? port : 0;
  await new Promise((res, rej) => {
    server.listen(listenPort, host, (err) => (err ? rej(err) : res()));
  });

  const boundPort = server.address().port;

  const timer = setTimeout(() => {
    rejectFn(new Error('oauth callback timeout'));
    server.close();
  }, timeoutMs);

  return {
    port: boundPort,
    promise: promise.finally(() => { clearTimeout(timer); server.close(); }),
    cleanup: () => { clearTimeout(timer); server.close(); },
  };
}

module.exports = {
  exchangeCodeForTokens,
  refreshAccessToken,
  fetchUserProfile,
  OAuthError,
  createLoopbackCallback,
};
