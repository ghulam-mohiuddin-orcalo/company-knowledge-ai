// Backend-only AI provider adapters (TDD §18). Never import into apps/web.
export { DeterministicEmbeddingProvider } from './deterministic-embedding-provider.js';
export {
  type EmbeddingErrorCode,
  type EmbeddingProvider,
  EmbeddingProviderError,
} from './embedding-provider.js';
export { OpenAiCompatibleEmbeddingProvider } from './openai-compatible-embedding-provider.js';
