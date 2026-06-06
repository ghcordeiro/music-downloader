import { describe, it, expect } from 'vitest';
import { sanitizeFilename, resolveBinary } from '../../main/storage/paths.js';
import path from 'node:path';

describe('sanitizeFilename', () => {
  it('removes characters forbidden on Windows', () => {
    const input = 'Daft Punk - Around <the> World: "remix"|extended?*/\\';
    expect(sanitizeFilename(input)).toBe('Daft Punk - Around the World remixextended');
  });

  it('collapses runs of whitespace and trims', () => {
    expect(sanitizeFilename('  Track    Name  ')).toBe('Track Name');
  });

  it('returns "untitled" for an empty or all-whitespace input', () => {
    expect(sanitizeFilename('')).toBe('untitled');
    expect(sanitizeFilename('   ')).toBe('untitled');
  });

  it('truncates very long names to keep filesystem-safe length', () => {
    const long = 'a'.repeat(300);
    const result = sanitizeFilename(long);
    expect(result.length).toBeLessThanOrEqual(200);
  });
});

describe('resolveBinary', () => {
  it('returns the macOS arm64 path on Apple Silicon', () => {
    const result = resolveBinary('yt-dlp', { platform: 'darwin', arch: 'arm64', root: '/app' });
    expect(result).toBe(path.join('/app', 'binaries', 'mac-arm64', 'yt-dlp'));
  });

  it('returns the macOS x64 path on Intel Macs', () => {
    const result = resolveBinary('yt-dlp', { platform: 'darwin', arch: 'x64', root: '/app' });
    expect(result).toBe(path.join('/app', 'binaries', 'mac-x64', 'yt-dlp'));
  });

  it('appends .exe on Windows', () => {
    const result = resolveBinary('yt-dlp', { platform: 'win32', arch: 'x64', root: '/app' });
    expect(result).toBe(path.join('/app', 'binaries', 'win-x64', 'yt-dlp.exe'));
  });

  it('throws on unsupported platforms', () => {
    expect(() => resolveBinary('yt-dlp', { platform: 'linux', arch: 'x64', root: '/app' }))
      .toThrow(/unsupported platform/);
  });
});
