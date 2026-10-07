import { createHash } from 'node:crypto';
import type { EmbeddingProvider } from './embedding-provider.js';

/**
 * Deterministic, offline EmbeddingProvider for tests: the same text always maps
 * to the same unit vector. Not a semantic model; never used in production config.
 */
export class DeterministicEmbeddingProvider implements EmbeddingProvider {
  readonly model = 'deterministic-test';
  readonly calls: string[][] = [];

  constructor(readonly dimensions: number) {}

  async embedTexts(texts: readonly string[]): Promise<number[][]> {
    this.calls.push([...texts]);
    return texts.map((text) => this.vector(text));
  }

  async embedQuery(text: string): Promise<number[]> {
    return this.vector(text);
  }

  vector(text: string): number[] {
    const values: number[] = [];
    for (let block = 0; values.length < this.dimensions; block++) {
      const digest = createHash('sha256').update(`${block}:${text}`).digest();
      for (
        let i = 0;
        i < digest.length && values.length < this.dimensions;
        i++
      ) {
        values.push(digest[i]! / 127.5 - 1);
      }
    }
    const norm = Math.hypot(...values) || 1;
    return values.map((v) => v / norm);
  }
}
