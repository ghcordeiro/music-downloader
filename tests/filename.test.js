import { describe, it, expect } from 'vitest';
import { buildFilename } from '../main/filename.js';

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
