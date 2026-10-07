import type { PromptSource } from '../rag/prompt-builder.js';
import type { NewCitation } from './citations.repository.js';

export interface MappedAnswer {
  /** Answer text with [SOURCE_n] replaced by display ordinals [1], [2], ... */
  text: string;
  citations: NewCitation[];
}

/**
 * Maps recognized SOURCE_n labels in a model answer to the retrieval hits that
 * were actually sent in the prompt (E6-T02). Ordinals follow first appearance.
 * Unknown labels are removed. Anything else in the model output (document IDs,
 * URLs, file names) is plain text and never becomes a citation: document and
 * chunk IDs come only from the server-side `sources` map.
 */
export function mapCitations(
  answer: string,
  sources: readonly PromptSource[],
): MappedAnswer {
  const byLabel = new Map(sources.map((source) => [source.label, source]));
  const ordinals = new Map<string, number>();
  const citations: NewCitation[] = [];

  const text = answer
    .replace(/\[(SOURCE_\d+)\]/g, (_, label: string) => {
      const source = byLabel.get(label);
      if (!source) return '';
      let ordinal = ordinals.get(label);
      if (ordinal === undefined) {
        ordinal = ordinals.size + 1;
        ordinals.set(label, ordinal);
        const { hit } = source;
        citations.push({
          ordinal,
          sourceLabel: label,
          documentId: hit.documentId,
          chunkId: hit.chunkIds[0]!,
          locator: {
            page: hit.locator.page,
            section: hit.locator.section,
            charStart: hit.locator.charStart,
            charEnd: hit.locator.charEnd,
          },
        });
      }
      return `[${ordinal}]`;
    })
    .replace(/[ \t]{2,}/g, ' ')
    .trim();

  return { text, citations };
}
