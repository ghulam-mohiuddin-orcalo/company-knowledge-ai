// Backend-only AI provider adapters (TDD §18). Never import into apps/web.
export { DeterministicEmbeddingProvider } from './deterministic-embedding-provider.js';
export {
  type EmbeddingErrorCode,
  type EmbeddingProvider,
  EmbeddingProviderError,
} from './embedding-provider.js';
export { OpenAiCompatibleEmbeddingProvider } from './openai-compatible-embedding-provider.js';
export {
  HashedTermEmbeddingProvider,
  terms,
} from './hashed-term-embedding-provider.js';
export {
  FakeGenerationProvider,
  type GenerationProvider,
  GenerationProviderError,
  type GenerationRequest,
  type GenerationResult,
} from './generation-provider.js';
export { OpenAiCompatibleGenerationProvider } from './openai-compatible-generation-provider.js';
export { AiProviderError, type ProviderErrorCode } from './provider-errors.js';
