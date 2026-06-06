const { sanitizeFilename } = require('./storage/paths.js');

function buildFilename({ artist, title, label }) {
  const a = sanitizeFilename(artist || 'Unknown');
  const t = sanitizeFilename(title || 'untitled');
  const labelPart = label && label.trim()
    ? ` [${sanitizeFilename(label.trim())}]`
    : '';
  return `${a} - ${t}${labelPart}.mp3`;
}

module.exports = { buildFilename };
