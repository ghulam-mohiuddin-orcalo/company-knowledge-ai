import type { CitationView } from './citations.repository.js';

export const EXCERPT_MAX_LENGTH = 280;

export interface CitationResponse {
  id: string;
  ordinal: number;
  documentId: string;
  documentName: string;
  locator: { page: number | null; section: string | null };
  /** Short plain-text excerpt of the cited evidence; null when unavailable. */
  excerpt: string | null;
  /** False once the cited document is deleted or no longer indexed. */
  available: boolean;
}

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
