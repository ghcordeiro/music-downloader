const SCOPES = 'streaming user-read-private user-read-email';

function buildAuthorizationUrl({ clientId, redirectUri, codeChallenge, state }) {
  const u = new URL('https://accounts.spotify.com/authorize');
  u.searchParams.set('client_id', clientId);
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('redirect_uri', redirectUri);
  u.searchParams.set('code_challenge_method', 'S256');
  u.searchParams.set('code_challenge', codeChallenge);
  u.searchParams.set('state', state);
  u.searchParams.set('scope', SCOPES);
  return u.toString();
}

module.exports = { buildAuthorizationUrl, SCOPES };
