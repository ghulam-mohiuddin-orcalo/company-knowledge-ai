import { getEncoding, type Tiktoken } from 'js-tiktoken';

export interface TokenCounter {
  count(text: string): number;
}

let cl100k: Tiktoken | undefined;

/**
 * Token counter for OpenAI-compatible embedding models (text-embedding-3-*),
 * which use the cl100k_base encoding.
 */
export const cl100kTokenCounter: TokenCounter = {
  count(text: string): number {
    cl100k ??= getEncoding('cl100k_base');
    return cl100k.encode(text).length;
  },
};
