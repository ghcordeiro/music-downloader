const NodeID3 = require('node-id3');

async function writeTags(filePath, fields) {
  const tags = {
    title: fields.title || '',
    artist: fields.artist || '',
    album: fields.album || '',
    albumArtist: fields.albumArtist || 'Various Artists',
    trackNumber: fields.trackNumber || '',
    year: fields.year || '',
    comment: { language: 'eng', text: fields.comment || '' },
  };
  if (fields.subtitle) tags.subtitle = fields.subtitle;
  if (fields.publisher) tags.publisher = fields.publisher;
  if (fields.genre) tags.genre = fields.genre;
  if (fields.isrc) tags.ISRC = fields.isrc;
  if (fields.imageBuffer && fields.imageMime) {
    tags.image = {
      mime: fields.imageMime,
      type: { id: 3, name: 'Front Cover' },
      description: 'Cover',
      imageBuffer: fields.imageBuffer,
    };
  }
  const ok = NodeID3.write(tags, filePath);
  if (!ok) throw new Error(`failed to write ID3 tags to ${filePath}`);
}

module.exports = { writeTags };
