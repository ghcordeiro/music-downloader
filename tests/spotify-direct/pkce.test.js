import { describe, it, expect } from 'vitest';
import { generateCodeVerifier, codeChallenge } from '../../main/spotify-direct/pkce.js';

describe('generateCodeVerifier', () => {
  it('produces an RFC 7636-conformant string (43-128 chars, URL-safe)', () => {
    for (let i = 0; i < 50; i++) {
      const v = generateCodeVerifier();
      expect(v.length).toBeGreaterThanOrEqual(43);
      expect(v.length).toBeLessThanOrEqual(128);
      expect(v).toMatch(/^[A-Za-z0-9_-]+$/);
    }
  });

  it('produces different values across calls (entropy check)', () => {
    const seen = new Set();
    for (let i = 0; i < 20; i++) seen.add(generateCodeVerifier());
    expect(seen.size).toBe(20);
  });
});

describe('codeChallenge', () => {
  it('produces the S256 base64url SHA-256 of the verifier (RFC 7636 example)', () => {
    const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
    const expected = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';
    expect(codeChallenge(verifier)).toBe(expected);
  });

  it('is deterministic for the same verifier', () => {
    const v = generateCodeVerifier();
    expect(codeChallenge(v)).toBe(codeChallenge(v));
  });
});
