export const DISPLAY_NAME_MAX_LEN = 25;

const TRAILING_BRACKET_ABBREV = /\s+\([^)]+\)$/;

/**
 * Fit market candidate/party names within a display limit.
 * When over the limit, drop trailing parenthetical abbreviations first,
 * then remove trailing word components until the name fits.
 */
export function formatDisplayName(name, maxLen = DISPLAY_NAME_MAX_LEN) {
  if (!name || name.length <= maxLen) return name;

  let trimmed = name.trim();

  while (trimmed.length > maxLen && TRAILING_BRACKET_ABBREV.test(trimmed)) {
    trimmed = trimmed.replace(TRAILING_BRACKET_ABBREV, "").trim();
  }
  if (trimmed.length <= maxLen) return trimmed;

  const words = trimmed.split(/\s+/).filter(Boolean);
  if (!words.length) return trimmed.slice(0, maxLen);

  while (words.length > 1) {
    const candidate = words.join(" ");
    if (candidate.length <= maxLen) return candidate;
    words.pop();
  }

  const word = words[0];
  if (word.length <= maxLen) return word;
  return `${word.slice(0, maxLen - 1)}.`;
}
