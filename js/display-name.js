export const DISPLAY_NAME_MAX_LEN = 25;

/**
 * Fit market candidate/party names within a display limit.
 * When over the limit, drop trailing word components until the name fits.
 */
export function formatDisplayName(name, maxLen = DISPLAY_NAME_MAX_LEN) {
  if (!name || name.length <= maxLen) return name;

  const words = name.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return name.slice(0, maxLen);

  while (words.length > 1) {
    const candidate = words.join(" ");
    if (candidate.length <= maxLen) return candidate;
    words.pop();
  }

  const word = words[0];
  if (word.length <= maxLen) return word;
  return `${word.slice(0, maxLen - 1)}.`;
}
