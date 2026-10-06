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
  requireAuthConfig,
  type AppConfig,
  type AuthConfig,
  type DatabaseConfig,
} from './load-config.js';
export { Secret } from './secret.js';
