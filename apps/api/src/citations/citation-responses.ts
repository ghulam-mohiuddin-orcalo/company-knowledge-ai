import type { CitationView } from './citations.repository.js';
import type { CitationResponse } from '@cka/contracts';
export type { CitationResponse };

export const EXCERPT_MAX_LENGTH = 280;

/** A bounded plain-text excerpt, cut at a word boundary. */
export function toExcerpt(content: string): string {
  const text = content.replace(/\s+/g, ' ').trim();
  if (text.length <= EXCERPT_MAX_LENGTH) return text;
  const cut = text.slice(0, EXCERPT_MAX_LENGTH - 1);
  const boundary = cut.lastIndexOf(' ');
  return `${(boundary > EXCERPT_MAX_LENGTH / 2 ? cut.slice(0, boundary) : cut).trimEnd()}…`;
}

/** Never includes chunk IDs, storage keys or character offsets. */
export function toCitationResponse(citation: CitationView): CitationResponse {
  return {
    id: citation.id,
    ordinal: citation.ordinal,
    documentId: citation.documentId,
    documentName: citation.documentName,
    locator: { page: citation.locator.page, section: citation.locator.section },
    excerpt:
      citation.chunkContent === null ? null : toExcerpt(citation.chunkContent),
    available: citation.available,
  };
}
