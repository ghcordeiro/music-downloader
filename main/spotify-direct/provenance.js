const SOURCE_LABEL = {
  'spotify-direct': 'Spotify',
  youtube: 'YouTube',
  soundcloud: 'SoundCloud',
};

const CODEC_LABEL = {
  vorbis: 'Ogg Vorbis',
  opus: 'Opus',
  aac: 'AAC',
};

function buildProvenanceComment({ source, sourceCodec, sourceBitrateKbps, finalBitrateKbps, fallbackReason }) {
  const sourceName = SOURCE_LABEL[source] || source;
  const codec = CODEC_LABEL[sourceCodec] || sourceCodec;
  const tail = fallbackReason ? ` (Spotify fallback: ${fallbackReason})` : '';
  return `Source: ${sourceName} ${codec} ${sourceBitrateKbps}kbps → MP3 ${finalBitrateKbps}kbps${tail}`;
}

module.exports = { buildProvenanceComment };
