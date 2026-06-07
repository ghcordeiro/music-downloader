const crypto = require('node:crypto');

function base64url(buf) {
  return buf.toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function generateCodeVerifier() {
  return base64url(crypto.randomBytes(48));
}

function codeChallenge(verifier) {
  return base64url(crypto.createHash('sha256').update(verifier).digest());
}

module.exports = { generateCodeVerifier, codeChallenge };
