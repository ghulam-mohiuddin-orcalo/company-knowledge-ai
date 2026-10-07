import { createHash } from 'node:crypto';
import type { EmbeddingProvider } from './embedding-provider.js';

const STOPWORDS = new Set(
  (
    'a an and are as at be by can could do does for from get gets had has have how i if in is it its ' +
    'me my of on or our should so than that the their there these this to us was we what when where ' +
    'which who will with would you your am any after before into per also must may'
  ).split(' '),
);

/** Lowercase, accent-free word stems (light English suffix stripping). */
export function terms(text: string): string[] {
  return text
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length > 1 && !STOPWORDS.has(t))
    .map(stem);
}

function stem(term: string): string {
  if (/^\d+$/.test(term)) return term;
  if (term.endsWith('ies') && term.length > 4) return `${term.slice(0, -3)}y`;
  if (term.endsWith('ing') && term.length > 5) return term.slice(0, -3);
  if (term.endsWith('ed') && term.length > 4) return term.slice(0, -2);
  if (term.endsWith('s') && !term.endsWith('ss') && term.length > 3) {
    return term.slice(0, -1);
  }
  return term;
}

/**
 * Deterministic, offline lexical embedding: hashed unigram and bigram stem
 * features, L2-normalized, so cosine similarity reflects shared terms. Used for
 * the reproducible offline RAG evaluation baseline and tests only; it is not a
 * semantic model and is never configured in production.
 */
export class HashedTermEmbeddingProvider implements EmbeddingProvider {
  readonly model = 'hashed-term-v1';

  constructor(readonly dimensions: number) {}

  async embedTexts(texts: readonly string[]): Promise<number[][]> {
    return texts.map((text) => this.vector(text));
  }

  async embedQuery(text: string): Promise<number[]> {
    return this.vector(text);
  }

  vector(text: string): number[] {
    const vector = new Array<number>(this.dimensions).fill(0);
    const words = terms(text);
    const features: Array<[string, number]> = words.map((w) => [w, 1]);
    for (let i = 1; i < words.length; i++) {
      features.push([`${words[i - 1]} ${words[i]}`, 0.5]);
    }
    for (const [feature, weight] of features) {
      const digest = createHash('sha1').update(feature).digest();
      const index = digest.readUInt32BE(0) % this.dimensions;
      vector[index]! += (digest[4]! & 1 ? 1 : -1) * weight;
    }
    const norm = Math.hypot(...vector);
    return norm === 0 ? vector : vector.map((v) => v / norm);
  }
}
