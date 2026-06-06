import { describe, it, expect } from 'vitest';
import { pickBitrateFromProbeJson } from '../../main/download/ffmpeg.js';

describe('pickBitrateFromProbeJson', () => {
  it('prefers stream.bit_rate when present (e.g., AAC, MP3 — most CBR formats)', () => {
    const probe = {
      streams: [{ bit_rate: '256000' }],
      format: { bit_rate: '260000', duration: '180', size: '5850000' },
    };
    expect(pickBitrateFromProbeJson(probe)).toBe(256000);
  });

  it('falls back to format.bit_rate when stream lacks bit_rate (e.g., Opus VBR from YouTube)', () => {
    const probe = {
      streams: [{ codec_name: 'opus' }],
      format: { bit_rate: '137492', duration: '498', size: '8566801' },
    };
    expect(pickBitrateFromProbeJson(probe)).toBe(137492);
  });

  it('computes from size and duration when neither bit_rate field exists', () => {
    const probe = {
      streams: [{ codec_name: 'opus' }],
      format: { duration: '100', size: '1500000' },
    };
    // (1500000 * 8) / 100 = 120000 bps
    expect(pickBitrateFromProbeJson(probe)).toBe(120000);
  });

  it('returns null when everything is missing (caller falls back to default)', () => {
    expect(pickBitrateFromProbeJson({ streams: [{}], format: {} })).toBeNull();
    expect(pickBitrateFromProbeJson(null)).toBeNull();
    expect(pickBitrateFromProbeJson({})).toBeNull();
  });

  it('ignores zero or non-numeric values along the chain', () => {
    const probe = {
      streams: [{ bit_rate: '0' }],
      format: { bit_rate: 'N/A', duration: '60', size: '1200000' },
    };
    // first two skipped (zero, NaN), computes from size/duration: 160000
    expect(pickBitrateFromProbeJson(probe)).toBe(160000);
  });
});
