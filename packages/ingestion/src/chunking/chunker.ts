import type { ExtractedSegment } from '../extraction/extractor.js';
import type { TokenCounter } from './token-counter.js';

export interface ChunkingOptions {
  sizeTokens: number;
  overlapTokens: number;
}

export interface Chunk {
  chunkIndex: number;
  content: string;
  tokenCount: number;
  pageNumber: number | null;
  sectionPath: string | null;
  /** Offsets of `content` within its source segment (page/section) text. */
  charStart: number;
  charEnd: number;
}

interface Unit {
  start: number;
  end: number;
  tokens: number;
}

/**
 * Token-aware chunker (TDD §12.1). Chunks never cross segment (page/section)
 * boundaries, are cut at whitespace where possible, hold at most `sizeTokens`
 * tokens, and repeat roughly `overlapTokens` tokens of the previous chunk.
 * Deterministic for a given input.
 */
export function chunkSegments(
  segments: readonly ExtractedSegment[],
  options: ChunkingOptions,
  counter: TokenCounter,
): Chunk[] {
  if (options.overlapTokens >= options.sizeTokens) {
    throw new Error('overlapTokens must be smaller than sizeTokens');
  }
  const chunks: Chunk[] = [];
  for (const segment of segments) {
    const units = toUnits(segment.text, options.sizeTokens, counter);
    let i = 0;
    while (i < units.length) {
      let j = i;
      let tokens = 0;
      while (
        j < units.length &&
        tokens + units[j]!.tokens <= options.sizeTokens
      ) {
        tokens += units[j]!.tokens;
        j++;
      }
      if (j === i) j = i + 1;

      // Per-unit counts are an estimate; enforce the limit on the exact text.
      let content = segment.text
        .slice(units[i]!.start, units[j - 1]!.end)
        .trimEnd();
      let tokenCount = counter.count(content);
      while (tokenCount > options.sizeTokens && j - 1 > i) {
        j--;
        content = segment.text
          .slice(units[i]!.start, units[j - 1]!.end)
          .trimEnd();
        tokenCount = counter.count(content);
      }

      chunks.push({
        chunkIndex: chunks.length,
        content,
        tokenCount,
        pageNumber: segment.locator.page ?? null,
        sectionPath: segment.locator.section ?? null,
        charStart: units[i]!.start,
        charEnd: units[i]!.start + content.length,
      });
      if (j >= units.length) break;

      // Step back for overlap, always moving forward by at least one unit.
      let next = j;
      let overlap = 0;
      while (
        next > i + 1 &&
        overlap + units[next - 1]!.tokens <= options.overlapTokens
      ) {
        next--;
        overlap += units[next]!.tokens;
      }
      i = next;
    }
  }
  return chunks;
}

/** Splits text into words with trailing whitespace; oversized words are split further. */
function toUnits(
  text: string,
  maxTokens: number,
  counter: TokenCounter,
): Unit[] {
  const units: Unit[] = [];
  for (const match of text.matchAll(/\S+\s*/g)) {
    const start = match.index;
    const end = start + match[0].length;
    const tokens = counter.count(match[0]);
    if (tokens <= maxTokens) {
      units.push({ start, end, tokens });
    } else {
      units.push(...splitOversized(text, start, end, maxTokens, counter));
    }
  }
  return units;
}

/** Splits a run without whitespace (long URLs, CJK text) into pieces within the limit. */
function splitOversized(
  text: string,
  start: number,
  end: number,
  maxTokens: number,
  counter: TokenCounter,
): Unit[] {
  const units: Unit[] = [];
  let pieceStart = start;
  while (pieceStart < end) {
    let lo = pieceStart + 1;
    let hi = end;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      if (counter.count(text.slice(pieceStart, mid)) <= maxTokens) lo = mid;
      else hi = mid - 1;
    }
    let pieceEnd = lo;
    // Never split a surrogate pair.
    if (pieceEnd < end && /[\uD800-\uDBFF]/.test(text[pieceEnd - 1]!)) {
      pieceEnd = pieceEnd - 1 > pieceStart ? pieceEnd - 1 : pieceEnd + 1;
    }
    units.push({
      start: pieceStart,
      end: pieceEnd,
      tokens: counter.count(text.slice(pieceStart, pieceEnd)),
    });
    pieceStart = pieceEnd;
  }
  return units;
}
