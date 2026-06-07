import { describe, it, expect } from 'vitest';
import { buildProvenanceComment } from '../../main/spotify-direct/provenance.js';

describe('buildProvenanceComment', () => {
  it('Spotify direct Premium', () => {
    expect(buildProvenanceComment({
      source: 'spotify-direct',
      sourceCodec: 'vorbis',
      sourceBitrateKbps: 320,
      finalBitrateKbps: 320,
      plan: 'premium',
    })).toBe('Source: Spotify Ogg Vorbis 320kbps → MP3 320kbps');
  });

  it('Spotify direct Free', () => {
    expect(buildProvenanceComment({
      source: 'spotify-direct',
      sourceCodec: 'vorbis',
      sourceBitrateKbps: 160,
      finalBitrateKbps: 160,
      plan: 'free',
    })).toBe('Source: Spotify Ogg Vorbis 160kbps → MP3 160kbps');
  });

  it('YouTube after Spotify fallback records the reason', () => {
    expect(buildProvenanceComment({
      source: 'youtube',
      sourceCodec: 'opus',
      sourceBitrateKbps: 160,
      finalBitrateKbps: 160,
      fallbackReason: 'not_in_catalog',
    })).toBe('Source: YouTube Opus 160kbps → MP3 160kbps (Spotify fallback: not_in_catalog)');
  });

  it('Pure YouTube (not connected, or YouTube tab)', () => {
    expect(buildProvenanceComment({
      source: 'youtube',
      sourceCodec: 'opus',
      sourceBitrateKbps: 160,
      finalBitrateKbps: 160,
    })).toBe('Source: YouTube Opus 160kbps → MP3 160kbps');
  });

  it('SoundCloud passes through the codec name as-is', () => {
    expect(buildProvenanceComment({
      source: 'soundcloud',
      sourceCodec: 'mp3',
      sourceBitrateKbps: 128,
      finalBitrateKbps: 128,
    })).toBe('Source: SoundCloud mp3 128kbps → MP3 128kbps');
  });
});
