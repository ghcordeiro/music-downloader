import { describe, it, expect } from 'vitest';
import { buildFilename, parseMixType } from '../main/filename.js';

describe('buildFilename', () => {
  it('with artist + title + label', () => {
    expect(buildFilename({ artist: 'Daft Punk', title: 'Around the World', label: 'Virgin' }))
      .toBe('Daft Punk - Around the World [Virgin].mp3');
  });

  it('omits the bracket when label is empty', () => {
    expect(buildFilename({ artist: 'Beyoncé', title: 'Halo', label: '' }))
      .toBe('Beyoncé - Halo.mp3');
  });

  it('sanitizes forbidden filename characters', () => {
    expect(buildFilename({ artist: 'A/B', title: 'X:Y', label: 'L|Z' }))
      .toBe('AB - XY [LZ].mp3');
  });

  it('substitutes "Unknown" for missing artist', () => {
    expect(buildFilename({ artist: '', title: 'X', label: '' })).toBe('Unknown - X.mp3');
  });
});

describe('parseMixType', () => {
  it('extracts parenthesized "Original Mix" and returns the clean title', () => {
    expect(parseMixType('Around the World (Original Mix)'))
      .toEqual({ cleanTitle: 'Around the World', mixType: 'Original Mix' });
  });

  it('normalizes "(Extended)" to "Extended Mix"', () => {
    expect(parseMixType('Latch (Extended)'))
      .toEqual({ cleanTitle: 'Latch', mixType: 'Extended Mix' });
  });

  it('recognizes "(Radio Edit)" verbatim', () => {
    expect(parseMixType('Hit (Radio Edit)'))
      .toEqual({ cleanTitle: 'Hit', mixType: 'Radio Edit' });
  });

  it('preserves named remixes', () => {
    expect(parseMixType("Latch (Disclosure's Remix)"))
      .toEqual({ cleanTitle: 'Latch', mixType: "Disclosure's Remix" });
    expect(parseMixType('Latch (Disclosure Remix)'))
      .toEqual({ cleanTitle: 'Latch', mixType: 'Disclosure Remix' });
  });

  it('handles dash-suffix forms', () => {
    expect(parseMixType('Around the World - Original Mix'))
      .toEqual({ cleanTitle: 'Around the World', mixType: 'Original Mix' });
  });

  it('returns null mix when no pattern matches', () => {
    expect(parseMixType('Halo')).toEqual({ cleanTitle: 'Halo', mixType: null });
  });

  it('does not invent "Original Mix" for tracks without it', () => {
    expect(parseMixType('Espresso').mixType).toBeNull();
  });
});

describe('buildFilename with mix and label', () => {
  it('renders both when present', () => {
    expect(buildFilename({
      artist: 'Daft Punk',
      title: 'Around the World',
      mixType: 'Original Mix',
      label: 'Virgin',
    })).toBe('Daft Punk - Around the World (Original Mix) [Virgin].mp3');
  });

  it('omits both when absent', () => {
    expect(buildFilename({
      artist: 'Beyoncé',
      title: 'Halo',
      mixType: null,
      label: '',
    })).toBe('Beyoncé - Halo.mp3');
  });

  it('renders only mix when label is absent', () => {
    expect(buildFilename({
      artist: 'Disclosure',
      title: 'Latch',
      mixType: 'Extended Mix',
      label: '',
    })).toBe('Disclosure - Latch (Extended Mix).mp3');
  });

  it('renders only label when mix is absent', () => {
    expect(buildFilename({
      artist: 'Daft Punk',
      title: 'Around the World',
      mixType: null,
      label: 'Virgin',
    })).toBe('Daft Punk - Around the World [Virgin].mp3');
  });
});
