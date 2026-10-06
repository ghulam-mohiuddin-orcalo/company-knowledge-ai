// Shared configuration primitives: validated, typed environment configuration
// for the backend processes (api, worker). Never import this into apps/web.
export {
  ConfigValidationError,
  loadApiConfigOrExit,
  loadConfig,
  loadConfigOrExit,
  loadDatabaseConfig,
  loadDatabaseConfigOrExit,
  loadEnvFileIfPresent,
  loadWorkerConfigOrExit,
  requireAuthConfig,
  requireEmbeddingConfig,
  requireGenerationConfig,
  type AppConfig,
  type AuthConfig,
  type DatabaseConfig,
  type EmbeddingConfig,
  type GenerationConfig,
} from './load-config.js';
export { Secret } from './secret.js';
export {
  SUPPORTED_DOCUMENT_MIME_TYPES,
  type SupportedDocumentMimeType,
} from './schema.js';
