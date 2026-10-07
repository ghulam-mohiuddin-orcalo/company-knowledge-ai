const RULES: Array<[RegExp, string]> = [
  // Authorization headers and bearer tokens.
  [/\b(Bearer|Basic)\s+[A-Za-z0-9\-._~+/=]{8,}/gi, '$1 [REDACTED]'],
  // JSON Web Tokens anywhere in text.
  [
    /\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]*/g,
    '[REDACTED_JWT]',
  ],
  // Provider API keys (sk-..., sk_live_...).
  [/\bsk[-_][A-Za-z0-9_-]{8,}/g, '[REDACTED_KEY]'],
  // Credentials in connection strings: scheme://user:password@host
  [/([a-z][a-z0-9+.-]*:\/\/[^:/\s@]+:)[^@\s/]+@/gi, '$1[REDACTED]@'],
  // key=value / key: value secrets.
  [
    /\b(password|passwd|secret|api[_-]?key|access[_-]?key|client[_-]?secret|token)(["']?\s*[=:]\s*["']?)[^\s"'&,;]+/gi,
    '$1$2[REDACTED]',
  ],
];

/**
 * Masks credentials that may slip into log messages or error stacks
 * (redaction policy, E8-T01). Defense in depth: code must still never log
 * secrets, document text or prompts in the first place.
 */
export function redact(text: string): string {
  return RULES.reduce(
    (value, [pattern, replacement]) => value.replace(pattern, replacement),
    text,
  );
}
