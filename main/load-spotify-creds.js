function loadSpotifyCreds() {
  try {
    return require('./spotify-creds.js');
  } catch {
    return {
      clientId: process.env.SPOTIFY_CLIENT_ID,
      clientSecret: process.env.SPOTIFY_CLIENT_SECRET,
      oauthClientId: process.env.SPOTIFY_OAUTH_CLIENT_ID,
      oauthRedirectUri: process.env.SPOTIFY_OAUTH_REDIRECT_URI || '',
      oauthCallbackPort: process.env.SPOTIFY_OAUTH_CALLBACK_PORT || '5982',
    };
  }
}

module.exports = { loadSpotifyCreds };
