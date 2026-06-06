import { describe, it, expect } from 'vitest';
import {
  InvalidUrlError,
  SpotifyAuthError,
  PlaylistNotFoundError,
  NetworkError,
  BinaryMissingError,
  DiskFullError,
  UnexpectedError,
} from '../main/errors.js';

describe('typed errors', () => {
  it('InvalidUrlError carries a Portuguese user message', () => {
    const err = new InvalidUrlError('https://bad');
    expect(err).toBeInstanceOf(Error);
    expect(err.code).toBe('INVALID_URL');
    expect(err.userMessage).toMatch(/link/i);
  });

  it('SpotifyAuthError indicates credential problems', () => {
    const err = new SpotifyAuthError('token revoked');
    expect(err.code).toBe('SPOTIFY_AUTH');
    expect(err.userMessage).toMatch(/Spotify/);
  });

  it('PlaylistNotFoundError carries the original URL', () => {
    const err = new PlaylistNotFoundError('https://open.spotify.com/playlist/abc');
    expect(err.code).toBe('PLAYLIST_NOT_FOUND');
    expect(err.url).toBe('https://open.spotify.com/playlist/abc');
  });

  it('UnexpectedError generates a short reference code', () => {
    const err = new UnexpectedError(new Error('boom'));
    expect(err.code).toBe('UNEXPECTED');
    expect(err.reference).toMatch(/^[A-Z0-9]{6}$/);
  });
});
