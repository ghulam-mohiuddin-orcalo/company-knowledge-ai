/**
 * Normalizes extracted text while keeping paragraph structure (TDD §12 step 7):
 * Unicode NFC, LF line endings, no control/invisible formatting characters,
 * single spaces, at most one blank line between paragraphs.
 */
export function normalizeText(text: string): string {
  return text
    .normalize('NFC')
    .replace(/\r\n?/g, '\n')
    .replace(/[\t\f\v\u00a0\u2000-\u200a\u202f\u205f\u3000]/g, ' ')
    .replace(/[\p{Cc}\p{Cf}]/gu, (char) => (char === '\n' ? char : ''))
    .replace(/ {2,}/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Text with no letters or digits carries nothing worth indexing. */
export function hasUsableText(text: string): boolean {
  return /[\p{L}\p{N}]/u.test(text);
}
