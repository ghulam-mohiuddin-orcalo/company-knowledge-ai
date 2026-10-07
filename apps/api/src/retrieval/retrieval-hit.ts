import type { ChunkMatch } from './retrieval.repository.js';

/**
 * Internal retrieval contract (TDD §14). Not an API response: E5 builds prompts
 * from it and E6 builds citations from its IDs and locator.
 */
export interface RetrievalHit {
  /** Chunks this hit covers, in document order (more than one when merged). */
  chunkIds: string[];
  documentId: string;
  documentName: string;
  content: string;
  /** Best cosine similarity among the merged chunks. */
  score: number;
  locator: {
    page: number | null;
    section: string | null;
    /** Offsets within the page/section text. */
    charStart: number;
    charEnd: number;
  };
}

export interface SelectionLimits {
  maxHits: number;
  maxPerDocument: number;
}

/** At most this many adjacent chunks are merged into one hit. */
const MAX_MERGED_CHUNKS = 3;

/**
 * Turns ranked chunk matches into bounded evidence: adjacent overlapping chunks
 * of the same page/section are merged (their shared overlap is not repeated),
 * no document contributes more than `maxPerDocument` hits, and at most
 * `maxHits` hits are returned, best first. Deterministic.
 */
export function mergeAndSelect(
  matches: readonly ChunkMatch[],
  limits: SelectionLimits,
): RetrievalHit[] {
  const groups = new Map<string, ChunkMatch[]>();
  for (const match of matches) {
    const key = `${match.documentId}|${match.pageNumber}|${match.sectionPath}`;
    groups.set(key, [...(groups.get(key) ?? []), match]);
  }

  const hits: RetrievalHit[] = [];
  for (const group of groups.values()) {
    const ordered = [...group].sort((a, b) => a.chunkIndex - b.chunkIndex);
    let current: { hit: RetrievalHit; lastIndex: number } | undefined;
    for (const match of ordered) {
      if (
        current &&
        match.chunkIndex === current.lastIndex + 1 &&
        match.charStart <= current.hit.locator.charEnd &&
        current.hit.chunkIds.length < MAX_MERGED_CHUNKS
      ) {
        const overlap = current.hit.locator.charEnd - match.charStart;
        current.hit.content += match.content.slice(overlap);
        current.hit.locator.charEnd = match.charEnd;
        current.hit.chunkIds.push(match.chunkId);
        current.hit.score = Math.max(current.hit.score, match.score);
        current.lastIndex = match.chunkIndex;
        continue;
      }
      current = { hit: toHit(match), lastIndex: match.chunkIndex };
      hits.push(current.hit);
    }
  }

  hits.sort(
    (a, b) => b.score - a.score || a.chunkIds[0]!.localeCompare(b.chunkIds[0]!),
  );
  const perDocument = new Map<string, number>();
  const selected: RetrievalHit[] = [];
  for (const hit of hits) {
    const count = perDocument.get(hit.documentId) ?? 0;
    if (count >= limits.maxPerDocument) continue;
    perDocument.set(hit.documentId, count + 1);
    selected.push(hit);
    if (selected.length === limits.maxHits) break;
  }
  return selected;
}

function toHit(match: ChunkMatch): RetrievalHit {
  return {
    chunkIds: [match.chunkId],
    documentId: match.documentId,
    documentName: match.documentName,
    content: match.content,
    score: match.score,
    locator: {
      page: match.pageNumber,
      section: match.sectionPath,
      charStart: match.charStart,
      charEnd: match.charEnd,
    },
  };
}
