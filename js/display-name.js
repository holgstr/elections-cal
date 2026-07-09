export const DISPLAY_NAME_MAX_LEN = 25;

/**
 * Fit market candidate/party names within a display limit.
 * When over the limit, abbreviate the last word to its first letter plus a
 * period, then shorten earlier words the same way until the result fits.
 */
export function formatDisplayName(name, maxLen = DISPLAY_NAME_MAX_LEN) {
  if (!name || name.length <= maxLen) return name;

  const words = name.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return name.slice(0, maxLen);

  if (words.length === 1) {
    return `${words[0].slice(0, maxLen - 1)}.`;
  }

  const parts = words.map((word, index) =>
    index === words.length - 1 ? `${word.charAt(0)}.` : word
  );

  let result = parts.join(" ");
  if (result.length <= maxLen) return result;

  for (let index = words.length - 2; index >= 0; index -= 1) {
    parts[index] = `${words[index].charAt(0)}.`;
    result = parts.join(" ");
    if (result.length <= maxLen) return result;
  }

  return `${result.slice(0, maxLen - 1)}.`;
}
