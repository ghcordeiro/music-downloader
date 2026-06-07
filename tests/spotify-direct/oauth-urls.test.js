import { describe, it, expect } from 'vitest';
import { buildAuthorizationUrl } from '../../main/spotify-direct/oauth-urls.js';

describe('buildAuthorizationUrl', () => {
  it('returns a Spotify authorize URL with the required query params', () => {
    const url = buildAuthorizationUrl({
      clientId: 'abc123',
      redirectUri: 'http://127.0.0.1:5101/callback',
      codeChallenge: 'CHALLENGE',
      state: 'STATE',
    });
    expect(url).toMatch(/^https:\/\/accounts\.spotify\.com\/authorize\?/);
    const parsed = new URL(url);
    expect(parsed.searchParams.get('client_id')).toBe('abc123');
    expect(parsed.searchParams.get('response_type')).toBe('code');
    expect(parsed.searchParams.get('redirect_uri')).toBe('http://127.0.0.1:5101/callback');
    expect(parsed.searchParams.get('code_challenge_method')).toBe('S256');
    expect(parsed.searchParams.get('code_challenge')).toBe('CHALLENGE');
    expect(parsed.searchParams.get('state')).toBe('STATE');
    expect(parsed.searchParams.get('scope')).toBe('streaming user-read-private user-read-email');
  });

  it('encodes special characters in the redirect URI', () => {
    const url = buildAuthorizationUrl({
      clientId: 'x',
      redirectUri: 'http://127.0.0.1:5101/callback?extra=1',
      codeChallenge: 'c',
      state: 's',
    });
    const parsed = new URL(url);
    expect(parsed.searchParams.get('redirect_uri')).toBe('http://127.0.0.1:5101/callback?extra=1');
  });
});
