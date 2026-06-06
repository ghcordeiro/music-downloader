const { sanitizeFilename } = require('./storage/paths.js');

const KNOWN_LITERAL = [
  'Original Mix',
  'Extended Mix',
  'Radio Edit',
  'Club Mix',
  'Dub Mix',
  'Acoustic',
  'Live',
];

const NORMALIZATIONS = new Map([
  ['Extended', 'Extended Mix'],
]);

function normalizeMix(mix) {
  const trimmed = mix.trim();
  if (NORMALIZATIONS.has(trimmed)) return NORMALIZATIONS.get(trimmed);
  return trimmed;
}

function parseMixType(title) {
  if (typeof title !== 'string') return { cleanTitle: '', mixType: null };

  const parens = title.match(/^(.*?)\s*\(([^()]+)\)\s*$/);
  if (parens) {
    const inside = parens[2].trim();
    if (
      KNOWN_LITERAL.includes(inside) ||
      /Remix$/i.test(inside) ||
      NORMALIZATIONS.has(inside) ||
      /'s\s+Remix$/i.test(inside)
    ) {
      return { cleanTitle: parens[1].trim(), mixType: normalizeMix(inside) };
    }
  }

  const dashMatch = title.match(/^(.*?)\s+-\s+([A-Za-z][A-Za-z ']*)\s*$/);
  if (dashMatch) {
    const candidate = dashMatch[2].trim();
    if (KNOWN_LITERAL.includes(candidate) || NORMALIZATIONS.has(candidate)) {
      return { cleanTitle: dashMatch[1].trim(), mixType: normalizeMix(candidate) };
    }
  }

  return { cleanTitle: title.trim(), mixType: null };
}

function buildFilename({ artist, title, label }) {
  const a = sanitizeFilename(artist || 'Unknown');
  const t = sanitizeFilename(title || 'untitled');
  const labelPart = label && label.trim()
    ? ` [${sanitizeFilename(label.trim())}]`
    : '';
  return `${a} - ${t}${labelPart}.mp3`;
}

module.exports = { buildFilename, parseMixType };
